"""实时辅助答题端点回归测试。

运行方式（在 src-tauri 目录下）：
    ..\\.venv\\Scripts\\python.exe -m py_backend.tests.test_interview_assist

覆盖：
  A. 系统提示的公司/岗位回退
  B. history 截断与空内容过滤
  C. 在线模型门禁
  D. SSE 流式输出（delta/done、thinking 被忽略、message 兜底）
  E. LLM 错误透传
"""

import asyncio
import json
import os
import pathlib
import sys
import tempfile

for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

# ── 环境隔离：必须在导入 py_backend 任何模块之前设置 ──
_BASE = pathlib.Path(tempfile.mkdtemp(prefix="ew-assist-test-"))
os.environ["AGENT_DB_PATH"] = str(_BASE / "test.db")
os.environ["AGENT_SKILLS_DIR"] = str(_BASE / "skills")
os.environ["AGENT_MEMORIES_DIR"] = str(_BASE / "memories")
os.environ["AGENT_INPUT_DIR"] = str(_BASE / "input")
os.environ["AGENT_OUTPUT_DIR"] = str(_BASE / "output")

from py_backend import config  # noqa: E402
from py_backend import interview_assist as ia  # noqa: E402
from py_backend.data.models import (  # noqa: E402
    InterviewAssistMessage,
    InterviewAssistRequest,
)
from py_backend.llm.client import LLMError  # noqa: E402

_PASS = 0
_FAIL: list[str] = []


def check(cond: bool, label: str):
    global _PASS
    if cond:
        _PASS += 1
        print(f"  ✓ {label}")
    else:
        _FAIL.append(label)
        print(f"  ✗ {label}")


def section(name: str):
    print(f"\n── {name} ──")


def parse_events(frames: list[str]) -> list[dict]:
    events = []
    for frame in frames:
        for line in frame.splitlines():
            if line.startswith("data: "):
                events.append(json.loads(line[len("data: "):]))
    return events


def test_prompt():
    section("A. 系统提示")
    both = ia.build_system_prompt("XX科技", "前端工程师")
    check("XX科技前端工程师岗位的面试" in both, "公司 + 岗位")
    check(ia.build_system_prompt("XX科技", None).startswith("你正在参加XX科技的面试。"), "仅公司")
    check("前端工程师岗位" in ia.build_system_prompt(None, "前端工程师"), "仅岗位")
    check(
        ia.build_system_prompt(None, None) == "你正在参加面试。请直接回答面试官的问题。",
        "公司/岗位都缺省",
    )
    check(
        "XX科技前端工程师岗位" in ia.build_system_prompt("  XX科技  ", "  前端工程师  "),
        "首尾空白被清理",
    )


def test_history():
    section("B. history 截断与空内容")
    messages = []
    for i in range(20):
        messages.append(
            InterviewAssistMessage(
                role="user" if i % 2 == 0 else "assistant",
                content=f"m{i}",
            )
        )
    messages.append(InterviewAssistMessage(role="user", content="   "))
    req = InterviewAssistRequest(
        question="  当前问题  ",
        history=messages,
        company="XX科技",
        position="前端工程师",
    )
    built = ia.build_messages(req)
    check(len(built) == 18, "system + 最近 16 条非空 history + 当前问题")
    check(built[0]["role"] == "system", "第一条是 system")
    check(built[-1] == {"role": "user", "content": "当前问题"}, "当前问题在末尾且已 trim")
    check(
        [m["content"] for m in built[1:-1]] == [f"m{i}" for i in range(4, 20)],
        "只保留最近 16 条非空 history",
    )
    check(all(m["content"].strip() for m in built[1:-1]), "没有空白 history")


async def test_gate():
    section("C. 在线模型门禁")
    original_backend = config.LLM_BACKEND
    original_key = config.ONLINE_API_KEY
    try:
        config.LLM_BACKEND = "llamacpp"
        config.ONLINE_API_KEY = "sk-test"
        reason = ia.online_unavailable_reason()
        check(reason is not None and "在线模型" in reason, "本地后端被拒绝")

        config.LLM_BACKEND = "online"
        config.ONLINE_API_KEY = ""
        reason = ia.online_unavailable_reason()
        check(reason is not None and "API Key" in reason, "缺少 API Key 被拒绝")

        config.ONLINE_API_KEY = "sk-test"
        check(ia.online_unavailable_reason() is None, "在线 + Key 可用")
    finally:
        config.LLM_BACKEND = original_backend
        config.ONLINE_API_KEY = original_key


async def test_stream():
    section("D. SSE 流式输出")
    captured: dict = {}

    async def fake_stream(messages, tools=None, **kwargs):
        captured["messages"] = messages
        captured["tools"] = tools
        captured["kwargs"] = kwargs
        yield {"type": "thinking", "delta": "思考过程"}
        yield {"type": "delta", "text": "第一段"}
        yield {"type": "delta", "text": "第二段"}
        yield {"type": "message", "msg": {"role": "assistant", "content": "第一段第二段"}}

    original = ia.llm_chat_stream
    ia.llm_chat_stream = fake_stream
    try:
        req = InterviewAssistRequest(question="Redis 分布式锁怎么实现？")
        frames = [frame async for frame in ia.stream_answer(req)]
    finally:
        ia.llm_chat_stream = original

    events = parse_events(frames)
    check(
        events == [
            {"type": "delta", "text": "第一段"},
            {"type": "delta", "text": "第二段"},
            {"type": "done"},
        ],
        "delta 顺序正确、thinking 被忽略、done 收尾",
    )
    check(captured["tools"] is None, "不传工具")
    check(captured["kwargs"].get("thinking") == {"type": "disabled"}, "强制关闭思考")
    check(captured["kwargs"].get("max_tokens") == ia.MAX_TOKENS, "max_tokens 生效")
    check(captured["messages"][0]["role"] == "system", "注入 system")
    check(
        captured["messages"][-1] == {"role": "user", "content": "Redis 分布式锁怎么实现？"},
        "当前问题作为最后一条 user",
    )

    async def fake_message_only(messages, tools=None, **kwargs):
        yield {"type": "message", "msg": {"role": "assistant", "content": "完整回答"}}

    ia.llm_chat_stream = fake_message_only
    try:
        frames = [frame async for frame in ia.stream_answer(req)]
    finally:
        ia.llm_chat_stream = original
    check(
        parse_events(frames) == [{"type": "delta", "text": "完整回答"}, {"type": "done"}],
        "没有 delta 时用最终 message 兜底",
    )


async def test_llm_error():
    section("E. LLM 错误")
    async def fake_error(messages, tools=None, **kwargs):
        yield {"type": "delta", "text": "半截"}
        raise LLMError("连接超时")

    original = ia.llm_chat_stream
    ia.llm_chat_stream = fake_error
    try:
        req = InterviewAssistRequest(question="测试")
        frames = [frame async for frame in ia.stream_answer(req)]
    finally:
        ia.llm_chat_stream = original

    check(
        parse_events(frames) == [
            {"type": "delta", "text": "半截"},
            {"type": "error", "message": "连接超时"},
        ],
        "已生成的 delta 保留，错误事件收尾",
    )


async def main():
    test_prompt()
    test_history()
    await test_gate()
    await test_stream()
    await test_llm_error()

    print(f"\n{_PASS} passed, {len(_FAIL)} failed")
    if _FAIL:
        for label in _FAIL:
            print(f"  - {label}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))

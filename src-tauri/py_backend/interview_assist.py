"""实时辅助答题：把系统回环的每个转写段直接交给在线模型，流式返回。

刻意保持薄：无工具、无场景、无数据库、无简历，只做一轮一问一答；
追问能力由前端带回的有限 history 提供。
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import AsyncGenerator

from . import config
from .data.models import InterviewAssistRequest
from .llm.client import LLMError, llm_chat_stream

logger = logging.getLogger("agent.interview_assist")

MAX_HISTORY_MESSAGES = 16
MAX_TOKENS = 2048


def build_system_prompt(company: str | None, position: str | None) -> str:
    company = (company or "").strip()
    position = (position or "").strip()
    if company and position:
        target = f"{company}{position}岗位"
    elif company:
        target = company
    elif position:
        target = f"{position}岗位"
    else:
        target = ""
    prefix = f"你正在参加{target}的面试。" if target else "你正在参加面试。"
    return prefix + "请直接回答面试官的问题。"


def build_messages(req: InterviewAssistRequest) -> list[dict]:
    messages: list[dict] = [
        {"role": "system", "content": build_system_prompt(req.company, req.position)}
    ]
    history = [m for m in req.history if m.content.strip()][-MAX_HISTORY_MESSAGES:]
    messages.extend({"role": m.role, "content": m.content} for m in history)
    messages.append({"role": "user", "content": req.question.strip()})
    return messages


def online_unavailable_reason() -> str | None:
    if config.LLM_BACKEND != "online":
        return "实时辅助答题仅支持在线模型，请到设置 → 面试助手切换（修改后需重启应用）。"
    if not config.ONLINE_API_KEY.strip():
        return "实时辅助答题需要在线模型 API Key，请到设置 → 面试助手填写。"
    return None


def _sse(payload: dict) -> str:
    return f"event: {payload['type']}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"


async def stream_answer(req: InterviewAssistRequest) -> AsyncGenerator[str, None]:
    messages = build_messages(req)
    saw_delta = False
    try:
        async for ev in llm_chat_stream(
            messages,
            tools=None,
            max_tokens=MAX_TOKENS,
            thinking={"type": "disabled"},
        ):
            if ev.get("type") == "delta":
                text = ev.get("text", "")
                if text:
                    saw_delta = True
                    yield _sse({"type": "delta", "text": text})
            elif ev.get("type") == "message" and not saw_delta:
                # 极少数兼容服务不按 delta 返回，用最终内容兜底一次
                content = (ev.get("msg") or {}).get("content", "") or ""
                if content:
                    saw_delta = True
                    yield _sse({"type": "delta", "text": content})
        yield _sse({"type": "done"})
    except asyncio.CancelledError:
        raise
    except LLMError as e:
        logger.error("interview assist LLM error: %s", e.message)
        yield _sse({"type": "error", "message": e.message})
    except Exception as e:
        logger.exception("interview assist failed")
        yield _sse({"type": "error", "message": f"实时辅助请求失败: {e}"})

"""场景隔离与工具越权防护的回归测试。

运行方式（在 src-tauri 目录下）：
    python -m py_backend.tests.test_scene_isolation

覆盖：
  A. 场景注册表完整性（fail-closed：工具必须显式登记）
  B. 定义期隔离：各场景暴露的工具集精确匹配白名单
  C. 执行期强制：白名单外的调用一律拒绝且不落库
  D. 题库数据正确性：来源绑定 + 同来源查重
  E. 会话级场景持久化：回答教练场景跨轮沿用（回归 2026-10-10 线上事故）
  F. 原始故障复现：回答教练场景下模型试图入库 → 被拒绝

测试使用临时数据库（AGENT_DB_PATH 指向临时目录），不触碰真实数据。
"""

import asyncio
import os
import pathlib
import sys
import tempfile

# Windows 控制台默认 GBK，✓/✗ 等符号会 UnicodeEncodeError；强制 UTF-8 输出
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

# ── 环境隔离：必须在导入 py_backend 任何模块之前设置 ──
_BASE = pathlib.Path(tempfile.mkdtemp(prefix="ew-agent-test-"))
os.environ["AGENT_DB_PATH"] = str(_BASE / "test.db")
os.environ["AGENT_SKILLS_DIR"] = str(_BASE / "skills")
os.environ["AGENT_MEMORIES_DIR"] = str(_BASE / "memories")
os.environ["AGENT_INPUT_DIR"] = str(_BASE / "input")
os.environ["AGENT_OUTPUT_DIR"] = str(_BASE / "output")
(_BASE / "skills").mkdir(parents=True, exist_ok=True)

from py_backend.data.database import db  # noqa: E402
from py_backend.scenes import SCENES, resolve_scene, tool_allowed  # noqa: E402
from py_backend.tools.handlers import HANDLERS, SCHEMAS as HANDLER_SCHEMAS  # noqa: E402
from py_backend.tools.registry import SkillRegistry  # noqa: E402
from py_backend.llm.chat import _prepare_turn  # noqa: E402

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


async def q_count(where: str = "", params: tuple = ()) -> int:
    cursor = await db.conn.execute(
        "SELECT COUNT(*) AS n FROM interview_questions" + (f" WHERE {where}" if where else ""),
        params,
    )
    row = await cursor.fetchone()
    return row["n"]


async def main():
    await db.connect()

    # ═══ A. 场景注册表完整性 ═══
    section("A. 场景注册表完整性（fail-closed）")
    check(set(SCENES) == {"general", "review", "resume", "answer"}, "场景集合为 general/review/resume/answer")
    known_tools = set(HANDLERS) | set(HANDLER_SCHEMAS)
    all_declared = set()
    for s in SCENES.values():
        all_declared |= s.tools
    check(all_declared <= known_tools, f"所有登记工具都存在 handler（{sorted(all_declared)} ⊆ {sorted(known_tools)}）")
    check(SCENES["answer"].tools == frozenset(), "answer 场景零工具")
    for name, scene in SCENES.items():
        has_qb = "question_bank" in scene.tools
        check(has_qb == (name == "review"), f"question_bank 仅在 review 场景可见（{name}：{'有' if has_qb else '无'}）")
    check(resolve_scene("", "") == "general", "空 scene/type → general")
    check(resolve_scene("aliens", None) == "general", "未知场景 → 降级 general")
    check(resolve_scene(None, "review") == "review", "scene 为空时按 type 回退")

    # ═══ B. 定义期隔离 ═══
    section("B. 定义期隔离（模型只能看到白名单工具）")
    reg = SkillRegistry([], _BASE)
    expected = {
        "general": {"interview_summary", "meeting_notice", "todo"},
        "review": {"question_bank", "interview_summary", "todo"},
        "resume": {"todo"},
        "answer": set(),
    }
    for scene_name, tools in expected.items():
        defs = reg.get_tool_definitions(scene_name)
        names = {d["function"]["name"] for d in defs}
        check(names == tools, f"scene={scene_name} 暴露 {sorted(names)}，期望 {sorted(tools)}")
    # SKILL.md 扫描出的技能同样受白名单约束
    reg2 = SkillRegistry(
        [{"name": "question_bank", "description": "x"}, {"name": "rogue_skill", "description": "y"}],
        _BASE,
    )
    names_general = {d["function"]["name"] for d in reg2.get_tool_definitions("general")}
    check("question_bank" not in names_general and "rogue_skill" not in names_general,
          "general 场景不暴露 question_bank / 未登记技能")
    check({d["function"]["name"] for d in reg.get_tool_definitions("aliens")} == expected["general"],
          "未知场景定义期按 general 兜底")

    # ═══ C. 执行期强制 ═══
    section("C. 执行期强制（越权调用直接拒绝且不落库）")
    before = await q_count()
    for scene_name in ("general", "resume", "answer"):
        r = await reg.execute_tool("question_bank", {"action": "add", "question": "越权测试题"}, scene=scene_name)
        check(isinstance(r, str) and r.startswith("⛔"), f"scene={scene_name} 调用 question_bank 被拒绝")
    check(await q_count() == before, "越权调用没有写入任何题库数据")
    r = await reg.execute_tool("todo", {"action": "create", "title": "越权待办"}, scene="answer")
    check(isinstance(r, str) and r.startswith("⛔"), "answer 场景调用 todo 被拒绝")

    # ═══ D. 题库数据正确性 ═══
    section("D. 题库数据正确性（来源绑定 + 查重）")
    ctx_review = {"scene": "review", "conversation_id": "c-test", "ref_id": "m-1"}
    r1 = await reg.execute_tool("question_bank", {"action": "add", "question": "请先做一下自我介绍", "category": "HR"}, scene="review", ctx=ctx_review)
    check(r1.startswith("✅"), "review 场景正常入库")
    check(await q_count("source_meeting_id = ?", ("m-1",)) == 1, "入库来源绑定为本场面试 m-1")
    # 空白差异的重复题 → 拒绝
    r2 = await reg.execute_tool("question_bank", {"action": "add", "question": "请先做一下 自我介绍", "category": "HR"}, scene="review", ctx=ctx_review)
    check(r2.startswith("⚠️") and "已在题库" in r2, "同来源重复题（含空白差异）被拒绝")
    check(await q_count("source_meeting_id = ?", ("m-1",)) == 1, "查重后同来源仍只有 1 条")
    # 不同来源的同样问题 → 允许（不同面试官可能问同一道题）
    ctx_review2 = {"scene": "review", "conversation_id": "c-test", "ref_id": "m-2"}
    r3 = await reg.execute_tool("question_bank", {"action": "add", "question": "请先做一下自我介绍", "category": "HR"}, scene="review", ctx=ctx_review2)
    check(r3.startswith("✅"), "不同来源允许入库同一道题")
    # 无来源（NULL）→ 入库为未归类，且 NULL 来源内查重
    r4 = await reg.execute_tool("question_bank", {"action": "add", "question": "无来源的题"}, scene="review", ctx={"scene": "review", "conversation_id": "c-test"})
    check(r4.startswith("✅") and await q_count("source_meeting_id IS NULL") == 1, "无来源题入库为未归类")
    r5 = await reg.execute_tool("question_bank", {"action": "add", "question": "无来源的题 "}, scene="review", ctx={"scene": "review", "conversation_id": "c-test"})
    check(r5.startswith("⚠️") and await q_count("source_meeting_id IS NULL") == 1, "未归类内重复同样被拒绝")

    # ═══ E. 会话级场景持久化 ═══
    section("E. 会话级场景持久化（回答教练跨轮沿用）")
    # 简历夹具：回答教练场景每轮都应注入
    await db.conn.execute(
        "INSERT INTO resumes (id, file_name, content, created_at, fields) VALUES (?, ?, ?, ?, ?)",
        ("r-test", "resume.pdf", "项目A：JEV 决策模型推理优化，P99 延迟下降 40%。", "2026-10-01T00:00:00Z", None),
    )
    await db.conn.commit()

    conv1 = await db.create_conversation("general")
    meta = await db.get_conversation_meta(conv1)
    check(meta["scene"] == "", "新会话 scene 为空（按 type 回退）")

    turn1 = await _prepare_turn(conv1, "[回答面试题] 为什么 JEV 这种决策模型速度非常快？")
    check(turn1["scene"] == "answer", "首条带标记消息 → answer 场景")
    check("面试回答教练" in turn1["sys_prompt"], "answer 场景注入教练角色提示词")
    check("简历开始" in turn1["context_block"] and "JEV" in turn1["context_block"], "answer 场景注入简历上下文")
    meta_after = await db.get_conversation_meta(conv1)
    check(meta_after["scene"] == "answer", "answer 场景已固化为会话级")

    turn2 = await _prepare_turn(conv1, "再简短一点，帮我压缩到一分钟")
    check(turn2["scene"] == "answer", "追问轮仍为 answer 场景（不再依赖隐藏标记）")
    check("面试回答教练" in turn2["sys_prompt"], "追问轮仍有教练角色提示词")
    check("简历开始" in turn2["context_block"], "追问轮仍注入简历")

    conv2 = await db.create_conversation("review", ref_id="m-1")
    turn3 = await _prepare_turn(conv2, "[回答面试题] 不应改变复盘场景")
    check(turn3["scene"] == "review", "review 会话收到标记消息不改场景")
    check("复盘分析师" in turn3["sys_prompt"], "review 场景角色提示词生效")

    await db.conn.execute("UPDATE agent_conversations SET scene = 'aliens' WHERE id = ?", (conv1,))
    await db.conn.commit()
    turn4 = await _prepare_turn(conv1, "你好")
    check(turn4["scene"] == "general", "库中未知场景值 → 降级 general")

    # ═══ F. 原始故障回归（2026-10-10 事故场景）═══
    section("F. 原始故障回归（回答教练场景下模型试图入库）")
    conv3 = await db.create_conversation("general")
    await _prepare_turn(conv3, "[回答面试题] 那现在有些 JEV 的开源方案，你觉得开源方案和 JEV 这个官方的 API 有什么样的差异呢？")
    # 追问轮（事故实际发生在追问轮）：模型"幻觉"出一条 question_bank 调用
    turn = await _prepare_turn(conv3, "jev 是最近新出的那个决策模型呀")
    check(turn["scene"] == "answer", "事故会话的追问轮解析为 answer 场景")
    before_jev = await q_count("question LIKE ?", ("%JEV 的开源方案%",))
    r = await reg.execute_tool(
        "question_bank",
        {"action": "add", "question": "那现在有些 JEV 的开源方案，你觉得开源方案和 JEV 这个官方的 API 有什么样的差异呢？", "category": "项目/技术选型"},
        scene=turn["scene"],
        ctx={"scene": turn["scene"], "conversation_id": conv3, "ref_id": None},
    )
    check(r.startswith("⛔"), "追问轮上的入库调用被拒绝")
    check(await q_count("question LIKE ?", ("%JEV 的开源方案%",)) == before_jev, "题库没有新增重复题")
    # 定义期同样不可见（模型根本看不到这个工具）
    check({d["function"]["name"] for d in reg.get_tool_definitions(turn["scene"])} == set(),
          "answer 场景工具清单为空（定义期模型看不到任何工具）")

    # ═══ 汇总 ═══
    print(f"\n{'=' * 50}")
    if _FAIL:
        print(f"FAILED: {len(_FAIL)}/{_PASS + len(_FAIL)} 项未通过")
        for f in _FAIL:
            print(f"  ✗ {f}")
        return 1
    print(f"ALL PASS: {_PASS} 项检查全部通过")
    return 0


async def _run() -> int:
    try:
        return await main()
    finally:
        # aiosqlite 的后台线程必须在退出前关闭，否则进程不退出
        await db.close()


if __name__ == "__main__":
    try:
        code = asyncio.run(_run())
    except Exception:
        import traceback
        traceback.print_exc()
        code = 1
    print(f"(测试数据目录: {_BASE})")
    sys.exit(code)

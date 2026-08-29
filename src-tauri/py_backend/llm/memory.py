"""Memory management: short-term (token estimation, compression) + long-term (persistent MEMORY.md).

Merged from memory.py + memory_long.py — both are part of the same memory system.
"""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path

import tiktoken

# Explicitly load tiktoken_ext so PyInstaller bundles the encoding data
# and entry point discovery works in the bundled app.
try:
    import tiktoken_ext.openai_public  # noqa: F401
except ImportError:
    pass

from ..config import (
    COMPRESS_TRIGGER_TOKENS,
    KEEP_RECENT_COUNT,
    MEMORIES_DIR,
    MEMORY_FILE,
)

logger = logging.getLogger("agent.memory")

# ── Token counting (short-term) ─────────────────────────────

_encoder = tiktoken.get_encoding("cl100k_base")

COMPRESS_TRIGGER = COMPRESS_TRIGGER_TOKENS
KEEP_RECENT = KEEP_RECENT_COUNT


def estimate_tokens(messages: list[dict]) -> int:
    total = 0
    for msg in messages:
        content = msg.get("content", "")
        if isinstance(content, str):
            total += len(_encoder.encode(content))
        total += 4
        if msg.get("tool_calls"):
            tc = msg["tool_calls"]
            if isinstance(tc, str):
                total += len(_encoder.encode(tc))
            elif isinstance(tc, list):
                total += len(_encoder.encode(json.dumps(tc)))
    return total


def needs_compression(messages: list[dict], existing_summary: str | None = None) -> bool:
    if len(messages) <= KEEP_RECENT:
        return False
    total = estimate_tokens(messages)
    if existing_summary:
        total += len(_encoder.encode(existing_summary))
    return total > COMPRESS_TRIGGER


_SUMMARIZATION_PROMPT = (
    "你是啤酒包装生产数据的摘要助手。请将以下对话片段压缩为结构化摘要，用于替代原始对话历史。\n\n"
    "核心原则：摘要必须能让未来的 AI **在不看原始对话的情况下**，准确理解包装线的运行状态、用户需求及当前问题。\n\n"
    "输出格式（严格按以下结构）：\n"
    "---\n"
    "【任务目标】\n"
    "（用户的核心需求是什么？如分析某条灌装线的 OEE、优化换型流程等）\n\n"
    "【已完成事项】\n"
    "- （已完成的子任务，如已统计昨日包材损耗、已生成停机分析图表）\n\n"
    "【关键数据/结论】\n"
    "- （核心指标：灌装速度（瓶/分钟）、产量（百升/箱）、OEE（%）、包材损耗率（%）、主要停机原因及时长）\n\n"
    "【待办事项】\n"
    "- [ ] （未完成的事项，如联系维修部调整贴标机参数）\n\n"
    "【约束条件】\n"
    "- （用户明确的偏好，如按班次统计、重点关注易拉罐线的效率等）\n\n"
    "---\n\n"
    "编写要求：\n"
    "1. **省略所有推理过程**，只保留结论。\n"
    "2. **省略工具调用细节**，只保留操作结果。\n"
    "3. **关键数据保留最终值**，省略中间步骤。\n"
    "4. **省略问候和闲聊**。\n"
    "5. **摘要长度**：原始对话每 1000 tokens 生成约 100-150 tokens 的摘要，上限 800 tokens。\n"
    "6. 如果某项内容为空，则省略该段落。\n\n"
    "示例（包装线场景）：\n"
    "---\n"
    "【任务目标】\n"
    "分析昨日 500ml 瓶装线的低效原因，提出改进建议。\n\n"
    "【已完成事项】\n"
    "- 读取了昨日 500ml 瓶装线的生产日志\n"
    "- 计算了各工段（灌装、贴标、装箱）的效率损失\n\n"
    "【关键数据/结论】\n"
    "- 昨日 500ml 瓶装线 OEE: 78.5%（目标 ≥ 85%），主要瓶颈在贴标机（停机 45 分钟，占比 60%）\n"
    "- 包材损耗率: 2.3%（主要为瓶盖划伤，高于正常值 1.5%）\n"
    "- 灌装机平均速度: 32,000 瓶/小时（设计速度为 36,000 瓶/小时）\n\n"
    "【待办事项】\n"
    "- [ ] 检查贴标机传感器校准情况\n"
    "- [ ] 统计本周瓶盖来料质量报告\n\n"
    "【约束条件】\n"
    "- 报告须按早/中/晚三个班次分别统计\n"
    "---\n\n"
    "请严格按照以上结构和要求，压缩以下对话。"
)

def build_summarization_messages(
    existing_summary: str | None,
    to_compress: list[dict],
) -> list[dict]:
    msgs: list[dict] = [{"role": "system", "content": _SUMMARIZATION_PROMPT}]
    if existing_summary:
        msgs.append({
            "role": "user",
            "content": (
                f"以下是已有的对话摘要（代表较早的对话）：\n\n"
                f"{existing_summary}\n\n"
                f"以下是新一轮对话内容，请**更新**上述摘要，而不是重新生成。\n"
                f"保留旧摘要中仍然有效的信息，添加新信息，合并同类项。"
            ),
        })
    else:
        msgs.append({"role": "user", "content": "请将以下对话压缩为摘要。"})
    for msg in to_compress:
        content = msg.get("content", "")
        if content:
            msgs.append({"role": msg.get("role", "user"), "content": content})
    return msgs


# ── Long-term memory (MEMORY.md persistence) ────────────────

_MEMORY_ENTRY_RE = re.compile(r"^## (\w+): (.+)$")


def ensure_memories_file(mem_dir: Path) -> None:
    mem_dir.mkdir(parents=True, exist_ok=True)
    file_path = mem_dir / MEMORY_FILE
    if not file_path.exists():
        file_path.write_text(
            "# Agent Memories\n\n此文件存储 Agent 的长期记忆，由系统自动维护。\n"
            "格式: ## category: title\\ncontent\\n",
            encoding="utf-8",
        )


def load_memories(mem_dir: Path) -> str:
    """Load memories as a formatted string with ## headers."""
    entries = _parse_entries(mem_dir)
    if not entries:
        return ""
    return "\n\n".join(
        f"## {category}: {title}\n{content}"
        for (category, title), content in entries.items()
    )


def append_memories(mem_dir: Path, entries: list[dict]) -> None:
    if not entries:
        return
    existing = _parse_entries(mem_dir)
    new_count = 0
    updated_count = 0
    for entry in entries:
        key = (entry["category"], entry["title"])
        content = entry["content"]
        if key in existing:
            if existing[key] != content:
                existing[key] = content
                updated_count += 1
        else:
            existing[key] = content
            new_count += 1
    mem_dir.mkdir(parents=True, exist_ok=True)
    file_path = mem_dir / MEMORY_FILE
    lines = [
        "# Agent Memories",
        "",
        "此文件存储 Agent 的长期记忆，由系统自动维护。",
        "格式: ## category: title\\ncontent",
        "",
    ]
    for (category, title), content in sorted(existing.items()):
        lines.append(f"## {category}: {title}")
        lines.append(content)
        lines.append("")
    file_path.write_text("\n".join(lines), encoding="utf-8")
    if new_count or updated_count:
        logger.info(
            "Long-term memory: %d new, %d updated, %d total",
            new_count, updated_count, len(existing),
        )


def _parse_entries(mem_dir: Path | None = None) -> dict[tuple[str, str], str]:
    mem_dir = mem_dir or Path(MEMORIES_DIR)
    file_path = mem_dir / MEMORY_FILE
    result: dict[tuple[str, str], str] = {}
    if not file_path.exists():
        return result
    text = file_path.read_text(encoding="utf-8")
    current_key: tuple[str, str] | None = None
    current_lines: list[str] = []
    for line in text.split("\n"):
        m = _MEMORY_ENTRY_RE.match(line.strip())
        if m:
            if current_key and current_lines:
                result[current_key] = "\n".join(current_lines).strip()
            current_key = (m.group(1), m.group(2))
            current_lines = []
        elif current_key:
            current_lines.append(line)
    if current_key and current_lines:
        result[current_key] = "\n".join(current_lines).strip()
    return result


def extraction_prompt() -> str:
    return (
        "从以下对话中提取需要长期记住的信息。\n\n"
        "只提取以下三类信息，其余忽略：\n"
        "- **preference**: 用户的偏好、习惯、格式要求（例如\"统计产量时按包装规格（瓶/罐）分开报\"、\"关注夜班效率\"）\n"
        "- **decision**: 对后续生产有持续指导意义的决策或结论（例如\"管理层确认每周三下午做包材盘点\"）\n"
        "- **context**: 用户的角色、负责的产线类型（如易拉罐线/玻璃瓶线）、班组信息等静态背景\n\n"
        "严格不要提取：\n"
        "- 纯业务数据（当日的产量、OEE、具体停机时长 — 这些应通过查询数据文件获取，不写入长期记忆）\n"
        "- 时效性信息（具体日期的排产计划、某个批次的包材异常 — 会过时）\n"
        "- 一次性操作记录（\"已生成昨日报表\"、\"已修复贴标机\" — 下次对话已失效）\n"
        "- 闲聊、问候、中间推理过程\n"
        "- 无实质内容的占位描述\n\n"
        "如果没有值得长期记住的新信息，只输出一行 [空]，不要编造。\n\n"
        "每条输出一行 JSON，格式：\n"
        '{"category":"preference","title":"简短标题","content":"完整描述"}\n'
        '{"category":"decision","title":"简短标题","content":"完整描述"}\n\n'
        "只输出 JSON 行，不要输出其他内容。"
    )


def _is_placeholder(text: str) -> bool:
    """Check if a memory entry is a placeholder with no real content."""
    text = text.strip()
    if not text or len(text) < 4:
        return True
    placeholder_patterns = (
        "无偏好", "无决策", "无上下文", "无信息",
        "暂无", "没有新", "没有需要记住",
        "用户未表达", "用户没有", "用户未提供",
        "无实质", "无特别", "无明确",
    )
    for pat in placeholder_patterns:
        if pat in text:
            return True
    return False


def parse_extraction(output: str) -> list[dict]:
    trimmed = output.strip()
    if not trimmed or trimmed.startswith("[空]"):
        return []

    # Strip markdown code fences if present
    if trimmed.startswith("```"):
        trimmed = re.sub(r"^```(?:json)?\s*", "", trimmed)
        trimmed = re.sub(r"\s*```$", "", trimmed)
    trimmed = trimmed.strip()

    entries: list[dict] = []
    decoder = json.JSONDecoder()
    idx = 0
    while idx < len(trimmed):
        # Skip non-JSON characters
        if trimmed[idx] not in ("{", "[", '"'):
            idx += 1
            continue
        try:
            obj, end = decoder.raw_decode(trimmed, idx)
            if isinstance(obj, dict) and all(k in obj for k in ("category", "title", "content")):
                title = (obj.get("title") or "").strip()
                content = (obj.get("content") or "").strip()
                # Filter placeholders: "无XX信息", "用户未表达XX", "暂无XX" etc.
                if _is_placeholder(title) or _is_placeholder(content):
                    idx = end
                    continue
                entries.append({
                    "category": obj["category"],
                    "title": title,
                    "content": content,
                })
            idx = end
        except json.JSONDecodeError:
            idx += 1
    return entries

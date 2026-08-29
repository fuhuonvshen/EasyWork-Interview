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
    "你是求职面试助手的摘要助手。请将以下对话片段压缩为结构化摘要，用于替代原始对话历史。\n\n"
    "核心原则：摘要必须能让未来的 AI **在不看原始对话的情况下**，准确理解用户的求职进度、目标岗位及当前问题。\n\n"
    "输出格式（严格按以下结构）：\n"
    "---\n"
    "【任务目标】\n"
    "（用户的核心需求是什么？如准备某公司前端一面、分析两个岗位的匹配度等）\n\n"
    "【已完成事项】\n"
    "- （已完成的子任务，如已完成模拟面试 3 轮、已生成复盘报告）\n\n"
    "【关键信息/结论】\n"
    "- （核心信息：目标岗位、意向公司、匹配度结论、面试表现评分、待补知识点）\n\n"
    "【待办事项】\n"
    "- [ ] （未完成的事项，如准备 JVM 调优案例、投递某岗位）\n\n"
    "【约束条件】\n"
    "- （用户明确的偏好，如只考虑北京、期望薪资范围、优先投递大模型方向等）\n\n"
    "---\n\n"
    "编写要求：\n"
    "1. **省略所有推理过程**，只保留结论。\n"
    "2. **省略工具调用细节**，只保留操作结果。\n"
    "3. **关键数据保留最终值**，省略中间步骤。\n"
    "4. **省略问候和闲聊**。\n"
    "5. **摘要长度**：原始对话每 1000 tokens 生成约 100-150 tokens 的摘要，上限 800 tokens。\n"
    "6. 如果某项内容为空，则省略该段落。\n\n"
    "示例（求职场景）：\n"
    "---\n"
    "【任务目标】\n"
    "准备 XX 科技前端工程师一面，重点补 React 性能优化。\n\n"
    "【已完成事项】\n"
    "- 完成了 5 轮模拟面试（算法 2 题、React 2 题、项目深挖 1 题）\n"
    "- 生成了模拟面试评估报告（总分 82）\n\n"
    "【关键信息/结论】\n"
    "- 目标岗位：前端工程师（React 方向），意向公司：XX 科技、ABC 云\n"
    "- 算法题表现好（LRU 一次通过），React 性能优化回答深度不足\n"
    "- 面试官追问\"useMemo 何时无效\"时未能答出依赖比较开销\n\n"
    "【待办事项】\n"
    "- [ ] 准备 React 性能优化的三层回答框架\n"
    "- [ ] 投递 ABC 云前端岗位\n\n"
    "【约束条件】\n"
    "- 只考虑北京地区，期望薪资 25-35k\n"
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
        "- **preference**: 用户的求职偏好、习惯（例如\"只考虑北京\"、\"期望薪资 25-35k\"、\"优先投大模型方向岗位\"、\"复盘报告要包含评分表\"）\n"
        "- **decision**: 对后续求职有持续指导意义的决策（例如\"决定放弃某公司，转投另一家\"、\"确定二面时间在周三\"）\n"
        "- **context**: 用户的静态背景信息（当前岗位方向、目标公司列表、面试进度、已拿到/已拒绝的 offer）\n\n"
        "严格不要提取：\n"
        "- 纯业务数据（某次面试的具体题目内容 — 这些应通过面试记录获取，不写入长期记忆）\n"
        "- 时效性信息（某天的面试安排 — 会过时，已有日程管理）\n"
        "- 一次性操作记录（\"已生成复盘报告\"、\"已投递某岗位\" — 下次对话已失效）\n"
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

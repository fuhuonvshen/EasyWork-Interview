"""场景注册表 —— Agent 能力隔离的唯一事实来源（fail-closed）。

「场景」是会话级的业务身份，决定三件事：
  1. role_prompt    角色提示词（叠加在 base_prompt 之上）
  2. context_kind   每轮注入的领域上下文类型（见 chat._scene_context_block）
  3. tools          该场景允许 LLM 调用的工具白名单；未登记的组合一律不可用

强制点有两处（双保险，缺一不可）：
  - 定义期 tools/registry.get_tool_definitions：只把白名单内的工具暴露给模型（模型看不到）
  - 执行期 tools/registry.execute_tool：模型幻觉出白名单外的调用名时直接拒绝（防越权）

新增工具时必须在 SCENES 里显式登记到允许它的场景；新增场景必须声明角色提示词、
上下文类型与工具白名单——否则该场景不会拿到任何工具。
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Callable

from .llm.prompt import answer_prompt, general_prompt, resume_prompt, review_prompt

logger = logging.getLogger("agent.scenes")


@dataclass(frozen=True)
class Scene:
    """一个会话场景的完整定义。"""

    name: str
    role_prompt: Callable[[], str]
    context_kind: str | None  # None | "interview" | "resume_answer" | "resume_advisor"
    tools: frozenset[str]
    # 是否注入「文件操作规则」（INPUT_DIR/OUTPUT_DIR 代码执行那套）。
    # 只给有文件/代码工作流的场景；纯问答场景注入会诱导模型输出伪代码假装执行。
    file_rules: bool = True


SCENES: dict[str, Scene] = {
    # 面试助手通用对话：可读面试记录；建待办/解析会议通知仅在用户明确要求时进行（写操作红线）
    "general": Scene(
        "general",
        general_prompt,
        None,
        frozenset({"interview_summary", "meeting_notice", "todo"}),
    ),
    # 复盘分析师：可以把提取的题目加入题库（来源=本场面试）
    "review": Scene(
        "review",
        review_prompt,
        "interview",
        frozenset({"question_bank", "interview_summary", "todo"}),
    ),
    # 简历顾问
    "resume": Scene(
        "resume",
        resume_prompt,
        "resume_advisor",
        frozenset({"todo"}),
    ),
    # 回答教练（题库「问问AI」）：纯问答场景，零工具、无文件规则
    "answer": Scene(
        "answer",
        answer_prompt,
        "resume_answer",
        frozenset(),
        file_rules=False,
    ),
}

DEFAULT_SCENE = "general"


def resolve_scene(stored_scene: str | None, conv_type: str | None) -> str:
    """解析会话场景：显式 scene 优先，其次会话 type，未知值降级为 general 并告警。"""
    for label, candidate in (("scene", stored_scene), ("type", conv_type)):
        value = (candidate or "").strip()
        if not value:
            continue
        if value in SCENES:
            return value
        logger.warning("未知会话场景(%s)=%r，按 %s 处理", label, value, DEFAULT_SCENE)
    return DEFAULT_SCENE


def tool_allowed(scene_name: str, tool_name: str) -> bool:
    """执行期校验：该场景是否允许调用该工具。"""
    return tool_name in SCENES[resolve_scene(scene_name, None)].tools

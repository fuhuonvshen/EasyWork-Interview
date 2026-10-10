"""Skill registry: scans src/agent/skills/ for SKILL.md files,
parses YAML frontmatter, and discovers handlers from the handlers/ package.

工具可见性与执行都按「场景」白名单强制（见 py_backend/scenes.py）：
  - get_tool_definitions(scene)：只暴露该场景白名单内的工具
  - execute_tool(..., scene=...)：执行期再校验一次，白名单外一律拒绝
"""

from __future__ import annotations

import yaml
import logging
from pathlib import Path

from ..config import SKILLS_DIR
from ..scenes import SCENES, resolve_scene, tool_allowed
from .handlers import HANDLERS, SCHEMAS as HANDLER_SCHEMAS

logger = logging.getLogger("agent.skills")



class SkillRegistry:
    """Holds registered skills and provides tool definitions + execution."""

    def __init__(self, skills: list[dict], base_dir: Path):
        self.skills = skills  # list of {"name": str, "description": str}
        self.base_dir = base_dir

    def get_tool_definitions(self, scene: str = "general") -> list[dict]:
        """Build tool definitions for the LLM API, scoped to a scene.

        fail-closed：只暴露该场景白名单内的工具；未在 scenes.py 登记的工具
        对任何场景都不可见。模型看不到工具，就不可能调用它（第一道防线）。

        Note: SKILL.md frontmatter description is only a human-readable fallback.
        When a HANDLER_SCHEMA exists, its description is what the LLM actually sees.
        So editing SKILL.md description has NO effect on LLM behavior if a SCHEMA exists.

        If a handler provides a custom SCHEMA, use it.
        Otherwise generate a default schema with a generic 'task' parameter.
        Also includes handler-only tools that lack a SKILL.md.
        """
        resolved = resolve_scene(scene, None)
        allowed = SCENES[resolved].tools

        seen: set[str] = set()
        result = []
        for s in self.skills:
            name = s["name"]
            if name not in allowed:
                continue
            seen.add(name)
            # Prefer handler-provided schema for precise parameter definitions
            if name in HANDLER_SCHEMAS:
                result.append(HANDLER_SCHEMAS[name])
            else:
                # Default fallback: generic task parameter
                if name in HANDLERS:
                    logger.warning(
                        "Handler '%s' has no SCHEMA — LLM will use generic 'task' params, "
                        "but handler expects structured arguments", name,
                    )
                result.append({
                    "type": "function",
                    "function": {
                        "name": name,
                        "description": s.get("description", ""),
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "task": {
                                    "type": "string",
                                    "description": "描述你需要用这个工具完成的具体任务",
                                }
                            },
                            "required": ["task"],
                        },
                    },
                })

        # Include handler-only tools (SCHEMA without SKILL.md)
        for name, schema in HANDLER_SCHEMAS.items():
            if name in allowed and name not in seen:
                result.append(schema)
                seen.add(name)

        logger.info("[skills] scene=%s 暴露工具: %s", resolved, sorted(seen) or ["无"])
        return result

    async def execute_tool(
        self,
        name: str,
        arguments: dict,
        *,
        scene: str = "general",
        ctx: dict | None = None,
    ) -> str | None:
        """Execute a tool by name with the given arguments.

        执行期场景校验（第二道防线）：即使模型幻觉出白名单外的工具名，
        也直接拒绝执行并返回说明，绝不落库/发请求。

        ctx: 执行上下文（scene / conversation_id / ref_id），透传给 handler。

        Returns the result text, or None if no handler is registered
        (caller should fall back to SKILL.md loading / code generation).
        """
        resolved = resolve_scene(scene, None)
        if not tool_allowed(resolved, name):
            logger.warning(
                "[security] scene=%s 试图调用未授权工具 '%s'（args=%s），已拒绝",
                resolved, name, str(arguments)[:200],
            )
            return f"⛔ 当前场景不允许调用工具 '{name}'，已拒绝执行。请基于已有信息直接回答。"

        handler = HANDLERS.get(name)
        if handler is None:
            return None
        try:
            return await handler(arguments, ctx or {})
        except Exception as e:
            logger.error("Handler '%s' failed: %s", name, e)
            return f"❌ 工具 '{name}' 执行失败: {e}"

    def load_skill_content(self, name: str) -> str | None:
        """Load SKILL.md content with YAML frontmatter stripped."""
        skill_md = self.base_dir / name / "SKILL.md"
        if not skill_md.exists():
            return None
        text = skill_md.read_text(encoding="utf-8")
        # Strip YAML frontmatter if present
        if text.startswith("---"):
            end = text.find("---", 3)
            if end != -1:
                text = text[end + 3:].lstrip("\n")
        return text


def parse_frontmatter(text: str) -> dict | None:
    """Parse YAML frontmatter from SKILL.md using safe_load."""

    lines = text.split("\n")
    if not lines or lines[0].strip() != "---":
        return None

    end = 0
    for i, line in enumerate(lines[1:], start=1):
        if line.strip() == "---":
            end = i
            break
    if not end:
        return None

    frontmatter = yaml.safe_load("\n".join(lines[1:end]))
    if isinstance(frontmatter, dict):
        return frontmatter
    return None


def load_skill_registry(skills_dir: str = SKILLS_DIR) -> SkillRegistry:
    """Scan skills_dir for SKILL.md files and build the registry."""
    base = Path(skills_dir)
    loaded: list[dict] = []

    if not base.exists():
        logger.warning("Skills directory not found: %s", base)
        return SkillRegistry([], base)

    for entry in sorted(base.iterdir()):
        if not entry.is_dir():
            continue
        skill_md = entry / "SKILL.md"
        if not skill_md.exists():
            continue
        try:
            text = skill_md.read_text(encoding="utf-8")
            fm = parse_frontmatter(text)
            if fm and fm.get("name"):
                name = fm["name"]
                desc = fm.get("description") or f"执行 {name} 工具"
                if not fm.get("description"):
                    logger.warning("Skill '%s' has no description in SKILL.md, using fallback", name)
                loaded.append({"name": name, "description": desc})
                logger.info("Loaded skill: %s", name)
        except Exception:
            logger.exception("Failed to parse %s", skill_md)

    logger.info("Loaded %d agent skills from %s", len(loaded), base)
    return SkillRegistry(loaded, base)

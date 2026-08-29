"""Skill registry: scans src/agent/skills/ for SKILL.md files,
parses YAML frontmatter, and discovers handlers from the handlers/ package.
"""

from __future__ import annotations

import yaml
import logging
from pathlib import Path

from ..config import SKILLS_DIR
from .handlers import HANDLERS, SCHEMAS as HANDLER_SCHEMAS

logger = logging.getLogger("agent.skills")


class SkillRegistry:
    """Holds registered skills and provides tool definitions + execution."""

    def __init__(self, skills: list[dict], base_dir: Path):
        self.skills = skills  # list of {"name": str, "description": str}
        self.base_dir = base_dir

    def get_tool_definitions(self) -> list[dict]:
        """Build tool definitions for the LLM API.

        Note: SKILL.md frontmatter description is only a human-readable fallback.
        When a HANDLER_SCHEMA exists, its description is what the LLM actually sees.
        So editing SKILL.md description has NO effect on LLM behavior if a SCHEMA exists.

        If a handler provides a custom SCHEMA, use it.
        Otherwise generate a default schema with a generic 'task' parameter.
        Also includes handler-only tools that lack a SKILL.md.
        """
        seen: set[str] = set()
        result = []
        for s in self.skills:
            name = s["name"]
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
            if name not in seen:
                result.append(schema)
                seen.add(name)
                logger.debug("Injected handler-only tool: %s", name)

        return result

    async def execute_tool(self, name: str, arguments: dict) -> str | None:
        """Execute a tool by name with the given arguments.

        Returns the result text, or None if no handler is registered
        (caller should fall back to SKILL.md loading / code generation).
        """
        handler = HANDLERS.get(name)
        if handler is None:
            return None
        try:
            return await handler(arguments)
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

"""Handler registry — auto-discovers handler modules in this package.
Each module that exports an `async def handle(args: dict) -> str` function
is automatically registered as a handler.

To add a new tool handler:
  1. Create <name>.py in this directory
  2. Export async def handle(args: dict) -> str
  3. (Optional) Export SCHEMA dict for custom tool definition
  4. Create matching src/agent/skills/<name>/SKILL.md with name + description
"""

import importlib
import logging
from pathlib import Path

logger = logging.getLogger("agent.handlers")

HANDLERS: dict[str, callable] = {}
SCHEMAS: dict[str, dict] = {}

# Auto-discover all .py files in this directory (except __init__)
_package_dir = Path(__file__).parent
for entry in sorted(_package_dir.iterdir()):
    if entry.suffix != ".py" or entry.stem == "__init__" or entry.stem.startswith("_"):
        continue
    modname = entry.stem
    try:
        module = importlib.import_module(f".{modname}", __package__)
        if hasattr(module, "handle"):
            HANDLERS[modname] = module.handle
            logger.info("Registered handler: %s", modname)
        if hasattr(module, "SCHEMA"):
            SCHEMAS[modname] = module.SCHEMA
    except Exception as e:
        logger.warning("Failed to load handler '%s': %s", modname, e)

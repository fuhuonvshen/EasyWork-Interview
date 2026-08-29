"""Database-backed LLM configuration overrides.

Updates config.py module attributes at startup so all imports see the DB values.
"""

import logging
import sys

logger = logging.getLogger("agent.db_config")


def _update_config(attr: str, value: str):
    """Set config.<attr> = value in the already-imported config module."""
    mod = sys.modules.get("py_backend.config")
    if mod and hasattr(mod, attr):
        old = getattr(mod, attr)
        setattr(mod, attr, value)
        logger.debug("  %s: %s -> %s", attr, repr(old)[:40], str(value)[:40])
    else:
        logger.warning("config.py has no attribute '%s' — DB setting skipped", attr)


async def load_llm_settings_from_db():
    """Load LLM settings from DB and update config.py attributes in-place.

    Called once at startup. Directly patches the config module so all
    subsequent imports (client.py, etc.) see the DB values without needing
    module reload or lazy accessors.
    """
    from ..data.database import db

    FIELD_MAP = {
        "agent_llm_backend": "LLM_BACKEND",
        "agent_online_key": "ONLINE_API_KEY",
        "agent_online_model": "ONLINE_MODEL",
        "agent_online_url": "ONLINE_BASE_URL",
    }

    # Translate frontend values to internal config values
    VALUE_MAP: dict[str, dict[str, str]] = {
        "LLM_BACKEND": {"local": "llamacpp", "online": "online"},
    }

    try:
        cursor = await db.conn.execute("SELECT key, value FROM settings")
        rows = await cursor.fetchall()
        count = 0
        for key, value in rows:
            attr = FIELD_MAP.get(key)
            if attr and value:
                # Translate frontend values (e.g. "local" → "llamacpp")
                translations = VALUE_MAP.get(attr, {})
                translated = translations.get(value, value)
                _update_config(attr, translated)
                count += 1
        if count:
            logger.info("Loaded %d settings from DB into config", count)
        else:
            logger.info("No LLM overrides found in DB settings")
    except Exception as e:
        logger.warning(
            "Failed to load settings from DB: %s — will use config.py defaults / env vars. "
            "Check that the 'settings' table exists and is populated.", e,
        )

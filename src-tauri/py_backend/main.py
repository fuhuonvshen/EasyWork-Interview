"""EasyWork Python Agent Server — FastAPI entry point.

Thin bootstrap: creates the app, configures lifespan, registers routes.
All logic lives in routes/, chat/, export/, handlers/, and other modules.
"""

import asyncio
import contextvars
import logging
import os
import uuid
from contextlib import asynccontextmanager
from logging.handlers import RotatingFileHandler
from pathlib import Path

from fastapi import FastAPI

import aiosqlite

from fastapi.responses import JSONResponse

from .config import AGENT_PORT, DB_PATH, LOG_FILE, MEMORIES_DIR
from .data.database import db
from .routes import ensure_docker_image, router
from .tools.registry import load_skill_registry
from .llm.memory import ensure_memories_file

request_id_var: contextvars.ContextVar[str] = contextvars.ContextVar("request_id", default="")


class RequestIDFilter(logging.Filter):
    """Inject request_id into every log record."""
    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id_var.get() or "-"
        return True


logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s [%(levelname)s] [%(request_id)s] %(name)s %(message)s",
    handlers=[
        RotatingFileHandler(LOG_FILE, maxBytes=10*1024*1024, backupCount=5, encoding="utf-8"),
        logging.StreamHandler(),
    ],
)

# Attach filter to root handlers — all loggers inherit from root
for handler in logging.getLogger().handlers:
    handler.addFilter(RequestIDFilter())

logger = logging.getLogger("agent")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info("Connecting to database: %s", DB_PATH)
    await db.connect()

    logger.info("Loading LLM config from database...")
    app.state.config_loaded = False
    from .data.db_config import load_llm_settings_from_db
    await load_llm_settings_from_db()
    app.state.config_loaded = True

    logger.info("Loading skills...")
    app.state.skill_registry = load_skill_registry()

    from .config import AGENT_INPUT_DIR, AGENT_OUTPUT_DIR
    await asyncio.to_thread(ensure_memories_file, Path(MEMORIES_DIR))
    os.makedirs(AGENT_INPUT_DIR, exist_ok=True)
    os.makedirs(AGENT_OUTPUT_DIR, exist_ok=True)

    # Non-blocking Docker sandbox image build
    app.state.docker_ready = False
    app.state.docker_building = False

    async def _build_docker():
        app.state.docker_building = True
        try:
            # Outer timeout (180s) is a safety net for the full flow including
            # check_available(). build_image() inside has its own 120s timeout.
            await asyncio.wait_for(ensure_docker_image(), timeout=180)
            app.state.docker_ready = True
        except asyncio.TimeoutError:
            logger.warning("Docker build timed out after 180s — will use subprocess")
        except Exception:
            logger.exception("Docker sandbox build failed — will use subprocess")
        finally:
            app.state.docker_building = False

    asyncio.create_task(_build_docker())

    logger.info("Agent server ready on port %s", AGENT_PORT)
    yield

    # Shutdown
    await db.close()
    logger.info("Agent server stopped")


app = FastAPI(title="EasyWork Agent Server", lifespan=lifespan)


@app.exception_handler(aiosqlite.Error)
async def db_error_handler(request, exc):
    logger.error("Database error: %s", exc, exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"error": "数据库操作失败，请稍后重试"},
    )


@app.middleware("http")
async def inject_request_id(request, call_next):
    rid = request.headers.get("X-Request-ID", uuid.uuid4().hex[:12])
    request_id_var.set(rid)
    response = await call_next(request)
    response.headers["X-Request-ID"] = rid
    return response


@app.get("/health")
async def health():
    """Health check — frontend can poll to confirm the agent is ready."""
    return {
        "status": "ok" if getattr(app.state, "config_loaded", False) else "degraded",
        "docker_ready": getattr(app.state, "docker_ready", False),
        "docker_building": getattr(app.state, "docker_building", False),
    }


app.include_router(router)


if __name__ == "__main__":
    # Required for multiprocessing (spawn) inside the PyInstaller bundle —
    # the code executor (tools/executor.py) uses it as the subprocess fallback.
    import multiprocessing

    multiprocessing.freeze_support()
    import uvicorn

    uvicorn.run("py_backend.main:app", host="127.0.0.1", port=AGENT_PORT, log_level="info")

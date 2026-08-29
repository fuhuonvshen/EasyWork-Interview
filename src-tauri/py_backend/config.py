"""EasyWork Agent Server configuration. All paths and settings are resolved at startup."""

import os
import sys
from pathlib import Path

_package_dir = Path(__file__).resolve().parent

# Load .env file if it exists (simple parser, no dependency needed)
_env_file = _package_dir / ".env"
if _env_file.exists():
    for _line in _env_file.read_text(encoding="utf-8").splitlines():
        _line = _line.strip()
        if _line and not _line.startswith("#") and "=" in _line:
            _key, _, _val = _line.partition("=")
            _key = _key.strip()
            _val = _val.strip().strip('"').strip("'")
            if _key not in os.environ:
                os.environ[_key] = _val

# Detect if running inside a PyInstaller bundle
_IN_BUNDLE = getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS")

# Server
AGENT_PORT = int(os.environ.get("AGENT_PORT", "9876"))

# LLM backend: "online" (OpenAI-compatible API) or "llamacpp" (local)
LLM_BACKEND = os.environ.get("LLM_BACKEND", "online")

# Online API (OpenAI-compatible: DeepSeek / 阿里云百炼 / OpenAI 等)
ONLINE_API_KEY = os.environ.get("ONLINE_API_KEY", "")
ONLINE_BASE_URL = os.environ.get("ONLINE_BASE_URL", "https://api.deepseek.com")
ONLINE_MODEL = os.environ.get("ONLINE_MODEL", "deepseek-chat")
ONLINE_TIMEOUT = int(os.environ.get("ONLINE_TIMEOUT", "180"))

# llama.cpp (OpenAI-compatible, built-in)
LLAMACPP_URL = os.environ.get("LLAMACPP_URL", "http://127.0.0.1:11435")
LLAMACPP_MODEL = os.environ.get("LLAMACPP_MODEL", "local")
LLAMACPP_TIMEOUT = int(os.environ.get("LLAMACPP_TIMEOUT", "300"))

# Shared
EXTRACTION_TIMEOUT = int(os.environ.get("EXTRACTION_TIMEOUT", "30"))

# ── Path resolution ──────────────────────────────────────────
#
# Two scenarios:
# 1. Dev / system-Python: AGENT_PROJECT_DIR is set by Rust to the local
#    project root. All paths resolve relative to it.
# 2. Bundled (PyInstaller) agent: AGENT_DATA_DIR is set by Rust to the
#    Tauri app data dir. Writable data (memories, input, output, tokens)
#    go under AGENT_DATA_DIR. Bundled resources (data, llm, tools) are
#    accessed via sys._MEIPASS.

_data_dir = os.environ.get("AGENT_DATA_DIR")  # Only set for bundled agent

if _IN_BUNDLE:
    # PyInstaller bundle: writable data goes to AGENT_DATA_DIR (app data)
    if _data_dir:
        _writable_root = Path(_data_dir)
    else:
        _writable_root = Path.home() / ".easywork"
    PROJECT_ROOT = _writable_root  # for backward compat, not heavily used in bundle
else:
    # Dev / system-Python: use AGENT_PROJECT_DIR from Rust
    _project_dir = os.environ.get("AGENT_PROJECT_DIR")
    if _project_dir:
        PROJECT_ROOT = Path(_project_dir)
    else:
        PROJECT_ROOT = _package_dir.parent

# SQLite database (shared with Rust)
DB_PATH = os.environ.get("AGENT_DB_PATH")
if not DB_PATH:
    _candidates = [
        PROJECT_ROOT / "easywork.db",
        PROJECT_ROOT / "app_data" / "easywork.db",
    ]
    for _c in _candidates:
        if _c.exists():
            DB_PATH = str(_c)
            break
    if not DB_PATH:
        DB_PATH = str(PROJECT_ROOT / "easywork.db")

# Skills directory (not bundled, will be empty in release → graceful fallback)
if _IN_BUNDLE and _data_dir:
    SKILLS_DIR = os.environ.get(
        "AGENT_SKILLS_DIR",
        str(Path(_data_dir) / "skills"),
    )
else:
    SKILLS_DIR = os.environ.get(
        "AGENT_SKILLS_DIR",
        str(PROJECT_ROOT / "src" / "agent" / "skills"),
    )

# Memories directory — use app data dir in bundle
if _IN_BUNDLE and _data_dir:
    MEMORIES_DIR = os.environ.get(
        "AGENT_MEMORIES_DIR",
        str(Path(_data_dir) / "memories"),
    )
else:
    MEMORIES_DIR = os.environ.get(
        "AGENT_MEMORIES_DIR",
        str(PROJECT_ROOT / "src" / "agent" / "memories"),
    )
MEMORY_FILE = "MEMORY.md"

# Agent input/output directories — use app data dir in bundle
if _IN_BUNDLE and _data_dir:
    AGENT_INPUT_DIR = os.environ.get(
        "AGENT_INPUT_DIR",
        str(Path(_data_dir) / "agent_input"),
    )
    AGENT_OUTPUT_DIR = os.environ.get(
        "AGENT_OUTPUT_DIR",
        str(Path(_data_dir) / "agent_output"),
    )
else:
    AGENT_INPUT_DIR = os.environ.get(
        "AGENT_INPUT_DIR",
        str(PROJECT_ROOT / "agent_input"),
    )
    AGENT_OUTPUT_DIR = os.environ.get(
        "AGENT_OUTPUT_DIR",
        str(PROJECT_ROOT / "agent_output"),
    )

# Log file — bundle 下 CWD 可能是只读根目录（macOS），必须写入数据目录
if _IN_BUNDLE and _data_dir:
    LOG_FILE = str(Path(_data_dir) / "agent_debug.log")
else:
    LOG_FILE = str(_package_dir.parent / "agent_debug.log")

# Docker sandbox
DOCKER_MODE = os.environ.get("DOCKER_MODE", "auto").lower()
DOCKER_IMAGE = os.environ.get("DOCKER_IMAGE", "easywork-sandbox:latest")
DOCKER_MEMORY_LIMIT = os.environ.get("DOCKER_MEMORY_LIMIT", "512m")
DOCKER_CPU_LIMIT = float(os.environ.get("DOCKER_CPU_LIMIT", "1.0"))
DOCKER_BUILD_TIMEOUT = int(os.environ.get("DOCKER_BUILD_TIMEOUT", "120"))

# Tool execution
TOOL_TIMEOUT = int(os.environ.get("TOOL_TIMEOUT", "120"))

# Email / Graph API
GRAPH_CLIENT_ID = os.environ.get("GRAPH_CLIENT_ID", "")
GRAPH_TENANT_ID = os.environ.get("GRAPH_TENANT_ID", "")
if _IN_BUNDLE and _data_dir:
    AGENT_TOKEN_DIR = os.environ.get(
        "AGENT_TOKEN_DIR",
        str(Path(_data_dir) / "agent_tokens"),
    )
else:
    AGENT_TOKEN_DIR = os.environ.get(
        "AGENT_TOKEN_DIR",
        str(PROJECT_ROOT / "agent_tokens"),
    )

# Agent behaviour
MAX_REACT_ITERATIONS = int(os.environ.get("AGENT_MAX_REACT", "10"))
KEEP_RECENT_COUNT = int(os.environ.get("AGENT_KEEP_RECENT", "8"))
COMPRESS_TRIGGER_TOKENS = int(os.environ.get("AGENT_COMPRESS_TOKENS", "20000"))

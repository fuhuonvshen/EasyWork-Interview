#!/usr/bin/env bash
# EasyWork - Build Python Agent executable directory (macOS / Linux)
# PyInstaller onedir: binaries/easywork-agent/easywork-agent + _internal/
# Mirror of build_agent.bat; note: --add-data uses ':' on Unix.
# Run after: pip install pyinstaller
set -euo pipefail
cd "$(dirname "$0")"

AGENT_NAME="easywork-agent"
OUT_DIR="binaries"

echo "==> Packaging Python Agent (EasyWork)..."
echo "    Output: ${OUT_DIR}/${AGENT_NAME}/"

# Clean old build
rm -f "${AGENT_NAME}.spec"
if [ -d "${OUT_DIR}/${AGENT_NAME}" ]; then
  rm -rf "${OUT_DIR}/${AGENT_NAME}"
fi
mkdir -p "${OUT_DIR}"

# Ensure PyInstaller is installed
pip install pyinstaller >/dev/null 2>&1 || true

# agent_launcher.py lives outside py_backend to avoid relative-import issues
pyinstaller --onedir \
    --name "${AGENT_NAME}" \
    --distpath "${OUT_DIR}" \
    --add-data "py_backend:py_backend" \
    --hidden-import uvicorn \
    --hidden-import uvicorn.logging \
    --hidden-import uvicorn.loops \
    --hidden-import uvicorn.loops.auto \
    --hidden-import uvicorn.protocols \
    --hidden-import uvicorn.protocols.http \
    --hidden-import uvicorn.protocols.http.auto \
    --hidden-import uvicorn.middleware \
    --hidden-import uvicorn.middleware.debug \
    --hidden-import httpx \
    --hidden-import aiosqlite \
    --collect-all tiktoken --collect-all tiktoken_ext \
    --hidden-import openpyxl \
    --hidden-import pandas \
    --hidden-import pydantic \
    --collect-all lxml \
    --hidden-import email.mime.text \
    --hidden-import email.mime.multipart \
    --hidden-import email.mime.base \
    --hidden-import py_backend.tools.sandbox \
    --hidden-import py_backend.tools.file_preview \
    --hidden-import py_backend.tools.handlers.email \
    --hidden-import py_backend.tools.handlers.execute_python \
    --hidden-import py_backend.tools.handlers.todo \
    --hidden-import py_backend.tools.handlers.xlsx \
    -p . \
    "agent_launcher.py"

echo "==> Build OK!"
echo "    Output dir: ${OUT_DIR}/${AGENT_NAME}/"
echo "    Main binary: ${OUT_DIR}/${AGENT_NAME}/${AGENT_NAME}"

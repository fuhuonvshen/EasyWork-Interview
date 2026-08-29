"""API routes — thin wrappers that delegate to chat, export, and database modules."""

import asyncio
import logging
import os
import shutil
import stat
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Query, Request
from fastapi.responses import StreamingResponse

from .llm import chat
from .config import AGENT_INPUT_DIR, DOCKER_BUILD_TIMEOUT, MEMORIES_DIR
from .data.database import db
from .export import render_export
from .data.models import (
    AgentConversationSummary,
    AgentMessage,
    AttachContentRequest,
    AttachFileRequest,
    ChatRequest,
    ChatResponse,
    CreateConversationResponse,
    DeleteRequest,
    ExportRequest,
    ExportResponse,
    OkResponse,
    RenameRequest,
)

logger = logging.getLogger("agent.routes")

router = APIRouter()


# ── Health ──────────────────────────────────────────────────


@router.get("/health")
async def health():
    return {"status": "ok"}


# ── Conversations CRUD ──────────────────────────────────────


@router.get("/list_conversations")
async def list_conversations() -> list[AgentConversationSummary]:
    rows = await db.list_conversations()
    return [AgentConversationSummary(**r) for r in rows]


@router.post("/create_conversation")
async def create_conversation() -> CreateConversationResponse:
    conv_id = await db.create_conversation()
    return CreateConversationResponse(id=conv_id)


@router.post("/delete_conversation")
async def delete_conversation(req: DeleteRequest) -> OkResponse:
    await db.delete_conversation(req.id)
    return OkResponse()


@router.post("/rename_conversation")
async def rename_conversation(req: RenameRequest) -> OkResponse:
    await db.rename_conversation(req.id, req.title)
    return OkResponse()


@router.get("/get_messages")
async def get_messages(conversation_id: str = Query(...)) -> list[AgentMessage]:
    rows = await db.get_messages(conversation_id)
    return [AgentMessage(**r) for r in rows]


# ── Chat ────────────────────────────────────────────────────


@router.post("/chat")
async def chat_endpoint(req: ChatRequest, request: Request) -> ChatResponse:
    skills = request.app.state.skill_registry
    return await chat.chat(req, skills)


@router.post("/chat/stream")
async def chat_stream_endpoint(req: ChatRequest, request: Request) -> StreamingResponse:
    skills = request.app.state.skill_registry
    return StreamingResponse(
        chat.chat_stream(req, skills),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── Export Report ───────────────────────────────────────────


@router.post("/export_report")
async def export_report(req: ExportRequest) -> ExportResponse:
    return await render_export(req.content, req.format)


# ── Attach File ─────────────────────────────────────────────

MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB


@router.post("/attach_file")
async def attach_file(req: AttachFileRequest) -> dict:
    raw = Path(req.file_path)
    resolved = raw.resolve()
    if not resolved.exists():
        return {"error": f"文件不存在: {req.file_path}"}
    if not resolved.is_file():
        return {"error": f"路径不是文件: {req.file_path}"}
    try:
        file_size = resolved.stat().st_size
    except OSError as e:
        return {"error": f"无法读取文件属性: {e}"}
    if file_size > MAX_FILE_SIZE:
        return {"error": f"文件过大 ({file_size / 1024 / 1024:.1f}MB)，上限 {MAX_FILE_SIZE / 1024 / 1024:.0f}MB"}
    logger.info("Attaching file: %s (resolved: %s, size: %.1fMB)", raw, resolved, file_size / 1024 / 1024)
    return await _process_file(req.conversation_id, resolved, None)


@router.post("/attach_content")
async def attach_content(req: AttachContentRequest) -> dict:
    return await _process_content(
        req.conversation_id,
        req.file_name,
        req.content,
        req.is_binary,
    )


# ── File processing helpers ────────────────────────────────


async def _process_file(conversation_id: str, path: Path, _raw_content: None) -> dict:
    from .tools.file_preview import read_excel_preview, read_csv_preview

    file_name = path.name or "unknown"
    ext = path.suffix.lower()
    try:
        _copy_to_input(path, AGENT_INPUT_DIR)
    except Exception as e:
        logger.error("Failed to copy %s to agent_input: %s", path, e)
        return {"error": f"无法复制文件到工作目录: {e}"}

    MAX_PREVIEW_CHARS = 30_000

    if ext == ".csv":
        content = read_csv_preview(str(path), file_name)
    elif ext in (".txt", ".md", ".json"):
        text = path.read_text(encoding="utf-8", errors="replace")
        total = len(text)
        if total > MAX_PREVIEW_CHARS:
            text = text[:MAX_PREVIEW_CHARS] + f"\n\n... (省略 {total - MAX_PREVIEW_CHARS} 字符，共 {total} 字符) ..."
        content = text
    elif ext in (".xlsx", ".xls", ".xlsm"):
        content = read_excel_preview(str(path))
    else:
        content = f"暂不支持 .{ext} 格式的文件"

    return await _persist_file_message(conversation_id, file_name, content)


async def _process_content(conversation_id: str, file_name: str, raw_content: str, is_binary: bool = False) -> dict:
    import base64

    ext = Path(file_name).suffix.lower()
    os.makedirs(AGENT_INPUT_DIR, exist_ok=True)
    dest = os.path.join(AGENT_INPUT_DIR, file_name)

    if is_binary:
        b64 = raw_content.split(",", 1)[-1] if "," in raw_content else raw_content
        data = base64.b64decode(b64)
        with open(dest, "wb") as f:
            f.write(data)
        from .tools.file_preview import read_excel_preview
        content = read_excel_preview(dest)
    elif ext in (".csv", ".txt", ".md", ".json"):
        with open(dest, "w", encoding="utf-8") as f:
            f.write(raw_content)
        lines = raw_content.splitlines()
        preview_lines = lines[:6]
        if len(lines) > 9:
            preview_lines.append(f"\n... (省略中间 {len(lines) - 9} 行) ...\n")
            preview_lines.extend(lines[-3:])
        content = f"=== {file_name} ({len(lines)} 行) ===\n\n" + "\n".join(preview_lines)
    else:
        content = f"暂不支持 .{ext} 格式的文件"

    return await _persist_file_message(conversation_id, file_name, content)


async def _persist_file_message(conversation_id: str, file_name: str, content: str) -> dict:
    from .llm.chat import _make_message

    attach_msg = _make_message(
        conversation_id, "user",
        f"[上传了文件: {file_name}]\n"
        f"上方仅为文件预览，可能已截断。完整文件保存在本地（agent_input 目录，文件名 {file_name}），"
        f"如需精确处理数据，请通过代码按需读取必要部分（如 `Path(INPUT_DIR) / '{file_name}'`）。\n\n"
        f"{content}",
    )
    await db.insert_message(attach_msg)
    await db.commit()
    await db.auto_title(conversation_id)
    return {"content": content}


def _copy_to_input(src: Path, input_dir: str) -> None:
    os.makedirs(input_dir, exist_ok=True)
    dest = os.path.join(input_dir, src.name)
    # 源文件已在工作目录时跳过复制——Windows 上 copy2 同路径会
    # 抛 PermissionError (WinError 32)，且复制自身毫无意义
    if os.path.normcase(os.path.abspath(str(src))) == os.path.normcase(os.path.abspath(dest)):
        logger.info("File already in agent_input: %s (skip copy)", src)
        return
    # copy2 会连源文件的只读属性一起复制（OneDrive/微信下载的文件常带只读
    # 标记），导致目标只读、下次同名上传覆盖时 Permission denied。先清只读
    # 再复制，复制后同样清一次（copy2 会再次带上只读属性）。
    if os.path.exists(dest):
        try:
            os.chmod(dest, stat.S_IWRITE)
        except OSError:
            pass
    shutil.copy2(str(src), dest)
    try:
        os.chmod(dest, stat.S_IWRITE)
    except OSError:
        pass
    logger.info("Copied %s -> %s", src, dest)


# ── Docker (called from lifespan) ──────────────────────────


async def ensure_docker_image():
    """Check Docker availability and build the sandbox image in the background."""
    from .tools.sandbox import get_sandbox

    try:
        sandbox = get_sandbox()
        available = await sandbox.check_available()
        if not available:
            logger.info("Docker not available — code execution will use subprocess fallback")
            return
        logger.info("Docker available, building sandbox image (timeout=%ds)...", DOCKER_BUILD_TIMEOUT)
        success = await sandbox.build_image()
        if success:
            logger.info("Docker sandbox image ready — future executions will use Docker")
        else:
            logger.warning("Docker image build failed — falling back to subprocess execution")
    except Exception:
        logger.exception("Unexpected error during Docker sandbox setup")

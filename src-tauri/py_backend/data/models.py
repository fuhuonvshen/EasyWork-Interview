"""Pydantic models for request/response schemas."""

from __future__ import annotations

from pydantic import BaseModel


# ── Request models ──

class ChatRequest(BaseModel):
    conversation_id: str
    message: str


class AttachFileRequest(BaseModel):
    conversation_id: str
    file_path: str


class AttachContentRequest(BaseModel):
    conversation_id: str
    file_name: str
    content: str
    is_binary: bool = False


class DeleteRequest(BaseModel):
    id: str


class RenameRequest(BaseModel):
    id: str
    title: str


class CreateConversationRequest(BaseModel):
    type: str = "general"   # "general" | "mock" | "review" | "resume"
    ref_id: str | None = None


class UpdateConversationMetaRequest(BaseModel):
    id: str
    type: str = "general"
    ref_id: str | None = None


# ── Response models ──

class ChatResponse(BaseModel):
    content: str


class CreateConversationResponse(BaseModel):
    id: str


class OkResponse(BaseModel):
    ok: bool = True


class AgentConversationSummary(BaseModel):
    id: str
    title: str
    created_at: str
    last_message: str | None = None
    type: str = "general"
    ref_id: str | None = None


class AgentMessage(BaseModel):
    id: str
    conversation_id: str
    role: str
    content: str
    tool_calls: str | None = None
    created_at: str


class ExportRequest(BaseModel):
    content: str
    format: str  # "docx", "pdf", "png"


class ExportResponse(BaseModel):
    data: str  # base64 encoded file content
    filename: str


# ── Internal models ──

class MemoryEntry(BaseModel):
    category: str
    title: str
    content: str

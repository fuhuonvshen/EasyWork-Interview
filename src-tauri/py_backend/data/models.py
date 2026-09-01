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
    type: str = "general"   # "general" | "review" | "resume"
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


# ── 投递记录同步（OfferSubmit 扩展 ↔ EasyWork）──

class ApplyRecordModel(BaseModel):
    """投递记录（与 Rust apply_records 表字段一致）。"""
    id: str
    company: str
    position: str = ""
    url: str = ""
    site: str = ""
    status: str = "pending"  # pending/applied/interview/offer/rejected/archived
    notes: str = ""
    applied_at: int = 0
    updated_at: int = 0


class ApplyPushRequest(BaseModel):
    """扩展推送给 EasyWork 的投递记录增量（全量 + 删除墓碑）。"""
    records: list[ApplyRecordModel] = []
    tombstones: list[str] = []


class ResumeTemplateResponse(BaseModel):
    """EasyWork 简历 → OfferSubmit 填充模板 + 来源信息。

    custom_fields：模板用到的自定义组件定义（label + keywords），
    扩展同步后存入 settings.customFields 供填充匹配。
    """
    template: dict | None
    source: dict | None  # {file_name, created_at, has_fields}
    custom_fields: list[dict] = []

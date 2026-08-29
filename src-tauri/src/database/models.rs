// EasyWork - 数据库结构定义
// 三张表：meetings（会议）、transcripts（转写）、minutes（纪要）
// 使用 SQLite，通过 sqlx 操作。

use serde::{Deserialize, Serialize};
use sqlx::FromRow;

/// A meeting record.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Meeting {
    pub id: String,
    pub title: String,
    pub created_at: String,   // ISO 8601
    pub duration_secs: i64,
    pub wav_path: String,
    pub schedule_id: Option<String>,
    pub pinned: bool,
}

/// Transcript linked to a meeting.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Transcript {
    pub id: String,
    pub meeting_id: String,
    pub content: String,
    pub created_at: String,
    pub live_transcript: Option<String>,  // JSON array of {speaker, text, start} chunks
    pub segments: Option<String>,         // JSON array of {start, end, text} (final transcription)
}

/// Meeting minutes linked to a meeting.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Minutes {
    pub id: String,
    pub meeting_id: String,
    pub content: String,
    pub created_at: String,
}

/// A scheduled meeting (calendar entry with optional Zoom link).
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ScheduledMeeting {
    pub id: String,
    pub title: String,
    pub zoom_url: String,
    pub start_time: String,
    pub end_time: String,
    pub created_at: String,
}

/// Summary row for the sidebar list.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct MeetingSummary {
    pub id: String,
    pub title: String,
    pub created_at: String,
    pub has_minutes: bool,
    pub first_line: Option<String>,
    pub pinned: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct PaginatedMeetings {
    pub items: Vec<MeetingSummary>,
    pub total: i64,
    pub page: i64,
    pub page_size: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Report {
    pub id: String,
    pub period_type: String,  // "week" or "month"
    pub period_label: String, // e.g. "2026-W27" or "2026-07"
    pub content: String,
    pub created_at: String,
}

/// Agent conversation session.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct AgentConversation {
    pub id: String,
    pub title: String,
    pub summary: String,
    pub created_at: String,
}

/// Agent conversation message.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct AgentMessage {
    pub id: String,
    pub conversation_id: String,
    pub role: String,   // "user" | "assistant" | "system" | "tool"
    pub content: String,
    pub tool_calls: Option<String>,  // JSON
    pub created_at: String,
}

/// Summary row for sidebar conversation list.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct AgentConversationSummary {
    pub id: String,
    pub title: String,
    pub created_at: String,
    pub last_message: Option<String>,
}

/// A todo/task item.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct TodoItem {
    pub id: String,
    pub title: String,
    pub status: String,     // "pending" | "done"
    pub priority: String,   // "high" | "medium" | "low"
    pub deadline: Option<String>,
    pub source: String,     // "chat" | "meeting" | "manual"
    pub created_at: String,
    pub schedule_id: Option<String>,  // links to scheduled_meetings.id
}

/// Meeting detail returned by get_meeting (title + minutes content + audio path).
#[derive(Debug, Clone, Serialize)]
pub struct MeetingDetail {
    pub id: String,
    pub title: String,
    pub content: String,
    pub wav_path: String,
}

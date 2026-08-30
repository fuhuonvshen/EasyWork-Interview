// EasyWork - 数据库结构定义
// 三张表：meetings（会议）、transcripts（转写）、minutes（纪要）
// 使用 SQLite，通过 sqlx 操作。

use serde::{Deserialize, Serialize};
use sqlx::FromRow;

/// A meeting record. `kind` distinguishes 面试 (interview) from 会议 (meeting);
/// interview-specific fields (company/position/stage/score) are optional.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Meeting {
    pub id: String,
    pub title: String,
    pub created_at: String,   // ISO 8601
    pub duration_secs: i64,
    pub wav_path: String,
    pub schedule_id: Option<String>,
    pub pinned: bool,
    pub kind: String,         // "meeting" | "interview"
    pub company: Option<String>,
    pub position: Option<String>,
    pub stage: Option<String>, // "phone" | "online" | "onsite" | "mock" | "offer"
    pub score: Option<i64>,    // AI 评估总分 0-100
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
/// `stage` carries the interview stage for interview schedules.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ScheduledMeeting {
    pub id: String,
    pub title: String,
    pub zoom_url: String,
    pub start_time: String,
    pub end_time: String,
    pub created_at: String,
    pub stage: String, // "hr" | "one" | "two" | "three"
    pub company: String,
    pub position: String,
    pub notes: String,
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
    pub kind: String,
    pub company: Option<String>,
    pub position: Option<String>,
    pub stage: Option<String>,
    pub score: Option<i64>,
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
    #[serde(rename = "type")]
    pub kind: String,        // "general" | "review" | "resume"
    pub ref_id: Option<String>, // 关联面试/简历 ID（上下文注入）
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
    #[serde(rename = "type")]
    pub kind: String,        // "general" | "review" | "resume"
    pub ref_id: Option<String>,
}

/// 面试题库条目（interview_questions 表）— AI 从面试转写中提取的面试官问题。
/// source_meeting_id 标记来源面试；in_bank=false 表示"待用户确认入题库"（勾选后置 true）。
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct InterviewQuestion {
    pub id: String,
    pub category: String,   // "算法" | "数据库" | "前端" | "项目" | "HR" ...
    pub difficulty: String, // "easy" | "medium" | "hard"
    pub question: String,
    pub expected_answer: Option<String>,
    pub created_at: String,
    pub source_meeting_id: Option<String>,
    pub in_bank: bool,
}

/// 面试评估（interview_assessments 表）— AI 结构化输出落库
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct InterviewAssessment {
    pub id: String,
    pub interview_id: String, // FK → meetings.id
    pub dimensions: String,   // JSON {专业技能,沟通表达,逻辑思维,岗位匹配,潜力}
    pub score: Option<i64>,
    pub summary: Option<String>,
    pub created_at: String,
}

/// 我的简历（resumes 表）— 全局资产，最新一条为当前简历
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Resume {
    pub id: String,
    pub file_name: String,
    pub content: String,
    pub created_at: String,
    /// AI 提取的结构化字段（JSON 字符串），如姓名/教育/工作经历等
    pub fields: Option<String>,
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
    pub kind: String,
    pub company: Option<String>,
    pub position: Option<String>,
    pub stage: Option<String>,
    pub score: Option<i64>,
}

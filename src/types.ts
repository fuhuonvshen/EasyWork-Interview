// EasyWork - TypeScript type definitions

export interface AudioDevice {
  id: string;
  name: string;
  is_default: boolean;
}

export interface MeetingRow {
  id: string;
  title: string;
  created_at: string;
  has_minutes: boolean;
  first_line: string | null;
  pinned: boolean;
  // 面试语义（Phase 1 新增）
  kind: string;              // "meeting" | "interview"
  company: string | null;
  position: string | null;
  stage: string | null;      // "phone" | "online" | "onsite" | "mock" | "offer"
  score: number | null;      // AI 评估总分 0-100
}

export interface InterviewAssessment {
  id: string;
  interview_id: string;
  dimensions: string;        // JSON {专业技能,沟通表达,逻辑思维,岗位匹配,发展潜力}
  score: number | null;
  summary: string | null;
  created_at: string;
}

export interface InterviewQuestion {
  id: string;
  category: string;
  difficulty: string;        // "easy" | "medium" | "hard"
  question: string;
  expected_answer: string | null;
  created_at: string;
  source_meeting_id: string | null;  // 来源面试（提取的题目）
  in_bank: boolean;                  // 是否已加入题库（false=待用户确认）
}

export interface ScheduledMeeting {
  id: string;
  title: string;
  zoom_url: string;
  start_time: string;
  end_time: string;
  created_at: string;
  stage: string;             // "apply" | "phone" | "online" | "onsite" | "offer"
}

export type ModelStatus =
  | "Available"
  | "Missing"
  | { Downloading: number }
  | { Error: string };

export interface ModelInfo {
  name: string;
  size_bytes: number;
  size_display: string;
  downloaded: boolean;
  is_recommended: boolean;
  has_partial: boolean;
  partial_bytes: number;
  status?: ModelStatus;
}

export type MinutesTab = "today" | "history" | "schedule" | "reports";

// Agent types
export type AgentConversationType = "general" | "mock" | "review" | "resume";

export interface AgentConversationSummary {
  id: string;
  title: string;
  created_at: string;
  last_message: string | null;
  type: AgentConversationType;  // 角色类型
  ref_id: string | null;        // 关联面试/简历 ID
}

export interface ReportItem {
  id: string;
  period_type: string;
  period_label: string;
  content: string;
}

export interface AgentMessage {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system" | "tool" | "thinking";
  content: string;
  tool_calls: string | null;
  created_at: string;
}

export type AgentStreamEvent =
  | { type: "plan"; conversation_id: string; delta: string }
  | { type: "thinking"; conversation_id: string; delta: string }
  | { type: "answer"; conversation_id: string; delta: string }
  | { type: "tool"; conversation_id: string; name: string; status: "executing" }
  | { type: "tool_result"; conversation_id: string; name: string; status: "done" | "error" | "timeout" }
  | { type: "error"; conversation_id: string; message: string }
  | { type: "done"; conversation_id: string; tool_calls_used: string[] };

export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface TodoItem {
  id: string;
  title: string;
  status: string;     // "pending" | "done"
  priority: string;   // "high" | "medium" | "low"
  deadline: string | null;
  source: string;     // "chat" | "meeting" | "manual"
  created_at: string;
}

// ── Model download dialog types ──

export interface SpeechModelEntry {
  name: string;
  displayName: string;
  size_display: string;
  downloaded: boolean;
  is_recommended: boolean;
  kind: "whisper" | "sensevoice";
}

export interface LlmModelEntry {
  name: string;
  display_name: string;
  size_display: string;
  downloaded: boolean;
  is_recommended: boolean;
  is_loaded: boolean;
}

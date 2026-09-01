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
  stage: string | null;      // "hr" | "one" | "two" | "three"
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

export interface Resume {
  id: string;
  file_name: string;
  content: string;
  created_at: string;
  fields: string | null;  // AI 提取的结构化字段（JSON 字符串）
}

export interface ResumeEducation {
  school: string; major: string; degree: string; start_time: string; end_time: string;
}
export interface ResumeWork {
  company: string; position: string; start_time: string; end_time: string; description: string;
}
export interface ResumeProject {
  name: string; role: string; start_time: string; end_time: string; description: string;
}
export interface ResumeFields {
  name: string; phone: string; email: string; gender: string; age: string;
  education: ResumeEducation[];
  work_experience: ResumeWork[];
  projects: ResumeProject[];
  skills: string[];
  job_intention: { position: string; salary_expectation: string; location: string };
  summary: string;
}

// ── 投递记录（投递工作台 ↔ OfferSubmit 扩展双向同步）──

export type ApplyStatus = "pending" | "applied" | "interview" | "offer" | "rejected" | "archived";

export const APPLY_STATUS_LABELS: Record<ApplyStatus, string> = {
  pending: "待投递",
  applied: "已投递",
  interview: "面试中",
  offer: "已拿Offer",
  rejected: "未通过",
  archived: "已归档",
};

export const APPLY_STATUS_COLORS: Record<ApplyStatus, string> = {
  pending: "bg-gray-100 text-gray-600",
  applied: "bg-blue-50 text-blue-600",
  interview: "bg-purple-50 text-purple-600",
  offer: "bg-emerald-50 text-emerald-600",
  rejected: "bg-red-50 text-red-500",
  archived: "bg-gray-200 text-gray-500",
};

export interface ApplyRecord {
  id: string;
  company: string;
  position: string;
  url: string;
  site: string;
  status: ApplyStatus;
  notes: string;
  applied_at: number;  // epoch ms
  updated_at: number;  // epoch ms（同步合并的新者胜依据）
}

// ── 公司库（内置清单 + 用户自定义）──

export interface Company {
  id: string;
  name: string;
  industry: string;   // 业务类型
  url: string;        // 招聘网站
  builtin: boolean;   // 是否内置清单
  created_at: string;
}

export interface ScheduledMeeting {
  id: string;
  title: string;
  zoom_url: string;
  start_time: string;
  end_time: string;
  created_at: string;
  stage: string;             // "hr" | "one" | "two" | "three"
  company: string;           // AI 从会议通知提取
  position: string;          // AI 从会议通知提取
  notes: string;             // 其他要点（面试官/准备材料等）
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
export type AgentConversationType = "general" | "review" | "resume";

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

// EasyWork - Agent Todo List View
import { useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ListTodo, Plus, Trash2, AlertCircle, Mail, Loader } from "lucide-react";
import type { TodoItem, EmailPending } from "../types";
import { showToast } from "../components/Toast";
import { ERRORS, toUserError } from "../errors";

// 截止时间字段：与会议记录列表的 DateField 一致——原生 input 隐藏，
// 按钮触发系统日历，显示层统一 YYYY-MM-DD（避免系统 "yyyy/mm/日" 格式）
function DeadlineField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="relative">
      <input
        ref={inputRef}
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label="截止时间"
        className="sr-only"
      />
      <button
        type="button"
        onClick={() => {
          const el = inputRef.current;
          if (!el) return;
          try {
            el.showPicker();
          } catch {
            el.click();
          }
        }}
        className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white hover:bg-gray-50 transition-colors"
      >
        {value ? <span className="text-gray-700">{value}</span> : <span className="text-gray-400">选择日期</span>}
      </button>
    </div>
  );
}

interface Props {
  todos: TodoItem[];
  pendingEmails: EmailPending[];  // AI 识别出的求职邮件（待确认，确认后才建待办）
  onRefresh: () => void;
  onToggle: (id: string, done: boolean) => void;
  onDelete: (id: string) => void;
  onEmailConfirm: (id: string, overrides: { title: string; deadline: string | null }) => void;
  onEmailIgnore: (id: string) => void;
}

export default function AgentTodo({
  todos, pendingEmails, onRefresh, onToggle, onDelete, onEmailConfirm, onEmailIgnore,
}: Props) {
  const [showForm, setShowForm] = useState(false);
  const [formTitle, setFormTitle] = useState("");
  const [formDeadline, setFormDeadline] = useState("");
  const [formPriority, setFormPriority] = useState("medium");

  // 待确认邮件的可编辑草稿（事项标题 / 截止日期）
  const [emailDrafts, setEmailDrafts] = useState<Record<string, { title: string; deadline: string }>>({});
  const [confirmingEmail, setConfirmingEmail] = useState<string | null>(null);

  const draftOf = (p: EmailPending) => emailDrafts[p.id] ?? { title: p.ai_title, deadline: p.ai_deadline ?? "" };
  const setDraftOf = (id: string, patch: Partial<{ title: string; deadline: string }>) => {
    setEmailDrafts((prev) => ({
      ...prev,
      [id]: { ...(prev[id] ?? { title: "", deadline: "" }), ...patch },
    }));
  };

  const pendingTodos = todos.filter((t) => t.status === "pending");
  const doneTodos = todos.filter((t) => t.status === "done");

  const handleCreate = async () => {
    if (!formTitle.trim()) return;
    try {
      const params: Record<string, unknown> = {
        title: formTitle.trim(),
        priority: formPriority,
        source: "manual",
      };
      if (formDeadline) params.deadline = formDeadline;
      await invoke("todo_create", params);
      setFormTitle("");
      setFormDeadline("");
      setFormPriority("medium");
      setShowForm(false);
      onRefresh();
    } catch (e) {
      console.error("创建待办失败:", e);
      showToast(toUserError(ERRORS.CREATE_TODO, e), "error");
    }
  };

  const handleEmailAdd = async (p: EmailPending) => {
    const d = draftOf(p);
    if (!d.title.trim()) {
      showToast("待办内容不能为空", "error");
      return;
    }
    setConfirmingEmail(p.id);
    try {
      await onEmailConfirm(p.id, { title: d.title.trim(), deadline: d.deadline || null });
    } finally {
      setConfirmingEmail(null);
    }
  };

  const handleEmailDrop = async (p: EmailPending) => {
    setConfirmingEmail(p.id);
    try {
      await onEmailIgnore(p.id);
    } finally {
      setConfirmingEmail(null);
    }
  };

  const priorityColor = (p: string) => {
    switch (p) {
      case "high": return "text-red-600 bg-red-50";
      case "medium": return "text-amber-600 bg-amber-50";
      default: return "text-gray-500 bg-gray-50";
    }
  };

  const priorityLabel = (p: string) => {
    switch (p) {
      case "high": return "高";
      case "medium": return "中";
      default: return "低";
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <header className="px-8 py-6 border-b border-gray-100 bg-white flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <ListTodo size={20} className="text-emerald-500" />
            <h2 className="text-2xl font-semibold text-gray-900">待办事项</h2>
            {pendingTodos.length > 0 && (
              <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-medium">
                {pendingTodos.length} 项待完成
              </span>
            )}
          </div>
          <p className="text-sm text-gray-400 mt-1">管理你的任务和提醒</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 text-white text-sm font-medium rounded-xl hover:bg-emerald-700 active:scale-95 transition-all"
        >
          <Plus size={16} />
          新建待办
        </button>
      </header>

      {/* Create form */}
      {showForm && (
        <div className="px-8 py-4 border-b border-gray-100 bg-gray-50/50">
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <label className="text-xs font-medium text-gray-500 mb-1 block">待办内容</label>
              <input
                type="text"
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
                placeholder="输入待办内容..."
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300"
                autoFocus
                onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }}
              />
            </div>
            <div className="w-36">
              <label className="text-xs font-medium text-gray-500 mb-1 block">截止时间</label>
              <DeadlineField value={formDeadline} onChange={setFormDeadline} />
            </div>
            <div className="w-24">
              <label className="text-xs font-medium text-gray-500 mb-1 block">优先级</label>
              <select
                value={formPriority}
                onChange={(e) => setFormPriority(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300"
              >
                <option value="high">高</option>
                <option value="medium">中</option>
                <option value="low">低</option>
              </select>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setShowForm(false)}
                className="px-4 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleCreate}
                disabled={!formTitle.trim()}
                className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-40 transition-colors"
              >
                创建
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Todo list */}
      <div className="flex-1 overflow-y-auto px-8 py-4">
        {/* 求职邮件待确认（AI 识别，确认后才成为待办） */}
        {pendingEmails.length > 0 && (
          <section className="mb-6">
            <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <Mail size={13} className="text-sky-500" />
              求职邮件待确认 · {pendingEmails.length}
              <span className="text-[10px] normal-case text-gray-300 font-normal">AI 已识别为求职相关，核对后添加；邮件原文不会保存</span>
            </h3>
            <div className="space-y-2">
              {pendingEmails.map((p) => {
                const draft = draftOf(p);
                const busy = confirmingEmail === p.id;
                return (
                  <div
                    key={p.id}
                    className={`px-4 py-3 rounded-xl border border-sky-100 bg-sky-50/40 space-y-3 ${busy ? "opacity-60" : ""}`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-sky-100 text-sky-600 flex items-center justify-center flex-shrink-0">
                        <Mail size={14} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-gray-800 truncate">{p.subject || "(无主题)"}</p>
                        <p className="text-[10px] text-gray-400 truncate">
                          {p.from_addr || "未知发件人"} · {p.received_at.slice(0, 10) || "时间未知"}
                        </p>
                      </div>
                      <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full flex-shrink-0 ${priorityColor(p.ai_priority)}`}>
                        {priorityLabel(p.ai_priority)}
                      </span>
                    </div>
                    <div className="flex gap-2.5 items-end">
                      <div className="flex-1 min-w-0">
                        <label className="text-[10px] font-medium text-gray-500 mb-1 block">将添加为待办（可修改）</label>
                        <input
                          type="text"
                          value={draft.title}
                          onChange={(e) => setDraftOf(p.id, { title: e.target.value })}
                          className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-sky-200"
                        />
                      </div>
                      <div className="w-40 flex-shrink-0">
                        <label className="text-[10px] font-medium text-gray-500 mb-1 block">截止日期</label>
                        <DeadlineField
                          value={draft.deadline}
                          onChange={(v) => setDraftOf(p.id, { deadline: v })}
                        />
                      </div>
                      <div className="flex gap-2 flex-shrink-0">
                        <button
                          onClick={() => handleEmailAdd(p)}
                          disabled={busy}
                          className="px-4 py-2 text-xs font-semibold text-white bg-sky-600 rounded-lg hover:bg-sky-700 disabled:opacity-50 transition-colors"
                        >
                          {busy ? <Loader size={12} className="inline animate-spin" /> : null}
                          加入待办
                        </button>
                        <button
                          onClick={() => handleEmailDrop(p)}
                          disabled={busy}
                          className="px-3 py-2 text-xs text-gray-400 hover:text-gray-600 hover:bg-white rounded-lg transition-colors disabled:opacity-50"
                        >
                          忽略
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Pending */}
        {pendingTodos.length > 0 && (
          <div className="mb-6">
            <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-3">
              待完成 · {pendingTodos.length}
            </h3>
            <div className="space-y-2">
              {pendingTodos.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center gap-4 px-5 py-4 rounded-xl bg-white border border-gray-100 shadow-sm hover:shadow-md hover:border-emerald-200 transition-all group"
                >
                  <input
                    type="checkbox"
                    checked={false}
                    onChange={() => onToggle(t.id, true)}
                    className="w-5 h-5 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 flex-shrink-0 cursor-pointer"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900">{t.title}</p>
                    <div className="flex items-center gap-2 mt-1">
                      {t.deadline && (
                        <span className="text-xs text-gray-400">
                          截止: {t.deadline}
                        </span>
                      )}
                      {t.source === "email" && (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-sky-50 text-sky-600 border border-sky-200 flex items-center gap-1">
                          <Mail size={9} /> 来自邮件
                        </span>
                      )}
                      {t.source === "chat" && (
                        <span className="text-xs text-gray-300">来自对话</span>
                      )}
                    </div>
                  </div>
                  <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full flex-shrink-0 ${priorityColor(t.priority)}`}>
                    {priorityLabel(t.priority)}
                  </span>
                  <button
                    onClick={() => onDelete(t.id)}
                    className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
                    title="删除"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Done */}
        {doneTodos.length > 0 && (
          <div>
            <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-3">
              已完成 · {doneTodos.length}
            </h3>
            <div className="space-y-1.5">
              {doneTodos.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center gap-4 px-5 py-3 rounded-xl bg-gray-50 border border-gray-100 group"
                >
                  <input
                    type="checkbox"
                    checked={true}
                    onChange={() => onToggle(t.id, false)}
                    className="w-5 h-5 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 flex-shrink-0 cursor-pointer"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-400 line-through">{t.title}</p>
                  </div>
                  <button
                    onClick={() => onDelete(t.id)}
                    className="p-1 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
                    title="删除"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {todos.length === 0 && pendingEmails.length === 0 && !showForm && (
          <div className="text-center py-16">
            <div className="w-14 h-14 rounded-2xl bg-gray-100 flex items-center justify-center mx-auto mb-4">
              <ListTodo size={26} className="text-gray-300" />
            </div>
            <p className="text-sm text-gray-400">还没有待办事项</p>
            <p className="text-xs text-gray-300 mt-1">在聊天中说"帮我记一下…"或手动创建</p>
          </div>
        )}

        {todos.length > 0 && pendingTodos.length === 0 && doneTodos.length > 0 && (
          <div className="text-center py-8">
            <AlertCircle size={20} className="text-emerald-400 mx-auto mb-2" />
            <p className="text-sm text-gray-400">所有待办都已完成！</p>
          </div>
        )}
      </div>
    </div>
  );
}

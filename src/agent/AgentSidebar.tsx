// EasyWork - 面试助手 sidebar (conversation list grouped by role + todo list)
import { useState } from "react";
import { ArrowLeft, MessageSquare, Plus, X, Pencil, Check, ListTodo, Trash2, Sparkles } from "lucide-react";
import type { AgentConversationSummary, AgentConversationType, TodoItem } from "../types";

// 角色元信息：展示名 / 图标 / 徽标样式
export const ROLE_META: Record<AgentConversationType, { label: string; icon: string; badge: string; iconBg: string }> = {
  mock: { label: "模拟面试", icon: "🎯", badge: "bg-violet-50 text-violet-700 border-violet-200", iconBg: "bg-violet-100" },
  review: { label: "复盘分析", icon: "🔍", badge: "bg-emerald-50 text-emerald-700 border-emerald-200", iconBg: "bg-emerald-100" },
  resume: { label: "简历顾问", icon: "📄", badge: "bg-amber-50 text-amber-700 border-amber-200", iconBg: "bg-amber-100" },
  general: { label: "通用助手", icon: "💬", badge: "bg-sky-50 text-sky-700 border-sky-200", iconBg: "bg-sky-100" },
};

const GROUP_ORDER: AgentConversationType[] = ["mock", "review", "resume", "general"];

interface Props {
  conversations: AgentConversationSummary[];
  activeId: string | null;
  activeSubView: "chat" | "todo";
  todos: TodoItem[];
  onSelect: (id: string) => void;
  onNew: () => void;               // 打开角色选择器
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onBack: () => void;
  onSubViewChange: (view: "chat" | "todo") => void;
  onTodoToggle: (id: string, done: boolean) => void;
  onTodoDelete: (id: string) => void;
}

export default function AgentSidebar({
  conversations, activeId, activeSubView, todos,
  onSelect, onNew, onDelete, onRename, onBack,
  onSubViewChange, onTodoToggle, onTodoDelete,
}: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const pendingTodos = todos.filter((t) => t.status === "pending").length;

  // 按角色分组
  const grouped = GROUP_ORDER
    .map((type) => ({ type, items: conversations.filter((c) => (c.type || "general") === type) }))
    .filter((g) => g.items.length > 0);

  return (
    <aside className="w-60 bg-white rounded-lg overflow-hidden flex flex-col flex-shrink-0">
      <div className="px-4 py-4">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-700 transition-colors mb-2"
        >
          <ArrowLeft size={14} />
          返回工作台
        </button>
        <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
          面试助手
          <span className="w-5 h-5 rounded-lg bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center">
            <Sparkles size={11} className="text-white" />
          </span>
        </h1>
        <p className="text-xs text-gray-400 mt-0.5">模拟面试 · 复盘 · 简历 · 问答</p>

        {/* View tabs */}
        <div className="flex gap-1 mt-3 bg-gray-100 rounded-lg p-0.5">
          <button
            onClick={() => onSubViewChange("chat")}
            className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-medium rounded-md transition-colors ${
              activeSubView === "chat"
                ? "bg-white text-emerald-700 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            <MessageSquare size={12} />
            对话
          </button>
          <button
            onClick={() => onSubViewChange("todo")}
            className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-medium rounded-md transition-colors ${
              activeSubView === "todo"
                ? "bg-white text-emerald-700 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            <ListTodo size={12} />
            待办
            {pendingTodos > 0 && (
              <span className="bg-emerald-500 text-white text-[10px] rounded-full px-1.5 py-0.5">
                {pendingTodos}
              </span>
            )}
          </button>
        </div>
      </div>

      <div className="flex-1 px-2 py-3 overflow-y-auto">
        {activeSubView === "chat" && (
          <>
            <button
              onClick={onNew}
              className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-emerald-500 to-teal-500 shadow-md shadow-emerald-500/25 hover:shadow-lg hover:shadow-emerald-500/30 hover:-translate-y-px active:scale-[0.98] transition-all"
            >
              <Plus size={16} />
              新建对话 · 选角色
            </button>

            {grouped.length === 0 && (
              <p className="text-xs text-gray-400 text-center py-8 px-2 leading-relaxed">
                还没有对话<br />点击上方选择角色开始
              </p>
            )}

            {grouped.map(({ type, items }) => {
              const meta = ROLE_META[type] || ROLE_META.general;
              return (
                <div key={type} className="mt-3 first:mt-1">
                  <div className="flex items-center gap-1.5 px-3 mb-1">
                    <span className="text-[10px]">{meta.icon}</span>
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{meta.label}</span>
                    <span className="text-[10px] text-gray-300">{items.length}</span>
                  </div>
                  {items.map((c) => (
                    <div key={c.id} className="group relative">
                      {editingId === c.id ? (
                        <div className="flex items-center gap-1 px-2 py-1">
                          <input
                            value={editTitle}
                            onChange={(e) => setEditTitle(e.target.value)}
                            className="flex-1 px-2 py-1 text-xs border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-emerald-300"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === "Enter") { onRename(c.id, editTitle); setEditingId(null); }
                              if (e.key === "Escape") setEditingId(null);
                            }}
                          />
                          <button onClick={() => { onRename(c.id, editTitle); setEditingId(null); }} className="p-0.5 text-emerald-500 hover:bg-emerald-50 rounded">
                            <Check size={14} />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => onSelect(c.id)}
                          className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-sm text-left transition-colors ${
                            c.id === activeId
                              ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100"
                              : "text-gray-600 hover:bg-gray-50"
                          }`}
                        >
                          <span className={`w-7 h-7 rounded-lg ${meta.iconBg} flex items-center justify-center text-[13px] flex-shrink-0`}>
                            {meta.icon}
                          </span>
                          <span className="truncate flex-1">{c.title || "新对话"}</span>
                        </button>
                      )}
                      {editingId !== c.id && (
                        <div className="absolute right-1 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center gap-0.5">
                          <button
                            onClick={(e) => { e.stopPropagation(); setEditingId(c.id); setEditTitle(c.title); }}
                            className="p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100"
                          >
                            <Pencil size={12} />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); onDelete(c.id); }}
                            className="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50"
                          >
                            <X size={12} />
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              );
            })}
          </>
        )}

        {activeSubView === "todo" && (
          <div className="space-y-0.5">
            {todos.length === 0 && (
              <p className="text-xs text-gray-400 text-center py-8">暂无待办</p>
            )}
            {todos.map((t) => (
              <div
                key={t.id}
                className="flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-gray-50 transition-colors group"
              >
                <input
                  type="checkbox"
                  checked={t.status === "done"}
                  onChange={(e) => onTodoToggle(t.id, e.target.checked)}
                  className="w-3.5 h-3.5 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 flex-shrink-0"
                />
                <span className={`flex-1 text-xs truncate ${t.status === "done" ? "line-through text-gray-400" : "text-gray-700"}`}>
                  {t.title}
                </span>
                {t.priority === "high" && (
                  <span className="text-[10px] text-red-600 bg-red-50 px-1.5 py-0.5 rounded flex-shrink-0">高</span>
                )}
                {t.priority === "medium" && t.status === "pending" && (
                  <span className="text-[10px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded flex-shrink-0">中</span>
                )}
                {t.deadline && t.status === "pending" && (
                  <span className="text-[10px] text-gray-400 flex-shrink-0">{t.deadline}</span>
                )}
                <button
                  onClick={() => onTodoDelete(t.id)}
                  className="p-0.5 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

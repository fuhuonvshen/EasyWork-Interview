// EasyWork - Agent sidebar (conversation list + todo list)
import { useState } from "react";
import { ArrowLeft, MessageSquare, Plus, X, Pencil, Check, ListTodo, Trash2 } from "lucide-react";
import type { AgentConversationSummary, TodoItem } from "../types";

interface Props {
  conversations: AgentConversationSummary[];
  activeId: string | null;
  activeSubView: "chat" | "todo";
  todos: TodoItem[];
  onSelect: (id: string) => void;
  onNew: () => void;
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

  return (
    <aside className="w-56 bg-white rounded-lg overflow-hidden flex flex-col flex-shrink-0">
      <div className="px-4 py-4">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-700 transition-colors mb-2"
        >
          <ArrowLeft size={14} />
          返回工作台
        </button>
        <h1 className="text-xl font-bold text-gray-900">办公助手</h1>
        <p className="text-xs text-gray-400 mt-0.5">智能问答 · 生产报告 · 待办管理</p>

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
            {todos.filter((t) => t.status === "pending").length > 0 && (
              <span className="bg-emerald-500 text-white text-[10px] rounded-full px-1.5 py-0.5">
                {todos.filter((t) => t.status === "pending").length}
              </span>
            )}
          </button>
        </div>
      </div>

      <div className="flex-1 px-2 py-3 space-y-1 overflow-y-auto">
        {activeSubView === "chat" && (
          <>
            <button
              onClick={onNew}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-emerald-600 hover:bg-emerald-50 transition-colors"
            >
              <Plus size={16} />
              新对话
            </button>

            {conversations.map((c) => (
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
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-left transition-colors ${
                      c.id === activeId
                        ? "bg-emerald-50 text-emerald-700"
                        : "text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    <MessageSquare size={16} className="flex-shrink-0" />
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

// EasyWork - 面试助手 main layout (role picker + grouped sidebar + chat / todo)
import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { X, Sparkles, Loader } from "lucide-react";
import AgentSidebar, { ROLE_META } from "./AgentSidebar";
import AgentChat from "./AgentChat";
import AgentTodo from "./AgentTodo";
import type { AgentConversationSummary, AgentConversationType, TodoItem } from "../types";
import { ERRORS, toUserError } from "../errors";
import { showToast } from "../components/Toast";

interface PendingPrompt {
  convId: string;
  message: string;
}

// 角色选择卡片（新建对话）
const ROLE_OPTIONS: { type: AgentConversationType; title: string; desc: string; iconBg: string }[] = [
  { type: "review", title: "复盘分析师", desc: "基于面试转写深度复盘，输出亮点、不足与改进建议", iconBg: "bg-emerald-100" },
  { type: "resume", title: "简历顾问", desc: "解析简历，按目标 JD 逐节优化，输出匹配度分析", iconBg: "bg-amber-100" },
  { type: "general", title: "通用助手", desc: "面试相关任何问答：会议通知排日程、岗位调研、面经", iconBg: "bg-sky-100" },
];

export default function AgentApp({
  onBack,
  initStatus,
  pendingPrompt,
}: {
  onBack: () => void;
  initStatus?: { status: string; message: string } | null;
  pendingPrompt?: PendingPrompt | null;
}) {
  const [conversations, setConversations] = useState<AgentConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [agentSubView, setAgentSubView] = useState<"chat" | "todo">("chat");
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [showRolePicker, setShowRolePicker] = useState(false);
  const [creating, setCreating] = useState(false);
  // 带上下文唤起：进入后自动发送的首条消息
  const [initialPrompt, setInitialPrompt] = useState<string | null>(null);
  const handledPendingRef = useRef<string | null>(null);

  const [llmLoading, setLlmLoading] = useState(true);
  const [llmStatus, setLlmStatus] = useState<string>("");

  const loadConversations = useCallback(() => {
    setLoadError(null);
    invoke<AgentConversationSummary[]>("agent_list_conversations")
      .then((list) => {
        setConversations(list);
        if (list.length > 0 && !activeId) {
          setActiveId(list[0].id);
        }
      })
      .catch((e) => {
        console.error(e);
        setLoadError(typeof e === "string" ? e : "加载对话列表失败");
      })
      .finally(() => setLoading(false));
  }, [activeId]);

  const loadTodos = useCallback(() => {
    invoke<TodoItem[]>("todo_list")
      .then(setTodos)
      .catch((e) => {
        console.error(e);
        showToast("加载待办列表失败", "error");
      });
  }, []);

  useEffect(() => { loadConversations(); }, []);
  useEffect(() => { loadTodos(); }, []);

  // 处理外部唤起（复盘/简历/模拟入口）：选中对话 + 设置待发消息
  useEffect(() => {
    if (!pendingPrompt) return;
    if (handledPendingRef.current === pendingPrompt.convId) return;
    handledPendingRef.current = pendingPrompt.convId;
    setActiveId(pendingPrompt.convId);
    setAgentSubView("chat");
    setInitialPrompt(pendingPrompt.message);
  }, [pendingPrompt]);

  // Lazy-start LLM server when entering Agent (local mode only)
  useEffect(() => {
    invoke<{ status: string; model?: string; message?: string }>("agent_prepare_llm")
      .then((res) => {
        setLlmStatus(res.status);
        if (res.status === "loading") setLlmLoading(true);
        else setLlmLoading(false);
      })
      .catch((e) => {
        console.error("准备 LLM 失败", e);
        setLlmStatus("error");
        setLlmLoading(false);
      });
    const interval = setInterval(async () => {
      try {
        const s = await invoke<{ healthy: boolean }>("llm_server_status");
        if (s.healthy) {
          setLlmLoading(false);
          setLlmStatus("ready");
          clearInterval(interval);
        }
      } catch {}
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  const handlePickRole = async (type: AgentConversationType) => {
    setCreating(true);
    try {
      const id = await invoke<string>("agent_create_conversation", { convType: type });
      setActiveId(id);
      setAgentSubView("chat");
      setShowRolePicker(false);
      loadConversations();
    } catch (e) {
      console.error(e);
      showToast("创建对话失败", "error");
    }
    setCreating(false);
  };

  const handleSelect = (id: string) => {
    setActiveId(id);
    setAgentSubView("chat");
    setInitialPrompt(null);
  };

  const handleDelete = async (id: string) => {
    try {
      await invoke("agent_delete_conversation", { id });
      if (activeId === id) setActiveId(null);
      loadConversations();
    } catch (e) { showToast(toUserError(ERRORS.DELETE_CONVERSATION, e), "error"); }
  };

  const handleRename = async (id: string, title: string) => {
    try {
      await invoke("agent_rename_conversation", { id, title });
      loadConversations();
    } catch (e) { console.error(e); showToast("重命名失败", "error"); }
  };

  const handleTodoToggle = async (id: string, done: boolean) => {
    try {
      await invoke("todo_update_status", { id, status: done ? "done" : "pending" });
      loadTodos();
    } catch (e) { console.error(e); showToast("更新待办状态失败", "error"); }
  };

  const handleTodoDelete = async (id: string) => {
    try {
      await invoke("todo_delete", { id });
      loadTodos();
    } catch (e) { console.error(e); showToast("删除待办失败", "error"); }
  };

  const handleConversationUpdate = () => {
    loadConversations();
    loadTodos();
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-sm text-gray-400">加载中...</p>
      </div>
    );
  }

  if (initStatus?.status === "error" && !activeId && conversations.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 px-8">
        <div className="w-full max-w-md rounded-xl border border-red-200 bg-red-50 p-6 text-center">
          <p className="text-sm font-medium text-red-800 mb-1">Agent 服务未启动</p>
          <p className="text-xs text-red-600 whitespace-pre-wrap">{initStatus.message}</p>
        </div>
        <button onClick={onBack} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors">
          返回工作台
        </button>
      </div>
    );
  }

  if (llmLoading && llmStatus === "loading") {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 px-8">
        <div className="w-8 h-8 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-gray-500">正在加载本地模型…</p>
        <p className="text-xs text-gray-400">首次加载需要 5-15 秒</p>
      </div>
    );
  }

  // 角色选择弹窗：空态界面与主界面共用（空态是提前 return，弹窗不能只挂主界面）
  const rolePicker = showRolePicker && (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 backdrop-blur-sm">
      <div className="bg-white rounded-3xl shadow-2xl w-[640px] max-w-[calc(100vw-48px)] p-6" style={{ animation: "dsh-pop .2s ease" }}>
        <style>{`@keyframes dsh-pop { from { transform: translateY(12px) scale(.97); opacity: 0 } to { transform: none; opacity: 1 } }`}</style>
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            <Sparkles size={18} className="text-emerald-500" />
            新建对话 · 选择角色
          </h3>
          <button onClick={() => setShowRolePicker(false)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>
        <p className="text-xs text-gray-400 mb-5">不同角色拥有专属的流程、提示词与工具面</p>
        <div className="grid grid-cols-2 gap-3">
          {ROLE_OPTIONS.map((r) => {
            const meta = ROLE_META[r.type];
            return (
              <button
                key={r.type}
                onClick={() => handlePickRole(r.type)}
                disabled={creating}
                className="text-left border border-gray-100 rounded-2xl p-4 hover:border-emerald-300 hover:shadow-lg hover:shadow-emerald-500/10 hover:-translate-y-0.5 transition-all disabled:opacity-50"
              >
                <span className={`w-10 h-10 rounded-xl ${r.iconBg} flex items-center justify-center text-lg mb-2.5`}>
                  {meta.icon}
                </span>
                <p className="text-sm font-bold text-gray-900">{r.title}</p>
                <p className="text-xs text-gray-400 mt-1 leading-relaxed">{r.desc}</p>
              </button>
            );
          })}
        </div>
        {creating && (
          <div className="flex items-center justify-center gap-2 mt-5 text-xs text-gray-400">
            <Loader size={13} className="animate-spin" /> 正在创建对话...
          </div>
        )}
      </div>
    </div>
  );

  if (!activeId && conversations.length === 0 && agentSubView === "chat") {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4">
        <div className="text-center space-y-3">
          <div className="w-16 h-16 mx-auto rounded-3xl bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center shadow-lg shadow-emerald-500/30">
            <Sparkles size={28} className="text-white" />
          </div>
          <p className="text-sm text-gray-500">选择角色，开始一场面试之旅</p>
        </div>
        <button
          onClick={() => setShowRolePicker(true)}
          className="px-5 py-2.5 bg-emerald-600 text-white text-sm font-medium rounded-xl hover:bg-emerald-700 transition-colors"
        >
          新建对话 · 选角色
        </button>
        <button onClick={onBack} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors">
          返回工作台
        </button>
        {rolePicker}
      </div>
    );
  }

  return (
    <div className="flex h-full gap-2.5">
      <AgentSidebar
        conversations={conversations}
        activeId={activeId}
        activeSubView={agentSubView}
        todos={todos}
        onSelect={handleSelect}
        onNew={() => setShowRolePicker(true)}
        onDelete={handleDelete}
        onRename={handleRename}
        onBack={onBack}
        onSubViewChange={setAgentSubView}
        onTodoToggle={handleTodoToggle}
        onTodoDelete={handleTodoDelete}
      />
      <div className="flex-1 flex flex-col min-w-0 rounded-lg bg-white overflow-hidden">
        {agentSubView === "chat" && activeId ? (
          <AgentChat
            conversationId={activeId}
            onConversationUpdate={handleConversationUpdate}
            conversationType={conversations.find((c) => c.id === activeId)?.type || "general"}
            initialPrompt={initialPrompt}
            onPromptConsumed={() => setInitialPrompt(null)}
          />
        ) : agentSubView === "chat" ? (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-sm text-gray-400">选择一个对话或创建新对话</p>
          </div>
        ) : (
          <AgentTodo todos={todos} onRefresh={loadTodos} onToggle={handleTodoToggle} onDelete={handleTodoDelete} />
        )}
      </div>

      {rolePicker}
    </div>
  );
}

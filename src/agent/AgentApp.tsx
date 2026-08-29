// EasyWork - Agent main layout (sidebar + chat / todo)
import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import AgentSidebar from "./AgentSidebar";
import AgentChat from "./AgentChat";
import AgentTodo from "./AgentTodo";
import type { AgentConversationSummary, TodoItem } from "../types";
import { ERRORS, toUserError } from "../errors";
import { showToast } from "../components/Toast";

export default function AgentApp({ onBack, initStatus }: { onBack: () => void; initStatus?: { status: string; message: string } | null }) {
  const [conversations, setConversations] = useState<AgentConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [agentSubView, setAgentSubView] = useState<"chat" | "todo">("chat");
  const [todos, setTodos] = useState<TodoItem[]>([]);
  // Lazy-load LLM server when entering Agent (local backend only)
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
    // Poll server status until ready when loading
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

  useEffect(() => { loadTodos(); }, []);

  const handleNew = async () => {
    try {
      const id = await invoke<string>("agent_create_conversation");
      setActiveId(id);
      setAgentSubView("chat");
      loadConversations();
    } catch (e) { console.error(e); showToast("创建对话失败", "error"); }
  };

  const handleSelect = (id: string) => {
    setActiveId(id);
    setAgentSubView("chat");
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

  // After chat sends a message, refresh todos (todo may have been created by agent)
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

  // Show init error prominently when agent sidecar failed to start
  if (initStatus?.status === "error" && !activeId && conversations.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 px-8">
        <div className="w-full max-w-md rounded-xl border border-red-200 bg-red-50 p-6 text-center">
          <p className="text-sm font-medium text-red-800 mb-1">Agent 服务未启动</p>
          <p className="text-xs text-red-600 whitespace-pre-wrap">{initStatus.message}</p>
        </div>
        <p className="text-xs text-gray-400 mt-2">
          请检查日志文件或重新安装应用。日志路径：在文件资源管理器输入 %LOCALAPPDATA%\easywork\easywork.log
        </p>
        <button
          onClick={onBack}
          className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors"
        >
          返回工作台
        </button>
      </div>
    );
  }

  // LLM server is starting up (local model lazy-load)
  if (llmLoading && llmStatus === "loading") {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 px-8">
        <div className="w-8 h-8 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-gray-500">正在加载本地模型…</p>
        <p className="text-xs text-gray-400">首次加载需要 5-15 秒</p>
      </div>
    );
  }

  // Loading done but conversations failed and init hasn't reported error yet
  // → agent is probably still starting up
  if (!loading && !activeId && conversations.length === 0 && loadError && !initStatus) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 px-8">
        <div className="w-full max-w-md rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-center">
          <p className="text-sm font-medium text-emerald-800 mb-1">Agent 正在启动...</p>
          <p className="text-xs text-emerald-600 mt-1">首次启动需要几秒钟，请稍候</p>
        </div>
        <button
          onClick={() => { setLoading(true); loadConversations(); }}
          className="px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-xl hover:bg-emerald-700 transition-colors"
        >
          重试
        </button>
        <button
          onClick={onBack}
          className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors"
        >
          返回工作台
        </button>
      </div>
    );
  }

  if (!activeId && conversations.length === 0 && agentSubView === "chat") {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4">
        <p className="text-sm text-gray-400">暂无对话</p>
        <button
          onClick={handleNew}
          className="px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-xl hover:bg-emerald-700 transition-colors"
        >
          开始新对话
        </button>
        <button
          onClick={onBack}
          className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors"
        >
          返回工作台
        </button>
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
        onNew={handleNew}
        onDelete={handleDelete}
        onRename={handleRename}
        onBack={onBack}
        onSubViewChange={setAgentSubView}
        onTodoToggle={handleTodoToggle}
        onTodoDelete={handleTodoDelete}
      />
      <div className="flex-1 flex flex-col min-w-0 rounded-lg bg-white overflow-hidden">
        {agentSubView === "chat" && activeId ? (
          <AgentChat conversationId={activeId} onConversationUpdate={handleConversationUpdate} />
        ) : agentSubView === "chat" ? (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-sm text-gray-400">选择一个对话或创建新对话</p>
          </div>
        ) : (
          <AgentTodo todos={todos} onRefresh={loadTodos} onToggle={handleTodoToggle} onDelete={handleTodoDelete} />
        )}
      </div>
    </div>
  );
}

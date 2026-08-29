// EasyWork - Agent chat area (message list + input + file upload)
import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { Send, Loader, Paperclip, Upload, ChevronDown, Timer, Flag } from "lucide-react";
import Markdown from "../components/Markdown";
import { showToast } from "../components/Toast";
import { ERRORS, toUserError } from "../errors";
import type { AgentMessage, AgentStreamEvent } from "../types";

interface Props {
  conversationId: string;
  onConversationUpdate: () => void;
  conversationType?: string;             // "general" | "mock" | "review" | "resume"
  initialPrompt?: string | null;         // 带上下文唤起：首次加载自动发送
  onPromptConsumed?: () => void;
}

// DeepSeek 风格的可折叠过程块（执行计划 / 思考过程，灰色小字）
function MessageCollapsible({ title, icon, content }: { title: string; icon: string; content: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex gap-3 text-sm">
      <div className="w-7 h-7 rounded-full bg-gray-50 flex items-center justify-center flex-shrink-0 mt-0.5">
        <span className="text-xs">{icon}</span>
      </div>
      <div className="max-w-[75%]">
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 cursor-pointer"
        >
          <ChevronDown size={12} className={`transition-transform ${open ? "" : "-rotate-90"}`} />
          {title}
        </button>
        {open && (
          <div className="mt-1 text-xs text-gray-400 whitespace-pre-wrap border-l-2 border-gray-200 pl-2 max-h-48 overflow-y-auto">
            {content}
          </div>
        )}
      </div>
    </div>
  );
}

export default function AgentChat({ conversationId, onConversationUpdate, conversationType = "general", initialPrompt, onPromptConsumed }: Props) {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [stream, setStream] = useState<{ text: string; thinking: string; toolStatus: string | null } | null>(null);
  const [thinkingCollapsed, setThinkingCollapsed] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isMock = conversationType === "mock";
  // 模拟面试计时
  const [mockSeconds, setMockSeconds] = useState(0);
  const autoSentRef = useRef<string | null>(null);

  const loadMessages = useCallback(() => {
    invoke<AgentMessage[]>("agent_get_messages", { conversationId })
      .then((list) => {
        setMessages(list);
        // 带上下文唤起：消息为空时自动发送首条消息（如"请复盘这场面试"）
        if (initialPrompt && list.length === 0 && autoSentRef.current !== initialPrompt) {
          autoSentRef.current = initialPrompt;
          setInput(initialPrompt);
          setTimeout(() => {
            handleSend(initialPrompt);
            onPromptConsumed?.();
          }, 300);
        }
      })
      .catch((e) => {
        console.error(e);
        setMessages((prev) => prev.length === 0 ? [{
          id: "error-loading", conversation_id: conversationId,
          role: "assistant", content: "加载消息失败，请重试", tool_calls: null,
          created_at: new Date().toISOString(),
        }] : prev);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, initialPrompt]);

  useEffect(() => { loadMessages(); }, [loadMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, stream]);

  // Clear transient streaming bubble when switching conversations
  useEffect(() => {
    setStream(null);
    setThinkingCollapsed(false);
    setMockSeconds(0);
    autoSentRef.current = null;
  }, [conversationId]);

  // 模拟面试计时（mock 对话）
  useEffect(() => {
    if (!isMock) return;
    setMockSeconds(0);
    const t = setInterval(() => setMockSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [isMock, conversationId]);

  const formatMockTime = (total: number) => {
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };

  // 隐藏意图前缀剥离（服务端已剥离落库，此处兜底展示）
  const displayUserContent = (content: string) =>
    content.startsWith("[回答面试题]") ? content.replace(/^\[回答面试题\]\s*/, "") : content;

  // ── Drag & drop file handling ──
  useEffect(() => {
    const window = getCurrentWindow();
    const unlisten = window.onDragDropEvent((event) => {
      if (event.payload.type === "over") {
        setDragOver(true);
      } else if (event.payload.type === "leave") {
        setDragOver(false);
      } else if (event.payload.type === "drop") {
        setDragOver(false);
        const paths = event.payload.paths;
        if (paths.length > 0) {
          handleFileUpload(paths[0]);
        }
      }
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [conversationId]);

  // ── Browse button ──
  const handleBrowseClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = file.name.split('.').pop()?.toLowerCase();
    const isBinary = ['xlsx', 'xls', 'xlsm'].includes(ext || '');
    const reader = new FileReader();
    reader.onload = () => {
      const content = reader.result as string;
      handleFileContentUpload(file.name, content, isBinary);
    };
    reader.onerror = () => console.error("Failed to read file");
    if (isBinary) {
      reader.readAsDataURL(file);
    } else {
      reader.readAsText(file);
    }
    e.target.value = "";
  };

  // ── Upload file (path-based, for drag-drop) ──
  const handleFileUpload = async (filePath: string) => {
    setUploading(true);
    try {
      await invoke<string>("agent_attach_file", { conversationId, filePath });
      loadMessages();
      onConversationUpdate();
    } catch (e) {
      console.error("File upload error:", e);
      // 显示后端真实错误详情（如"文件过大""无法复制文件"），便于定位
      const detail = e instanceof Error ? e.message : String(e);
      showToast(`${ERRORS.UPLOAD_FILE}：${detail}`, "error");
    }
    setUploading(false);
  };

  // ── Upload file (content-based, for file picker) ──
  const handleFileContentUpload = async (fileName: string, content: string, isBinary: boolean) => {
    setUploading(true);
    try {
      await invoke<string>("agent_attach_content", { conversationId, fileName, content, isBinary });
      loadMessages();
      onConversationUpdate();
    } catch (e) {
      console.error("File upload error:", e);
      const detail = e instanceof Error ? e.message : String(e);
      showToast(`${ERRORS.UPLOAD_FILE}：${detail}`, "error");
    }
    setUploading(false);
  };

  // ── Send message ──
  const handleSend = async (overrideText?: string) => {
    const text = (overrideText ?? input).trim();
    if (!text || sending) return;
    setInput("");
    setSending(true);
    setStream({ text: "", thinking: "", toolStatus: null });
    const convId = conversationId;

    // Immediately show user message optimistically
    const tempUserMsg: AgentMessage = {
      id: "temp-user-" + Date.now(),
      conversation_id: convId,
      role: "user",
      content: text,
      tool_calls: null,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempUserMsg]);

    let unlisten: (() => void) | null = null;
    try {
      // Register stream listener before invoking (single-flight: sending guard)
      unlisten = await listen<AgentStreamEvent>("agent-stream", (e) => {
        const p = e.payload;
        if (p.conversation_id !== convId) return; // stale events after conversation switch
        if (p.type === "plan" || p.type === "thinking") {
          // 计划与模型思考合并进可折叠思考区
          setStream((s) => (s ? { ...s, thinking: s.thinking + p.delta } : s));
        } else if (p.type === "answer") {
          setStream((s) => (s ? { ...s, text: s.text + p.delta } : s));
        } else if (p.type === "tool") {
          setStream((s) => (s ? { ...s, toolStatus: `正在执行工具: ${p.name}` } : s));
        } else if (p.type === "tool_result") {
          setStream((s) => (s ? { ...s, toolStatus: null } : s));
        }
        // "error"/"done" intentionally ignored — reload after invoke resolves
      });

      await invoke("agent_chat_stream", {
        conversationId: convId,
        message: text,
      });
      loadMessages();
      onConversationUpdate();
    } catch (e) {
      const errorMsg: AgentMessage = {
        id: "temp-error-" + Date.now(),
        conversation_id: convId,
        role: "assistant",
        content: toUserError(ERRORS.AGENT_CHAT, e),
        tool_calls: null,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      unlisten?.();
      setStream(null);
      setSending(false);
    }
  };

  return (
    <>
      {/* Drag overlay */}
      {dragOver && (
        <div className="absolute inset-0 z-50 bg-emerald-50/90 flex items-center justify-center border-2 border-dashed border-emerald-400 rounded-lg pointer-events-none">
          <div className="text-center">
            <Upload size={40} className="mx-auto text-emerald-500 mb-2" />
            <p className="text-emerald-700 font-medium">释放文件以上传</p>
            <p className="text-emerald-500 text-sm">支持 Excel (.xlsx/.xls)、CSV、TXT</p>
          </div>
        </div>
      )}

      {/* Message list */}
      <div className="flex-1 overflow-y-auto px-8 py-6">
        {/* 模拟面试横幅 */}
        {isMock && (
          <div className="max-w-3xl mx-auto mb-5">
            <div className="flex items-center gap-3 flex-wrap bg-gradient-to-r from-violet-50 to-fuchsia-50 border border-violet-100 rounded-2xl px-4 py-3">
              <span className="relative flex w-2.5 h-2.5">
                <span className="absolute inline-flex h-full w-full rounded-full bg-fuchsia-400 animate-ping opacity-75" />
                <span className="relative inline-flex w-2.5 h-2.5 rounded-full bg-fuchsia-500" />
              </span>
              <span className="text-sm font-semibold text-violet-900 flex items-center gap-1.5">
                <Flag size={14} className="text-violet-500" />
                模拟面试进行中
              </span>
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-white text-violet-700 border border-violet-200">
                <Timer size={12} />
                {formatMockTime(mockSeconds)}
              </span>
              <span className="text-[11px] text-violet-400">一次一题 · 结束后 AI 生成评分报告</span>
              <button
                onClick={() => handleSend("结束面试，请生成评估报告")}
                disabled={sending}
                className="ml-auto px-3.5 py-1.5 rounded-xl text-xs font-semibold text-white bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:opacity-90 disabled:opacity-50 transition-all"
              >
                结束面试
              </button>
            </div>
          </div>
        )}
        {messages.length === 0 && !dragOver && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center space-y-2">
              <p className="text-sm text-gray-400">
                {isMock ? "面试官已就位，等待你的回答…" : "开始对话吧"}
              </p>
              <p className="text-xs text-gray-300">
                {isMock ? "回答后 AI 逐题点评，可随时点击「结束面试」" : "拖拽 Excel/CSV 文件到窗口即可上传"}
              </p>
            </div>
          </div>
        )}
        <div className="max-w-3xl mx-auto space-y-4">
          {messages.map((msg) => {
            // Thinking messages: collapsible gray block (DeepSeek-style)
            if (msg.role === "thinking") {
              return <MessageCollapsible key={msg.id} title="思考过程" icon="💭" content={msg.content} />;
            }

            // 执行计划消息：折叠块显示，不占独立气泡
            if (msg.role === "assistant" && msg.content.startsWith("执行计划")) {
              const plan = msg.content.replace(/^执行计划\n?/, "");
              return <MessageCollapsible key={msg.id} title="执行计划" icon="📋" content={plan} />;
            }

            // Tool messages: show as compact pills
            if (msg.role === "tool") {
              let toolName: string | null = null;
              if (msg.tool_calls) {
                try {
                  const parsed = JSON.parse(msg.tool_calls);
                  toolName = typeof parsed === "string" ? parsed : null;
                } catch { /* ignore malformed data */ }
              }
              const displayName = toolName || "tool";
              return (
                <div key={msg.id} className="flex justify-center">
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs bg-amber-50 text-amber-700 border border-amber-200">
                    <span className="w-3.5 h-3.5 rounded-full bg-amber-400 text-white flex items-center justify-center text-[10px] font-bold">T</span>
                    已加载工具指南: {displayName}
                  </span>
                </div>
              );
            }

            // File attachment messages: show as special card
            if (msg.role === "user" && msg.content.startsWith("[上传了文件:")) {
              const fileName = msg.content.match(/\[上传了文件: ([^\]]+)\]/)?.[1] || "unknown";
              const dataContent = msg.content.replace(/^\[上传了文件: [^\]]+\]\n\n/, "");
              return (
                <div key={msg.id} className="flex justify-end">
                  <div className="max-w-[75%] rounded-2xl px-4 py-3 bg-blue-50 border border-blue-200">
                    <div className="flex items-center gap-2 text-sm font-medium text-blue-700 mb-2">
                      <Paperclip size={14} />
                      已上传: {fileName}
                    </div>
                    <pre className="text-xs text-blue-600 max-h-40 overflow-auto whitespace-pre-wrap">
                      {dataContent.length > 500 ? dataContent.slice(0, 500) + "\n...(已截断)" : dataContent}
                    </pre>
                  </div>
                </div>
              );
            }

            // Skip rendering tool_calls-only assistant messages
            if (msg.role === "assistant" && !msg.content && msg.tool_calls) {
              return null;
            }

            return (
              <div
                key={msg.id}
                className={`flex text-sm ${
                  msg.role === "user" ? "justify-end" : "justify-start"
                }`}
              >
                <div
                  className={`max-w-[78%] rounded-2xl px-4 py-3 ${
                    msg.role === "user"
                      ? "bg-emerald-600 text-white"
                      : "bg-gray-100 text-gray-700"
                  }`}
                >
                  {msg.role === "assistant" ? (
                    <div className="text-sm">
                      <Markdown content={msg.content} />
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap">{displayUserContent(msg.content)}</p>
                  )}
                </div>
              </div>
            );
          })}
          {stream && (
            <div className="flex text-sm">
              <div className="max-w-[78%] rounded-2xl px-4 py-3 bg-gray-100 text-gray-700">
                {stream.thinking && (
                  <div className="mb-2">
                    <button
                      onClick={() => setThinkingCollapsed(!thinkingCollapsed)}
                      className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 cursor-pointer"
                    >
                      <ChevronDown
                        size={14}
                        className={`transition-transform ${thinkingCollapsed ? "-rotate-90" : ""}`}
                      />
                      思考过程
                    </button>
                    {!thinkingCollapsed && (
                      <div className="mt-1 text-xs text-gray-500 whitespace-pre-wrap border-l-2 border-gray-300 pl-2 max-h-48 overflow-y-auto">
                        {stream.thinking}
                      </div>
                    )}
                  </div>
                )}
                {stream.text ? (
                  <div className="text-sm"><Markdown content={stream.text} /></div>
                ) : (
                  <div className="flex items-center gap-2 text-sm text-gray-400">
                    <Loader size={14} className="animate-spin" />
                    AI 思考中...
                  </div>
                )}
                {stream.toolStatus && (
                  <div className="mt-2 inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs bg-amber-50 text-amber-700 border border-amber-200">
                    {stream.toolStatus}
                  </div>
                )}
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Input area */}
      <div className="border-t border-gray-100 bg-white px-6 py-4">
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          {/* Upload button */}
          <button
            onClick={handleBrowseClick}
            disabled={sending || uploading}
            className="p-3 rounded-xl text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 disabled:opacity-40 transition-colors"
            title="上传文件"
          >
            {uploading ? (
              <Loader size={18} className="animate-spin" />
            ) : (
              <Paperclip size={18} />
            )}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.xlsm,.csv,.txt,.md,.json"
            onChange={handleFileInputChange}
            className="hidden"
          />

          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) handleSend(); }}
            placeholder={isMock ? "输入你的回答... (Enter 提交)" : "输入你的问题... (Enter 发送)"}
            disabled={sending}
            className="flex-1 px-4 py-3 rounded-xl border border-gray-200 bg-gray-50 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-300 focus:border-emerald-400 focus:bg-white disabled:opacity-50 transition-colors"
          />
          <button
            onClick={() => handleSend()}
            disabled={!input.trim() || sending}
            className="p-3 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Send size={18} />
          </button>
        </div>
      </div>
    </>
  );
}

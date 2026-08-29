// EasyWork - 简历顾问：左中简历管理（全局资产）+ 右侧 AI 侧边栏（简历角色对话）
import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ArrowLeft, FileText, Upload, Trash2, Check, Loader, Sparkles, Bot, Maximize2, PanelRightClose } from "lucide-react";
import type { Resume, AgentConversationSummary } from "../types";
import { showToast } from "../components/Toast";
import AgentChat from "../agent/AgentChat";

export default function ResumeView({ onBack, onExpand }: { onBack: () => void; onExpand: () => void }) {
  const [resume, setResume] = useState<Resume | null>(null);
  const [loadingResume, setLoadingResume] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 右侧 AI 侧边栏（简历角色对话）
  const [dockOpen, setDockOpen] = useState(true);
  const [convId, setConvId] = useState<string | null>(null);
  const [convs, setConvs] = useState<AgentConversationSummary[]>([]);
  const [dockLoading, setDockLoading] = useState(true);
  const [dockCreating, setDockCreating] = useState(false);

  useEffect(() => {
    invoke<Resume | null>("get_resume")
      .then(setResume)
      .catch(() => {})
      .finally(() => setLoadingResume(false));
  }, []);

  // 加载最近的简历角色对话
  useEffect(() => {
    invoke<AgentConversationSummary[]>("agent_list_conversations")
      .then((list) => {
        const resumeConvs = list.filter((c) => c.type === "resume");
        setConvs(resumeConvs);
        if (resumeConvs.length > 0) setConvId(resumeConvs[0].id);
      })
      .catch(() => {})
      .finally(() => setDockLoading(false));
  }, []);

  const handleNewDockConversation = async () => {
    setDockCreating(true);
    try {
      const id = await invoke<string>("agent_create_conversation", { convType: "resume" });
      setConvId(id);
      setConvs((prev) => [{ id, title: "", created_at: new Date().toISOString(), last_message: null, type: "resume", ref_id: null }, ...prev]);
    } catch {
      showToast("创建对话失败", "error");
    }
    setDockCreating(false);
  };

  const doSaveResume = async (fileName: string, content: string) => {
    if (!content.trim()) { showToast("简历内容为空", "error"); return; }
    setUploading(true);
    try {
      await invoke("save_resume", { fileName, content });
      setResume({ id: "", file_name: fileName, content, created_at: new Date().toISOString() });
      setPasteText("");
      setShowPaste(false);
      showToast("简历已保存，面试回答时会自动参考", "success");
    } catch {
      showToast("保存简历失败", "error");
    }
    setUploading(false);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => doSaveResume(file.name, String(reader.result || ""));
    reader.onerror = () => showToast("读取文件失败", "error");
    e.target.value = "";
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 min-h-0 flex gap-2.5 pl-0.5 pr-0.5 pt-3 pb-3">
        {/* 左中：简历管理 */}
        <div className="flex-1 min-w-0 bg-white rounded-lg overflow-hidden flex flex-col">
          <header className="px-6 py-4 border-b border-gray-100 flex items-center gap-3 flex-shrink-0">
            <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
              <ArrowLeft size={18} />
            </button>
            <div className="flex items-center gap-2">
              <span className="w-8 h-8 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
                <FileText size={16} />
              </span>
              <div>
                <h2 className="text-lg font-semibold text-gray-900 leading-tight">简历顾问</h2>
                <p className="text-[11px] text-gray-400">维护你的简历，AI 顾问随时参考并给出优化建议</p>
              </div>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto px-8 py-6">
            <div className="max-w-2xl mx-auto space-y-6">
              <section>
                <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2 mb-1">
                  我的简历
                  <span className="text-[10px] font-medium text-gray-400">面试回答演练时 AI 会参考你的项目/实习经历</span>
                </h3>
                <p className="text-xs text-gray-400 mb-4">支持 .txt / .md 或直接粘贴文本</p>

                {loadingResume ? (
                  <div className="flex items-center gap-2 text-xs text-gray-400 py-4">
                    <Loader size={14} className="animate-spin" /> 加载中...
                  </div>
                ) : resume ? (
                  <div className="rounded-2xl border border-amber-100 bg-amber-50/50 overflow-hidden mb-3">
                    <div className="flex items-center gap-3 px-4 py-3">
                      <div className="w-9 h-9 rounded-lg bg-amber-100 text-amber-600 flex items-center justify-center flex-shrink-0">
                        <FileText size={16} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate">{resume.file_name || "我的简历"}</p>
                        <p className="text-[11px] text-gray-400">
                          {resume.content.length} 字 · 更新于 {resume.created_at.slice(0, 10)}
                        </p>
                      </div>
                      <span className="text-[10px] font-semibold px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1 flex-shrink-0">
                        <Check size={10} /> 已保存
                      </span>
                    </div>
                    <div className="px-4 pb-3">
                      <div className="max-h-56 overflow-y-auto rounded-xl bg-white/80 border border-amber-100 p-3 text-xs text-gray-600 whitespace-pre-wrap leading-relaxed">
                        {resume.content}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="px-4 py-10 rounded-2xl border border-dashed border-gray-200 text-center mb-3">
                    <p className="text-sm text-gray-400">还没有上传简历</p>
                    <p className="text-xs text-gray-300 mt-1">上传后 AI 顾问才能结合你的经历给出针对性建议</p>
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".txt,.md"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    className="px-4 py-2 text-xs font-semibold text-white bg-gradient-to-r from-amber-500 to-orange-500 rounded-xl shadow-md shadow-amber-500/25 hover:opacity-90 disabled:opacity-50 transition-all flex items-center gap-1.5"
                  >
                    {uploading ? <Loader size={13} className="animate-spin" /> : <Upload size={13} />}
                    {resume ? "更新简历" : "上传简历"}
                  </button>
                  <button
                    onClick={() => setShowPaste((v) => !v)}
                    className="px-4 py-2 text-xs font-medium text-gray-600 bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors"
                  >
                    粘贴文本
                  </button>
                  {resume && (
                    <button
                      onClick={() => { setResume(null); showToast("请重新上传以替换简历", "info"); }}
                      className="p-2 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                      title="移除简历（重新上传即替换）"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>

                {showPaste && (
                  <div className="mt-3">
                    <textarea
                      value={pasteText}
                      onChange={(e) => setPasteText(e.target.value)}
                      placeholder="粘贴简历全文（教育背景、技能、项目经历、实习经历…）"
                      rows={8}
                      className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-700 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-amber-300 resize-y"
                    />
                    <div className="flex justify-end mt-2">
                      <button
                        onClick={() => doSaveResume("粘贴的简历.txt", pasteText)}
                        disabled={uploading || !pasteText.trim()}
                        className="px-4 py-1.5 text-xs font-semibold text-white bg-amber-500 rounded-lg hover:bg-amber-600 disabled:opacity-40 transition-colors"
                      >
                        保存
                      </button>
                    </div>
                  </div>
                )}
              </section>

              <section className="rounded-2xl border border-amber-100 bg-amber-50/40 p-4">
                <h3 className="text-xs font-bold text-amber-800 flex items-center gap-1.5 mb-2">
                  <Sparkles size={13} /> 可以这样问 AI
                </h3>
                <div className="space-y-1.5 text-xs text-amber-700/80">
                  <p>· 帮我校对这份简历，有没有错别字和表述问题？</p>
                  <p>· 我目标岗位是前端工程师，简历该怎么改？</p>
                  <p>· 根据这份简历模拟 HR 初筛，问我会问的问题</p>
                </div>
              </section>
            </div>
          </div>
        </div>

        {/* 右侧 AI 侧边栏（简历角色对话） */}
        <aside className={`wb-dock ${dockOpen ? "" : "wb-dock-collapsed"}`}>
          {dockOpen ? (
            <>
              <div className="wb-dock-head">
                <div className="wb-dock-avatar" style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}>
                  <Bot size={15} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-gray-900 leading-tight">简历顾问</p>
                  <p className="text-[10px] text-gray-400 leading-tight">基于你的简历对话</p>
                </div>
                <button
                  onClick={onExpand}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-amber-600 hover:bg-amber-50 transition-colors"
                  title="展开完整面试助手"
                >
                  <Maximize2 size={14} />
                </button>
                <button
                  onClick={() => setDockOpen(false)}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                  title="折叠面板"
                >
                  <PanelRightClose size={14} />
                </button>
              </div>
              <div className="wb-dock-body">
                {dockLoading ? (
                  <div className="flex-1 flex items-center justify-center gap-2 text-xs text-gray-400">
                    <Loader size={14} className="animate-spin" /> 加载中...
                  </div>
                ) : convId ? (
                  <div className="wb-dock-chat">
                    <AgentChat
                      conversationId={convId}
                      conversationType="resume"
                      onConversationUpdate={() => {}}
                    />
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6">
                    <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-lg shadow-amber-500/30">
                      <Bot size={22} className="text-white" />
                    </div>
                    <p className="text-xs text-gray-400 text-center leading-relaxed">
                      还没有对话<br />让 AI 顾问结合你的简历聊一聊
                    </p>
                    <button
                      onClick={handleNewDockConversation}
                      disabled={dockCreating}
                      className="px-4 py-2 text-xs font-semibold text-white bg-gradient-to-r from-amber-500 to-orange-500 rounded-xl shadow-md shadow-amber-500/25 hover:opacity-90 disabled:opacity-50 transition-all"
                    >
                      {dockCreating ? "创建中..." : "开始对话"}
                    </button>
                  </div>
                )}
              </div>
              <p className="wb-dock-hint">点右上角展开完整面试助手</p>
            </>
          ) : (
            <button className="wb-dock-bar" onClick={() => setDockOpen(true)} title="展开对话面板">
              <div className="wb-dock-avatar" style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}>
                <Bot size={14} />
              </div>
              <span>对话</span>
            </button>
          )}
        </aside>
      </div>
    </div>
  );
}

// EasyWork - 我的题库：一场面试一张封面卡（点卡进详情）+ 右侧 AI 侧边栏
import { useState, useEffect, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ArrowLeft, BookOpen, Loader, Trash2, Sparkles, Bot, Maximize2, PanelRightClose, Pencil, X, Check, Share2 } from "lucide-react";
import type { CSSProperties } from "react";
import type { InterviewQuestion, QuestionSession, AgentConversationSummary } from "../types";
import { showToast } from "../components/Toast";
import { DIFF_LABEL, sessionKey, coverHue, coverInitial, coverTitle, coverSub } from "./meta";
import ShareSessionModal from "../plaza/ShareSessionModal";
import AgentChat from "../agent/AgentChat";

function InterviewCard({ session, shared, onOpen, onShare }: {
  session: QuestionSession;
  shared: boolean;
  onOpen: () => void;
  onShare: () => void;
}) {
  const sub = coverSub(session);
  const cats = Array.from(new Set(session.questions.map((q) => q.category)));
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onOpen}
        className="w-full text-left rounded-2xl bg-white border border-gray-100 p-2.5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-gray-200/70 hover:border-violet-100 focus:outline-none focus:ring-2 focus:ring-violet-300"
      >
        <div className="qb-cover" style={{ "--qc-h": coverHue(session) } as CSSProperties}>
          <span className="qb-cover-mark">{coverInitial(session)}</span>
          <span className="qb-cover-title">{coverTitle(session)}</span>
          {sub && <span className="qb-cover-sub">{sub}</span>}
        </div>
        <div className="px-1 pt-2.5 pb-1">
          <div className="flex items-center gap-1.5 text-[11px]">
            <span className="text-gray-400">{session.created_at ? session.created_at.slice(0, 10) : "日期未知"}</span>
            <span className="text-gray-300">·</span>
            <span className="font-semibold text-violet-600">{session.questions.length} 题</span>
          </div>
          {cats.length > 0 && (
            <div className="mt-1.5 flex items-center gap-1 overflow-hidden">
              {cats.slice(0, 3).map((c) => (
                <span key={c} className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-50 text-violet-700 border border-violet-100 whitespace-nowrap">
                  {c}
                </span>
              ))}
              {cats.length > 3 && <span className="text-[10px] text-gray-400 flex-shrink-0">+{cats.length - 3}</span>}
            </div>
          )}
        </div>
      </button>
      <button
        type="button"
        onClick={onShare}
        title={shared ? "之前提交过分享，可再次提交" : "分享到面经广场"}
        className={`absolute top-3.5 right-3.5 w-7 h-7 rounded-full flex items-center justify-center backdrop-blur-sm shadow-sm transition-colors ${
          shared ? "bg-emerald-500/90 text-white hover:bg-emerald-600" : "bg-black/25 text-white hover:bg-black/40"
        }`}
      >
        {shared ? <Check size={14} /> : <Share2 size={14} />}
      </button>
    </div>
  );
}

export default function QuestionBankView({ onBack, onExpand }: {
  onBack: () => void;
  onExpand: () => void;
}) {
  const [sessions, setSessions] = useState<QuestionSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState<string>("全部");
  // 详情页选中的场次 key（存 key 不存对象：编辑/删除后 load() 会换掉对象）
  const [activeKey, setActiveKey] = useState<string | null>(null);

  // 正在分享到面经广场的场次（null = 弹窗未打开）
  const [sharing, setSharing] = useState<QuestionSession | null>(null);
  // 已提交过分享的场次（本地记录；云端审核结果不在客户端同步）
  const [sharedMap, setSharedMap] = useState<Record<string, { record_id: string; shared_at: string }>>({});

  // 编辑弹窗
  const [editing, setEditing] = useState<InterviewQuestion | null>(null);
  const [editCategory, setEditCategory] = useState("");
  const [editDifficulty, setEditDifficulty] = useState("medium");
  const [editQuestion, setEditQuestion] = useState("");
  const [editAnswer, setEditAnswer] = useState("");
  const [saving, setSaving] = useState(false);

  // 右侧 AI 侧边栏（通用角色对话）
  const [dockOpen, setDockOpen] = useState(true);
  const [convId, setConvId] = useState<string | null>(null);
  const [convs, setConvs] = useState<AgentConversationSummary[]>([]);
  const [dockLoading, setDockLoading] = useState(true);
  const [dockCreating, setDockCreating] = useState(false);
  const [pendingQ, setPendingQ] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    invoke<QuestionSession[]>("interview_question_sessions")
      .then(setSessions)
      .catch(() => showToast("加载题库失败", "error"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  // 读取本地已分享记录（存在 settings 的 plaza_shared_sessions 里）
  useEffect(() => {
    invoke<Record<string, string>>("get_settings")
      .then((s) => {
        if (s.plaza_shared_sessions) {
          try {
            setSharedMap(JSON.parse(s.plaza_shared_sessions));
          } catch {}
        }
      })
      .catch(() => {});
  }, []);

  // 加载最近的通用对话
  useEffect(() => {
    invoke<AgentConversationSummary[]>("agent_list_conversations")
      .then((list) => {
        const general = list.filter((c) => c.type === "general");
        setConvs(general);
        if (general.length > 0) setConvId(general[0].id);
      })
      .catch(() => {})
      .finally(() => setDockLoading(false));
  }, []);

  // 分类标签从全量题目派生（不随筛选塌缩）
  const categories = useMemo(() => {
    const set = new Set<string>();
    sessions.forEach((s) => s.questions.forEach((q) => set.add(q.category)));
    return ["全部", ...Array.from(set)];
  }, [sessions]);

  // 筛选后每场只留该分类的题，没有题的场次不显示
  const visibleSessions = useMemo(() => {
    if (category === "全部") return sessions;
    return sessions
      .map((s) => ({ ...s, questions: s.questions.filter((q) => q.category === category) }))
      .filter((s) => s.questions.length > 0);
  }, [sessions, category]);

  const visibleCount = useMemo(
    () => visibleSessions.reduce((n, s) => n + s.questions.length, 0),
    [visibleSessions],
  );

  // 场次被删空（例如删掉最后一题）时自动回落到卡片流
  const activeSession = useMemo(
    () => (activeKey ? visibleSessions.find((s) => sessionKey(s) === activeKey) ?? null : null),
    [visibleSessions, activeKey],
  );

  const isShared = (s: QuestionSession) => !!sharedMap[sessionKey(s)];
  const activeShared = activeSession ? isShared(activeSession) : false;

  // 分享始终用完整的场次（分类筛选只是展示层过滤，别把面经分享成残缺的）
  const openShare = (s: QuestionSession) => {
    setSharing(sessions.find((x) => sessionKey(x) === sessionKey(s)) ?? s);
  };

  const handleShared = (s: QuestionSession, recordId: string, sharedAt: string) => {
    const next = { ...sharedMap, [sessionKey(s)]: { record_id: recordId, shared_at: sharedAt } };
    setSharedMap(next);
    invoke("update_setting", { key: "plaza_shared_sessions", value: JSON.stringify(next) }).catch(() => {});
  };

  const handleDelete = async (id: string) => {
    try {
      await invoke("interview_question_delete", { id });
      load();
      showToast("已删除", "success");
    } catch {
      showToast("删除失败", "error");
    }
  };

  const openEdit = (q: InterviewQuestion) => {
    setEditing(q);
    setEditCategory(q.category);
    setEditDifficulty(q.difficulty);
    setEditQuestion(q.question);
    setEditAnswer(q.expected_answer || "");
  };

  const saveEdit = async () => {
    if (!editing || !editQuestion.trim()) return;
    setSaving(true);
    try {
      await invoke("interview_question_update", {
        id: editing.id,
        category: editCategory.trim() || "未分类",
        difficulty: editDifficulty,
        question: editQuestion.trim(),
        expected_answer: editAnswer.trim() || null,
      });
      showToast("已保存", "success");
      setEditing(null);
      load();
    } catch {
      showToast("保存失败", "error");
    }
    setSaving(false);
  };

  const handleNewDockConversation = async () => {
    setDockCreating(true);
    try {
      const id = await invoke<string>("agent_create_conversation", { convType: "general" });
      setConvId(id);
      setConvs((prev) => [{ id, title: "", created_at: new Date().toISOString(), last_message: null, type: "general", ref_id: null }, ...prev]);
    } catch {
      showToast("创建对话失败", "error");
    }
    setDockCreating(false);
  };

  // 问问 AI：新建对话并在侧边栏自动发送（不跳转、不弹窗）。
  // 必须新建对话 + key 重挂载：AgentChat 只在「消息为空」时消费 initialPrompt，
  // 复用已有对话（有历史消息）点了不会发。
  const handleAsk = async (question: string) => {
    try {
      const id = await invoke<string>("agent_create_conversation", { convType: "general" });
      setConvId(id);
      setConvs((prev) => [{ id, title: "", created_at: new Date().toISOString(), last_message: null, type: "general", ref_id: null }, ...prev]);
      setPendingQ(question);
      setDockOpen(true);
    } catch {
      showToast("创建对话失败", "error");
    }
  };

  // 单道题的正文行（卡片流和详情页共用同一套操作）
  const questionRow = (q: InterviewQuestion) => (
    <div key={q.id} className="group flex items-start gap-3 px-4 py-3.5 rounded-xl bg-white border border-gray-100 shadow-sm hover:shadow-md hover:border-violet-100 transition-all">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 border border-violet-200">{q.category}</span>
          {DIFF_LABEL[q.difficulty] && (
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${DIFF_LABEL[q.difficulty].cls}`}>
              {DIFF_LABEL[q.difficulty].label}
            </span>
          )}
          <span className="text-[10px] text-gray-300">{q.created_at.slice(0, 10)}</span>
        </div>
        <p className="text-sm text-gray-800 leading-relaxed">{q.question}</p>
        {q.expected_answer && (
          <p className="mt-1.5 text-xs text-gray-400 leading-relaxed line-clamp-2">💡 {q.expected_answer}</p>
        )}
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        <button
          onClick={() => handleAsk(q.question)}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 transition-colors flex items-center gap-1"
          title="让 AI 结合你的简历准备回答（在右侧侧边栏对话）"
        >
          <Bot size={13} />
          问问AI
        </button>
        <button
          onClick={() => openEdit(q)}
          className="p-1.5 rounded-lg text-gray-300 hover:text-violet-500 hover:bg-violet-50 transition-colors"
          title="修改这道题"
        >
          <Pencil size={14} />
        </button>
        <button
          onClick={() => handleDelete(q.id)}
          className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors"
          title="删除这道题"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 min-h-0 flex gap-2.5 pl-0.5 pr-0.5 pt-3 pb-3">
        {/* 左中：题库主体 */}
        <div className="flex-1 min-w-0 bg-white rounded-lg overflow-hidden flex flex-col">
          {activeSession ? (
            <>
              {/* 详情：某一场面试的全部题目 */}
              <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-3 flex-shrink-0">
                <button
                  onClick={() => setActiveKey(null)}
                  className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                  title="返回题库"
                >
                  <ArrowLeft size={18} />
                </button>
                <div className="qb-cover qb-cover-sm" style={{ "--qc-h": coverHue(activeSession) } as CSSProperties}>
                  <span className="qb-cover-initial">{coverInitial(activeSession)}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="text-lg font-semibold text-gray-900 leading-tight truncate">{coverTitle(activeSession)}</h2>
                  <p className="text-[11px] text-gray-400 truncate">
                    {[
                      coverSub(activeSession),
                      activeSession.created_at ? activeSession.created_at.slice(0, 10) : "",
                      `共 ${activeSession.questions.length} 题`,
                    ].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <button
                  onClick={() => openShare(activeSession)}
                  title={activeShared ? "之前提交过分享，可再次提交" : "把这场的题目分享到面经广场"}
                  className={`ml-1 flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors flex-shrink-0 ${
                    activeShared
                      ? "text-emerald-700 bg-emerald-50 hover:bg-emerald-100"
                      : "text-white bg-violet-600 hover:bg-violet-700"
                  }`}
                >
                  {activeShared ? <Check size={14} /> : <Share2 size={14} />}
                  {activeShared ? "已分享过" : "分享到面经广场"}
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2.5">
                {activeSession.questions.map(questionRow)}
              </div>
            </>
          ) : (
            <>
              <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-3 flex-shrink-0">
                <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
                  <ArrowLeft size={18} />
                </button>
                <div className="flex items-center gap-2">
                  <span className="w-8 h-8 rounded-xl bg-violet-50 text-violet-600 flex items-center justify-center">
                    <BookOpen size={16} />
                  </span>
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900 leading-tight">我的题库</h2>
                    <p className="text-[11px] text-gray-400">
                      {category === "全部" ? `共 ${visibleCount} 题` : `${category} · 共 ${visibleCount} 题`}
                    </p>
                  </div>
                </div>
                {sessions.length === 0 && !loading && (
                  <span className="ml-auto flex items-center gap-1 text-[11px] text-gray-400 bg-gray-50 px-3 py-1.5 rounded-full">
                    <Sparkles size={12} className="text-violet-500" />
                    复盘真实面试后，AI 会自动帮你收集题目
                  </span>
                )}
              </div>

              {/* 分类筛选 */}
              <div className="px-6 py-2.5 border-b border-gray-50 flex items-center gap-2 flex-shrink-0 overflow-x-auto">
                {categories.map((c) => (
                  <button
                    key={c}
                    onClick={() => setCategory(c)}
                    className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                      category === c ? "bg-violet-600 text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>

              {/* 卡片流：一场面试一张卡 */}
              <div className="flex-1 overflow-y-auto px-6 py-5">
                {loading ? (
                  <div className="flex items-center justify-center gap-2 text-sm text-gray-400 py-12">
                    <Loader size={16} className="animate-spin" /> 加载中...
                  </div>
                ) : visibleSessions.length === 0 ? (
                  <div className="text-center py-14">
                    <div className="w-14 h-14 rounded-2xl bg-gray-50 flex items-center justify-center mx-auto mb-4">
                      <BookOpen size={26} className="text-gray-300" />
                    </div>
                    <p className="text-sm text-gray-400">
                      {sessions.length === 0 ? "题库还是空的" : `「${category}」分类下暂无题目`}
                    </p>
                    <p className="text-xs text-gray-300 mt-1">
                      {sessions.length === 0
                        ? "去录一场真实面试，AI 复盘时会帮你提取面试官的问题"
                        : "换个分类看看"}
                    </p>
                  </div>
                ) : (
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                    {visibleSessions.map((s) => (
                      <InterviewCard
                        key={sessionKey(s)}
                        session={s}
                        shared={isShared(s)}
                        onOpen={() => setActiveKey(sessionKey(s))}
                        onShare={() => openShare(s)}
                      />
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* 右侧 AI 侧边栏（通用角色对话） */}
        <aside className={`wb-dock ${dockOpen ? "" : "wb-dock-collapsed"}`}>
          {dockOpen ? (
            <>
              <div className="wb-dock-head">
                <div className="wb-dock-avatar" style={{ background: "linear-gradient(135deg, #8b5cf6, #6366f1)" }}>
                  <Bot size={15} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-gray-900 leading-tight">答题助手</p>
                  <p className="text-[10px] text-gray-400 leading-tight">可从左侧题目列表中选择提问</p>
                </div>
                <button
                  onClick={onExpand}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-violet-600 hover:bg-violet-50 transition-colors"
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
                      key={convId}
                      conversationId={convId}
                      conversationType="general"
                      onConversationUpdate={() => {}}
                      initialPrompt={pendingQ ? `[回答面试题] ${pendingQ}` : null}
                      onPromptConsumed={() => setPendingQ(null)}
                    />
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6">
                    <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-violet-400 to-indigo-500 flex items-center justify-center shadow-lg shadow-violet-500/30">
                      <Bot size={22} className="text-white" />
                    </div>
                    <p className="text-xs text-gray-400 text-center leading-relaxed">
                      还没有对话<br />点题目上的「问问AI」开始
                    </p>
                    <button
                      onClick={handleNewDockConversation}
                      disabled={dockCreating}
                      className="px-4 py-2 text-xs font-semibold text-white bg-gradient-to-r from-violet-500 to-indigo-500 rounded-xl shadow-md shadow-violet-500/25 hover:opacity-90 disabled:opacity-50 transition-all"
                    >
                      {dockCreating ? "创建中..." : "开始对话"}
                    </button>
                  </div>
                )}
              </div>
            </>
          ) : (
            <button className="wb-dock-bar" onClick={() => setDockOpen(true)} title="展开对话面板">
              <div className="wb-dock-avatar" style={{ background: "linear-gradient(135deg, #8b5cf6, #6366f1)" }}>
                <Bot size={14} />
              </div>
              <span className="wb-dock-bar-label">对话</span>
            </button>
          )}
        </aside>
      </div>

      {/* 编辑题目弹窗 */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-[560px] max-w-[calc(100vw-48px)] p-5" style={{ animation: "dsh-pop .2s ease" }}>
            <style>{`@keyframes dsh-pop { from { transform: translateY(12px) scale(.97); opacity: 0 } to { transform: none; opacity: 1 } }`}</style>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
                <Pencil size={16} className="text-violet-500" />
                修改题目
              </h3>
              <button onClick={() => setEditing(null)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600">
                <X size={18} />
              </button>
            </div>
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">分类</label>
                  <input
                    type="text"
                    value={editCategory}
                    onChange={(e) => setEditCategory(e.target.value)}
                    placeholder="例如：算法"
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">难度</label>
                  <select
                    value={editDifficulty}
                    onChange={(e) => setEditDifficulty(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet-300"
                  >
                    <option value="easy">简单</option>
                    <option value="medium">中等</option>
                    <option value="hard">困难</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">日期</label>
                  <p className="px-3 py-2 rounded-lg bg-gray-50 text-sm text-gray-400">{editing.created_at.slice(0, 10)}</p>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">问题内容</label>
                <textarea
                  value={editQuestion}
                  onChange={(e) => setEditQuestion(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-violet-300 resize-y"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">参考答案（选填）</label>
                <textarea
                  value={editAnswer}
                  onChange={(e) => setEditAnswer(e.target.value)}
                  rows={4}
                  placeholder="AI 提取的参考答案，可在这里纠正"
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-700 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-violet-300 resize-y"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setEditing(null)}
                className="px-4 py-2 text-xs font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              >
                取消
              </button>
              <button
                onClick={saveEdit}
                disabled={saving || !editQuestion.trim()}
                className="px-4 py-2 text-xs font-semibold text-white bg-violet-600 rounded-lg hover:bg-violet-700 disabled:opacity-40 transition-colors flex items-center gap-1.5"
              >
                {saving ? <Loader size={13} className="animate-spin" /> : <Check size={13} />}
                保存修改
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 分享到面经广场弹窗 */}
      {sharing && (
        <ShareSessionModal
          session={sharing}
          alreadyShared={isShared(sharing)}
          onClose={() => setSharing(null)}
          onShared={(recordId, sharedAt) => handleShared(sharing, recordId, sharedAt)}
        />
      )}
    </div>
  );
}

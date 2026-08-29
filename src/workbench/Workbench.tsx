// EasyWork - Workbench (landing page: 水滴气泡卡片 + 右侧常驻对话面板)
import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FileText, BookOpen, Rocket, Bot, FileSearch, MessageSquareHeart, Settings, PanelRightClose, Maximize2, Loader } from "lucide-react";
import { getVersion } from "@tauri-apps/api/app";
import ModelDownloadDialog from "../settings/ModelDownloadDialog";
import AgentChat from "../agent/AgentChat";
import type { AgentConversationSummary } from "../types";
import type { CSSProperties } from "react";

// 每张卡片的形状三态（形态蠕动）、水色配色、大尺寸/旋转/位置（黄金比例场景内夸张散落）
const WORKBENCH_CARDS: {
  key: string;
  icon: typeof FileText;
  title: string;
  desc: string;
  action: string;
  pos: { left: number; top: number };
  style: CSSProperties;
}[] = [
  {
    key: "history",
    icon: FileText,
    title: "面试记录",
    desc: "录制 · 转写 · AI 复盘",
    action: "history",
    pos: { left: 36, top: 10 },
    style: {
      "--w": "226px", "--rot": "-7deg", "--tdeep": "#dbe0ff", "--tbg": "#f0f2ff",
      "--br": "46% 54% 56% 44% / 56% 46% 54% 44%",
      "--br2": "52% 48% 42% 58% / 48% 56% 44% 52%",
      "--br3": "40% 60% 58% 42% / 60% 42% 56% 44%",
      "--tcolor": "#2a36e0", "--hb": "#bcc5ff",
      "--delay": "0s", "--dur": "4.6s", "--mdelay": "0s", "--mdur": "6.6s",
    } as CSSProperties,
  },
  {
    key: "questions",
    icon: BookOpen,
    title: "我的题库",
    desc: "面试官问题 · 分类复习",
    action: "questions",
    pos: { left: 500, top: 26 },
    style: {
      "--w": "208px", "--rot": "4deg", "--tdeep": "#ede9fe", "--tbg": "#f5f3ff",
      "--br": "58% 42% 48% 52% / 46% 56% 44% 54%",
      "--br2": "46% 54% 58% 42% / 56% 44% 52% 48%",
      "--br3": "62% 38% 44% 56% / 42% 58% 46% 54%",
      "--tcolor": "#7c3aed", "--hb": "#ddd6fe",
      "--delay": ".6s", "--dur": "5s", "--mdelay": "-1.4s", "--mdur": "7.2s",
    } as CSSProperties,
  },
  {
    key: "apply",
    icon: Rocket,
    title: "前往投递",
    desc: "我的投递工作台",
    action: "apply",
    pos: { left: 258, top: 224 },
    style: {
      "--w": "214px", "--rot": "-3deg", "--tdeep": "#dbeafe", "--tbg": "#eff6ff",
      "--br": "50% 58% 44% 50% / 52% 44% 56% 48%",
      "--br2": "42% 50% 58% 46% / 44% 58% 46% 52%",
      "--br3": "56% 44% 50% 58% / 60% 42% 52% 46%",
      "--tcolor": "#2563eb", "--hb": "#bfdbfe",
      "--delay": "1.2s", "--dur": "4.8s", "--mdelay": "-2.6s", "--mdur": "6.9s",
    } as CSSProperties,
  },
  {
    key: "agent",
    icon: Bot,
    title: "面试助手",
    desc: "智能问答 · 复盘 · 档案",
    action: "agent",
    pos: { left: 6, top: 236 },
    style: {
      "--w": "218px", "--rot": "3deg", "--tdeep": "#d1fae5", "--tbg": "#ecfdf5",
      "--br": "44% 50% 54% 46% / 58% 46% 52% 44%",
      "--br2": "54% 44% 46% 56% / 46% 56% 44% 54%",
      "--br3": "40% 56% 52% 48% / 62% 44% 56% 42%",
      "--tcolor": "#059669", "--hb": "#a7f3d0",
      "--delay": "1.8s", "--dur": "5.2s", "--mdelay": "-.8s", "--mdur": "7.4s",
    } as CSSProperties,
  },
  {
    key: "resume",
    icon: FileSearch,
    title: "简历顾问",
    desc: "简历分析 · JD 匹配",
    action: "resume",
    pos: { left: 500, top: 250 },
    style: {
      "--w": "192px", "--rot": "-5deg", "--tdeep": "#fef3c7", "--tbg": "#fffbeb",
      "--br": "54% 46% 50% 56% / 46% 58% 44% 52%",
      "--br2": "46% 56% 58% 42% / 56% 46% 52% 44%",
      "--br3": "60% 40% 44% 58% / 44% 56% 48% 58%",
      "--tcolor": "#d97706", "--hb": "#fde68a",
      "--delay": "2.4s", "--dur": "4.7s", "--mdelay": "-3.2s", "--mdur": "6.8s",
    } as CSSProperties,
  },
  {
    key: "feedback",
    icon: MessageSquareHeart,
    title: "意见反馈",
    desc: "变得更强",
    action: "feedback",
    pos: { left: 246, top: 2 },
    style: {
      "--w": "200px", "--rot": "6deg", "--tdeep": "#ffe4e6", "--tbg": "#fff1f2",
      "--br": "48% 52% 46% 54% / 54% 48% 52% 46%",
      "--br2": "56% 44% 54% 46% / 46% 56% 44% 54%",
      "--br3": "44% 58% 50% 52% / 58% 44% 56% 46%",
      "--tcolor": "#e11d48", "--hb": "#fecdd3",
      "--delay": "3s", "--dur": "5.1s", "--mdelay": "-2s", "--mdur": "7.6s",
    } as CSSProperties,
  },
];

export default function Workbench({ onEnter }: { onEnter: (title?: string, action?: string) => void }) {
  const [showModel, setShowModel] = useState(false);
  const [appVersion, setAppVersion] = useState("");
  // 右侧常驻对话面板
  const [dockOpen, setDockOpen] = useState(true);
  const [dockConvId, setDockConvId] = useState<string | null>(null);
  const [dockConvs, setDockConvs] = useState<AgentConversationSummary[]>([]);
  const [dockLoading, setDockLoading] = useState(true);
  const [dockCreating, setDockCreating] = useState(false);

  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => setAppVersion(""));
  }, []);

  // 加载最近一个对话供面板使用
  useEffect(() => {
    invoke<AgentConversationSummary[]>("agent_list_conversations")
      .then((list) => {
        setDockConvs(list);
        if (list.length > 0) setDockConvId(list[0].id);
      })
      .catch(() => {})
      .finally(() => setDockLoading(false));
  }, []);

  const handleDockNewConversation = async () => {
    setDockCreating(true);
    try {
      const id = await invoke<string>("agent_create_conversation", { convType: "general" });
      setDockConvId(id);
      setDockConvs((prev) => [{ id, title: "", created_at: new Date().toISOString(), last_message: null, type: "general", ref_id: null }, ...prev]);
    } catch {}
    setDockCreating(false);
  };

  const dockConvType = dockConvs.find((c) => c.id === dockConvId)?.type || "general";

  return (
    <div className="h-full flex flex-col">
      {/* 主内容：气泡场景 + 右侧对话面板 */}
      <div className="flex-1 min-h-0 flex gap-2.5 px-3 pt-3">
        <div className="flex-1 min-w-0 flex items-center justify-center overflow-y-auto">
          <div className="wb-scene">
            {WORKBENCH_CARDS.map((card) => {
              const Icon = card.icon;
              return (
                <div
                  key={card.key}
                  className="wb-pos"
                  style={{ left: card.pos.left, top: card.pos.top }}
                >
                  <button
                    onClick={() => onEnter(undefined, card.action)}
                    className="wb-card"
                    style={card.style}
                  >
                    <span className="wb-ring" aria-hidden="true" />
                    <div className="wb-icon">
                      <Icon size={26} />
                    </div>
                    <h3>{card.title}</h3>
                    <p>{card.desc}</p>
                  </button>
                </div>
              );
            })}
          </div>

          {showModel && (
            <ModelDownloadDialog
              onDone={() => setShowModel(false)}
              onClose={() => setShowModel(false)}
            />
          )}
        </div>

        {/* 右侧对话面板（常驻，可折叠） */}
        <aside className={`wb-dock ${dockOpen ? "" : "wb-dock-collapsed"}`}>
          {dockOpen ? (
            <>
              <div className="wb-dock-head">
                <div className="wb-dock-avatar">
                  <Bot size={15} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-bold text-gray-900 leading-tight">面试助手</p>
                  <p className="text-[10.5px] text-gray-400 leading-tight">快速问答 · 随时可用</p>
                </div>
                <button
                  onClick={() => onEnter(undefined, "agent")}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 transition-colors"
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
                ) : dockConvId ? (
                  <AgentChat
                    conversationId={dockConvId}
                    conversationType={dockConvType}
                    onConversationUpdate={() => {}}
                  />
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6">
                    <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center shadow-lg shadow-emerald-500/30">
                      <Bot size={22} className="text-white" />
                    </div>
                    <p className="text-xs text-gray-400 text-center leading-relaxed">
                      还没有对话<br />点下方开始第一段问答
                    </p>
                    <button
                      onClick={handleDockNewConversation}
                      disabled={dockCreating}
                      className="px-4 py-2 text-xs font-semibold text-white bg-gradient-to-r from-emerald-500 to-teal-500 rounded-xl shadow-md shadow-emerald-500/25 hover:opacity-90 disabled:opacity-50 transition-all"
                    >
                      {dockCreating ? "创建中..." : "开始对话"}
                    </button>
                  </div>
                )}
              </div>
              <p className="wb-dock-hint">点右上角展开完整面试助手（角色对话/模拟面试）</p>
            </>
          ) : (
            <button className="wb-dock-bar" onClick={() => setDockOpen(true)} title="展开对话面板">
              <div className="wb-dock-avatar">
                <Bot size={14} />
              </div>
              <span>对话</span>
            </button>
          )}
        </aside>
      </div>

      {/* Bottom bar */}
      <div className="flex items-center justify-between px-8 py-3 flex-shrink-0">
        <span className="text-xs text-gray-400 select-none">EasyWork 面试助手 v{appVersion}</span>
        <button
          onClick={() => setShowModel(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-500 rounded-lg transition-colors"
        >
          <Settings size={14} />
          设置
        </button>
      </div>
    </div>
  );
}

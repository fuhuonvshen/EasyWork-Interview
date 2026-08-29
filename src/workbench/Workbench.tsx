// EasyWork - Workbench (landing page: 水滴气泡卡片 + 右侧常驻对话面板)
import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FileText, BookOpen, Rocket, Bot, FileSearch, MessageSquareHeart, Settings, PanelRightClose, Maximize2, Loader } from "lucide-react";
import { getVersion } from "@tauri-apps/api/app";
import AgentChat from "../agent/AgentChat";
import ModelDownloadDialog from "../settings/ModelDownloadDialog";
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
    pos: { left: 8, top: 8 },
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
    pos: { left: 524, top: 16 },
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
    pos: { left: 296, top: 240 },
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
    pos: { left: -4, top: 252 },
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
    pos: { left: 540, top: 268 },
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
    pos: { left: 150, top: 262 },
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
  const [appVersion, setAppVersion] = useState("");
  const [showModel, setShowModel] = useState(false);
  // 右侧常驻对话面板
  const [dockOpen, setDockOpen] = useState(true);
  const [dockConvId, setDockConvId] = useState<string | null>(null);
  const [dockConvs, setDockConvs] = useState<AgentConversationSummary[]>([]);
  const [dockLoading, setDockLoading] = useState(true);
  const [dockCreating, setDockCreating] = useState(false);

  // ── 气泡物理：六个模块在左侧区域自由漂浮 + 互相碰撞不重叠 ──
  const areaRef = useRef<HTMLDivElement>(null);
  const cardElRefs = useRef<(HTMLDivElement | null)[]>([]);
  const physRef = useRef<{ x: number; y: number; vx: number; vy: number; w: number }[] | null>(null);
  useEffect(() => {
    if (physRef.current) return; // 只初始化一次（React StrictMode 双调用保护）
    physRef.current = WORKBENCH_CARDS.map((c) => ({
      x: c.pos.left, y: c.pos.top,
      vx: (Math.random() - 0.5) * 40,
      vy: (Math.random() - 0.5) * 40,
      w: parseFloat(String((c.style as Record<string, unknown>)["--w"] || "200px")) || 200,
    }));
    const bodies = physRef.current;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const area = areaRef.current;
      const W = area?.offsetWidth || 720;
      const H = area?.offsetHeight || 460;
      const t = now / 1000;
      const MARGIN = 6;
      const radiusOf = (w: number) => (w / 2) * 0.85; // 水滴形比圆略小
      // 漂移：正弦风 + 微随机扰动，永不停止；限速保持漂浮感
      for (let i = 0; i < bodies.length; i++) {
        const b = bodies[i];
        b.vx += Math.sin(t * 0.7 + i * 1.7) * 0.2 + (Math.random() - 0.5) * 0.6;
        b.vy += Math.cos(t * 0.6 + i * 2.1) * 0.2 + (Math.random() - 0.5) * 0.6;
        const sp = Math.hypot(b.vx, b.vy);
        const maxSp = 44;
        if (sp > maxSp) { b.vx = (b.vx / sp) * maxSp; b.vy = (b.vy / sp) * maxSp; }
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        // 边界反弹
        const r = radiusOf(b.w);
        if (b.x < MARGIN) { b.x = MARGIN; b.vx = Math.abs(b.vx); }
        if (b.x > W - b.w - MARGIN) { b.x = W - b.w - MARGIN; b.vx = -Math.abs(b.vx); }
        if (b.y < MARGIN) { b.y = MARGIN; b.vy = Math.abs(b.vy); }
        if (b.y > H - b.w - MARGIN) { b.y = H - b.w - MARGIN; b.vy = -Math.abs(b.vy); }
      }
      // 两两碰撞：重叠分离 + 沿法线交换速度（弹性）
      for (let i = 0; i < bodies.length; i++) {
        for (let j = i + 1; j < bodies.length; j++) {
          const a = bodies[i], b = bodies[j];
          const ra = radiusOf(a.w), rb = radiusOf(b.w);
          const dx = b.x - a.x, dy = b.y - a.y;
          const d = Math.hypot(dx, dy);
          const minD = ra + rb;
          if (d < minD && d > 0.001) {
            const nx = dx / d, ny = dy / d;
            const overlap = (minD - d) / 2;
            a.x -= nx * overlap; a.y -= ny * overlap;
            b.x += nx * overlap; b.y += ny * overlap;
            const va = a.vx * nx + a.vy * ny;
            const vb = b.vx * nx + b.vy * ny;
            a.vx += (vb - va) * nx * 0.9; a.vy += (vb - va) * ny * 0.9;
            b.vx += (va - vb) * nx * 0.9; b.vy += (va - vb) * ny * 0.9;
          }
        }
      }
      // 直写 DOM（不经 React state，避免每帧重渲染）
      cardElRefs.current.forEach((el, i) => {
        if (el && bodies[i]) {
          el.style.left = `${bodies[i].x}px`;
          el.style.top = `${bodies[i].y}px`;
        }
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

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
    <div className="h-full flex flex-col relative">
      {/* 主内容：气泡场景 + 右侧对话面板（dock 上下满高，底部栏仅占左下） */}
      <div className="flex-1 min-h-0 flex gap-2.5 pl-3 pr-3 pt-3 pb-[22px]">
        <div ref={areaRef} className="flex-1 min-w-0 flex items-center justify-center overflow-hidden">
          <div className="wb-scene">
            {WORKBENCH_CARDS.map((card, i) => {
              const Icon = card.icon;
              return (
                <div
                  key={card.key}
                  ref={(el) => { cardElRefs.current[i] = el; }}
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
                  <p className="text-xs font-bold text-gray-900 leading-tight">面试助手</p>
                  <p className="text-[10px] text-gray-400 leading-tight">快速问答 · 随时可用</p>
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
                  <div className="wb-dock-chat">
                    <AgentChat
                      conversationId={dockConvId}
                      conversationType={dockConvType}
                      onConversationUpdate={() => {}}
                    />
                  </div>
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

      {/* Bottom bar：窄条，只占左下角，右侧全部让给对话面板 */}
      <div className="absolute bottom-1.5 left-4 z-10 flex items-center gap-2 bg-gradient-to-r from-white/0 to-transparent pointer-events-none">
        <span className="text-xs text-gray-400 select-none pointer-events-auto">EasyWork 面试助手 v{appVersion}</span>
        <button
          onClick={() => setShowModel(true)}
          className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-gray-500 rounded-lg transition-colors pointer-events-auto"
        >
          <Settings size={14} />
          设置
        </button>
      </div>

      {showModel && (
        <ModelDownloadDialog
          onDone={() => setShowModel(false)}
          onClose={() => setShowModel(false)}
        />
      )}
    </div>
  );
}

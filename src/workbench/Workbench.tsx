// EasyWork - Workbench (landing page, 水滴气泡动态卡片)
import { useState, useEffect } from "react";
import { FileText, BookOpen, Rocket, Bot, FileSearch, MessageSquareHeart, Settings } from "lucide-react";
import { getVersion } from "@tauri-apps/api/app";
import ModelDownloadDialog from "../settings/ModelDownloadDialog";
import type { CSSProperties } from "react";

// 每张卡片的形状/配色/浮动相位（水滴气泡风格）
const WORKBENCH_CARDS: {
  key: string;
  icon: typeof FileText;
  title: string;
  desc: string;
  action: string;
  style: CSSProperties;
}[] = [
  {
    key: "history",
    icon: FileText,
    title: "面试记录",
    desc: "录制 · 转写 · AI 复盘",
    action: "history",
    style: { "--br": "46% 54% 56% 44% / 56% 46% 54% 44%", "--tbg": "#f0f2ff", "--tcolor": "#2a36e0", "--hb": "#bcc5ff", "--delay": "0s", "--dur": "4.2s" } as CSSProperties,
  },
  {
    key: "questions",
    icon: BookOpen,
    title: "我的题库",
    desc: "面试官问题 · 分类复习",
    action: "questions",
    style: { "--br": "58% 42% 48% 52% / 46% 56% 44% 54%", "--tbg": "#f5f3ff", "--tcolor": "#7c3aed", "--hb": "#ddd6fe", "--delay": ".5s", "--dur": "4.6s" } as CSSProperties,
  },
  {
    key: "apply",
    icon: Rocket,
    title: "前往投递",
    desc: "我的投递工作台",
    action: "apply",
    style: { "--br": "50% 58% 44% 50% / 52% 44% 56% 48%", "--tbg": "#eff6ff", "--tcolor": "#2563eb", "--hb": "#bfdbfe", "--delay": "1s", "--dur": "4.4s" } as CSSProperties,
  },
  {
    key: "agent",
    icon: Bot,
    title: "面试助手",
    desc: "智能问答 · 复盘 · 求职档案",
    action: "agent",
    style: { "--br": "44% 50% 54% 46% / 58% 46% 52% 44%", "--tbg": "#ecfdf5", "--tcolor": "#059669", "--hb": "#a7f3d0", "--delay": "1.5s", "--dur": "4.8s" } as CSSProperties,
  },
  {
    key: "resume",
    icon: FileSearch,
    title: "简历顾问",
    desc: "简历分析 · JD 匹配 · 优化",
    action: "resume",
    style: { "--br": "54% 46% 50% 56% / 46% 58% 44% 52%", "--tbg": "#fffbeb", "--tcolor": "#d97706", "--hb": "#fde68a", "--delay": "2s", "--dur": "4.3s" } as CSSProperties,
  },
  {
    key: "feedback",
    icon: MessageSquareHeart,
    title: "意见反馈",
    desc: "变得更强",
    action: "feedback",
    style: { "--br": "48% 52% 46% 54% / 54% 48% 52% 46%", "--tbg": "#fff1f2", "--tcolor": "#e11d48", "--hb": "#fecdd3", "--delay": "2.5s", "--dur": "4.7s" } as CSSProperties,
  },
];

export default function Workbench({ onEnter }: { onEnter: (title?: string, action?: string) => void }) {
  const [showModel, setShowModel] = useState(false);
  const [appVersion, setAppVersion] = useState("");
  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => setAppVersion(""));
  }, []);

  return (
    <div className="h-full flex flex-col">
      {/* Main content */}
      <div className="flex-1 flex items-center justify-center overflow-y-auto">
        <div className="grid grid-cols-2 gap-x-10 gap-y-8 max-w-2xl mx-auto px-6 py-6">
          {WORKBENCH_CARDS.map((card) => {
            const Icon = card.icon;
            return (
              <button
                key={card.key}
                onClick={() => onEnter(undefined, card.action)}
                className="wb-card"
                style={card.style}
              >
                <div className="wb-icon">
                  <Icon size={28} />
                </div>
                <h3>{card.title}</h3>
                <p>{card.desc}</p>
              </button>
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

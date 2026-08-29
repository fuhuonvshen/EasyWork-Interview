// EasyWork - Workbench (landing page, 原版简洁风格)
import { useState, useEffect } from "react";
import { FileText, CalendarDays, BarChart3, Bot, FileSearch, Target, Settings, MessageSquareHeart } from "lucide-react";
import { getVersion } from "@tauri-apps/api/app";
import ModelDownloadDialog from "../settings/ModelDownloadDialog";

const WORKBENCH_CARDS = [
  {
    key: "history",
    icon: FileText,
    title: "面试记录",
    desc: "录制 · 转写 · AI 复盘",
    color: "bg-accent-50 text-accent-600",
    hoverColor: "hover:bg-accent-100 hover:border-accent-200",
    action: "history",
  },
  {
    key: "schedule",
    icon: CalendarDays,
    title: "面试日程",
    desc: "投递 · 一面 · Offer 全流程",
    color: "bg-blue-50 text-blue-600",
    hoverColor: "hover:bg-blue-100 hover:border-blue-200",
    action: "schedule",
  },
  {
    key: "reports",
    icon: BarChart3,
    title: "复盘报告",
    desc: "投递统计 · 通过率 · 对比",
    color: "bg-violet-50 text-violet-600",
    hoverColor: "hover:bg-violet-100 hover:border-violet-200",
    action: "reports",
  },
  {
    key: "agent",
    icon: Bot,
    title: "面试助手",
    desc: "智能问答 · 复盘 · 求职档案",
    color: "bg-emerald-50 text-emerald-600",
    hoverColor: "hover:bg-emerald-100 hover:border-emerald-200",
    action: "agent",
  },
  {
    key: "resume",
    icon: FileSearch,
    title: "简历顾问",
    desc: "简历分析 · JD 匹配 · 优化",
    color: "bg-amber-50 text-amber-600",
    hoverColor: "hover:bg-amber-100 hover:border-amber-200",
    action: "resume",
  },
  {
    key: "mock",
    icon: Target,
    title: "模拟面试",
    desc: "按岗位出题 · 逐题点评 · 评分报告",
    color: "bg-fuchsia-50 text-fuchsia-600",
    hoverColor: "hover:bg-fuchsia-100 hover:border-fuchsia-200",
    action: "mock",
  },
] as const;

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
        <div className="grid grid-cols-2 gap-6 max-w-2xl mx-auto px-4 py-4">
          {WORKBENCH_CARDS.map((card) => {
            const Icon = card.icon;
            return (
              <button
                key={card.key}
                onClick={() => onEnter(undefined, card.action)}
                className={`group flex flex-col items-center justify-center p-8 rounded-3xl bg-white border border-gray-100 shadow-sm transition-all ${card.hoverColor} hover:shadow-md active:scale-[0.97]`}
                style={{ minHeight: "172px" }}
              >
                <div className={`w-16 h-16 rounded-2xl ${card.color} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform`}>
                  <Icon size={32} />
                </div>
                <h3 className="text-base font-semibold text-gray-900 mb-1.5">{card.title}</h3>
                <p className="text-sm text-gray-400 text-center leading-relaxed">{card.desc}</p>
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
        <div className="flex items-center gap-2">
          <button
            onClick={() => onEnter(undefined, "feedback")}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-500 rounded-lg transition-colors"
          >
            <MessageSquareHeart size={14} />
            反馈
          </button>
          <button
            onClick={() => setShowModel(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-500 rounded-lg transition-colors"
          >
            <Settings size={14} />
            设置
          </button>
        </div>
      </div>
    </div>
  );
}

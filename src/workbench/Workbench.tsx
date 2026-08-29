// EasyWork - 面试工作台 (landing page)
import { useState, useEffect } from "react";
import { Mic, CalendarClock, BarChart3, Bot, FileSearch, Target, Settings, MessageSquareHeart } from "lucide-react";
import { getVersion } from "@tauri-apps/api/app";
import ModelDownloadDialog from "../settings/ModelDownloadDialog";

// 卡片配置：key 用于 action 路由，color 定义渐变主色
const CARDS = [
  {
    key: "history",
    icon: Mic,
    title: "面试记录",
    desc: "录制 · 转写 · AI 复盘",
    gradient: "from-emerald-400 to-teal-500",
    glow: "shadow-emerald-500/30",
    action: "history",
  },
  {
    key: "schedule",
    icon: CalendarClock,
    title: "面试日程",
    desc: "投递 · 一面 · Offer 全流程",
    gradient: "from-sky-400 to-indigo-500",
    glow: "shadow-sky-500/30",
    action: "schedule",
  },
  {
    key: "reports",
    icon: BarChart3,
    title: "复盘报告",
    desc: "投递统计 · 通过率 · 对比",
    gradient: "from-violet-400 to-purple-500",
    glow: "shadow-violet-500/30",
    action: "reports",
  },
  {
    key: "agent",
    icon: Bot,
    title: "面试助手",
    desc: "问答 · 复盘 · 求职档案",
    gradient: "from-teal-400 to-cyan-500",
    glow: "shadow-teal-500/30",
    action: "agent",
  },
  {
    key: "resume",
    icon: FileSearch,
    title: "简历顾问",
    desc: "简历解析 · JD 匹配 · 优化",
    gradient: "from-amber-400 to-orange-500",
    glow: "shadow-amber-500/30",
    action: "resume",
  },
  {
    key: "mock",
    icon: Target,
    title: "题库与模拟",
    desc: "模拟面试 · 题库 · 押题",
    gradient: "from-fuchsia-400 to-pink-500",
    glow: "shadow-fuchsia-500/30",
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
      {/* 主内容区 */}
      <div className="flex-1 flex items-center justify-center">
        <div className="w-full max-w-4xl px-8">
          {/* 欢迎区 */}
          <div className="text-center mb-10">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/70 border border-emerald-100 text-emerald-700 text-xs font-semibold shadow-sm mb-4">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              求职备考 · 隐私优先 · 本地 AI
            </div>
            <h1 className="text-3xl font-bold text-gray-900 tracking-tight">
              面试<span className="bg-gradient-to-r from-emerald-500 to-teal-500 bg-clip-text text-transparent">工作台</span>
            </h1>
            <p className="text-sm text-gray-400 mt-2">记录每一场面试，让 AI 帮你复盘、改进、拿下 Offer</p>
          </div>

          <div className="grid grid-cols-3 gap-5">
            {CARDS.map((card) => {
              const Icon = card.icon;
              return (
                <button
                  key={card.key}
                  onClick={() => onEnter(undefined, card.action)}
                  className="group relative flex flex-col items-center justify-center p-7 rounded-3xl bg-white/85 backdrop-blur-md border border-white/60 shadow-sm hover:shadow-xl transition-all duration-200 hover:-translate-y-1 active:scale-[0.98] overflow-hidden"
                  style={{ minHeight: "168px" }}
                >
                  {/* 顶部渐变光条 */}
                  <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${card.gradient} opacity-0 group-hover:opacity-100 transition-opacity`} />
                  {/* 图标 */}
                  <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${card.gradient} text-white flex items-center justify-center mb-4 shadow-lg ${card.glow} group-hover:scale-110 group-hover:rotate-3 transition-transform duration-200`}>
                    <Icon size={26} strokeWidth={2.2} />
                  </div>
                  <h3 className="text-base font-semibold text-gray-900 mb-1">{card.title}</h3>
                  <p className="text-xs text-gray-400 leading-relaxed">{card.desc}</p>
                </button>
              );
            })}
          </div>
        </div>

        {showModel && (
          <ModelDownloadDialog
            onDone={() => setShowModel(false)}
            onClose={() => setShowModel(false)}
          />
        )}
      </div>

      {/* 底部栏 */}
      <div className="flex items-center justify-between px-8 py-3 flex-shrink-0">
        <span className="text-xs text-gray-400 select-none">EasyWork 面试助手 v{appVersion}</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => onEnter(undefined, "feedback")}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-400 hover:text-gray-600 rounded-lg transition-colors"
          >
            <MessageSquareHeart size={13} />
            反馈
          </button>
          <button
            onClick={() => setShowModel(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 rounded-lg transition-colors"
          >
            <Settings size={13} />
            设置
          </button>
        </div>
      </div>
    </div>
  );
}

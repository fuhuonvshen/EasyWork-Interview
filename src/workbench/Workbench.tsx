// EasyWork - Workbench (landing page)
import { useState, useEffect } from "react";
import { FileText, Video, Bot, MessageSquareHeart, Settings } from "lucide-react";
import { getVersion } from "@tauri-apps/api/app";
import ModelDownloadDialog from "../settings/ModelDownloadDialog";

const WORKBENCH_CARDS = [
  {
    key: "minutes",
    icon: FileText,
    title: "会议纪要",
    desc: "录制 · 转写 · AI 纪要",
    color: "bg-accent-50 text-accent-600",
    hoverColor: "hover:bg-accent-100 hover:border-accent-200",
    action: "history",
  },
  {
    key: "screen",
    icon: Video,
    title: "共享屏幕",
    desc: "屏幕共享与录制",
    color: "bg-blue-50 text-blue-600",
    hoverColor: "hover:bg-blue-100 hover:border-blue-200",
    placeholder: true,
  },
  {
    key: "agent",
    icon: Bot,
    title: "办公助手",
    desc: "智能问答 · 生产报告 · 待办管理",
    color: "bg-emerald-50 text-emerald-600",
    hoverColor: "hover:bg-emerald-100 hover:border-emerald-200",
    action: "agent" as const,
  },
  {
    key: "feedback",
    icon: MessageSquareHeart,
    title: "意见反馈",
    desc: "变得更强",
    color: "bg-amber-50 text-amber-600",
    hoverColor: "hover:bg-amber-100 hover:border-amber-200",
    action: "feedback" as const,
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
      <div className="flex-1 flex items-center justify-center">
        <div className="grid grid-cols-2 gap-6 max-w-2xl mx-auto px-4">
          {WORKBENCH_CARDS.map((card) => {
            const Icon = card.icon;
            const isPlaceholder = "placeholder" in card;
            return (
              <button
                key={card.key}
                onClick={() => {
                  if (!isPlaceholder) {
                    if (card.key === "agent") {
                      onEnter(undefined, "agent");
                    } else {
                      onEnter(undefined, card.action as string);
                    }
                  }
                }}
                disabled={isPlaceholder}
                className={`group flex flex-col items-center justify-center p-10 rounded-3xl bg-white border border-gray-100 shadow-sm transition-all ${
                  isPlaceholder
                    ? "opacity-50 cursor-not-allowed"
                    : `${card.hoverColor} hover:shadow-md active:scale-[0.97]`
                }`}
                style={{ minHeight: "200px" }}
              >
                <div className={`w-16 h-16 rounded-2xl ${card.color} flex items-center justify-center mb-4 ${!isPlaceholder ? "group-hover:scale-110" : ""} transition-transform`}>
                  <Icon size={32} />
                </div>
                <h3 className="text-base font-semibold text-gray-900 mb-1.5">{card.title}</h3>
                <p className="text-sm text-gray-400 text-center leading-relaxed">{card.desc}</p>
                {isPlaceholder && (
                  <span className="mt-2.5 text-[10px] text-gray-300 bg-gray-50 px-2.5 py-1 rounded-full">即将上线</span>
                )}
              </button>
            );
          })}
        </div>

        {/* 设置 — 由底部栏管理 */}

        {showModel && (
          <ModelDownloadDialog
            onDone={() => setShowModel(false)}
            onClose={() => setShowModel(false)}
          />
        )}
      </div>

      {/* Bottom bar */}
      <div className="flex items-center justify-between px-8 py-3 flex-shrink-0">
        <span className="text-xs text-gray-400 select-none">EasyWork v{appVersion}</span>
        <div className="flex items-center gap-2">
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
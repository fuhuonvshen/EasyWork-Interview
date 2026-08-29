// EasyWork - Minutes app sidebar
import { ArrowLeft } from "lucide-react";
import { CalendarDays, FileText, Clock } from "lucide-react";
import type { MinutesTab } from "../../types";

const TABS: { key: MinutesTab; icon: typeof CalendarDays; label: string }[] = [
  { key: "today", icon: CalendarDays, label: "今日会议" },
  { key: "history", icon: FileText, label: "历史纪要" },
  { key: "schedule", icon: Clock, label: "日程" },
];

export default function MinutesSidebar({
  tab,
  onTabChange,
  historySubTab,
  onHistorySubTabChange,
  isBusy,
  onBack,
}: {
  tab: MinutesTab;
  onTabChange: (tab: MinutesTab) => void;
  historySubTab: "meetings" | "week" | "month";
  onHistorySubTabChange: (sub: "meetings" | "week" | "month") => void;
  isBusy: boolean;
  onBack: () => void;
}) {
  return (
    <aside className="w-56 bg-white rounded-lg overflow-hidden flex flex-col flex-shrink-0">
      <div className="px-4 py-4 border-b border-gray-50">
        <button
          onClick={onBack}
          disabled={isBusy}
          className={`flex items-center gap-1.5 text-xs transition-colors mb-2 ${
            isBusy ? "text-gray-300 cursor-not-allowed" : "text-gray-400 hover:text-gray-700"
          }`}
          title={isBusy ? "请先停止录制" : undefined}
        >
          <ArrowLeft size={14} />
          返回工作台
        </button>
        <h1 className="text-xl font-bold text-gray-900">会议纪要</h1>
      </div>

      <nav className="flex-1 px-2 py-2 space-y-1 overflow-y-auto">
        {TABS.map(({ key, icon: Icon, label }) => {
          const disabled = isBusy && key !== "today";
          return (
            <div key={key}>
              <button
                onClick={() => { if (!disabled) { onTabChange(key); } }}
                disabled={disabled}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-colors ${
                  disabled
                    ? "text-gray-300 cursor-not-allowed"
                    : tab === key
                      ? "bg-brand-50 text-brand-700"
                      : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                }`}
                title={disabled ? "录制中无法切换" : undefined}
              >
                <Icon size={20} />
                {label}
              </button>
              {key === "history" && tab === "history" && (
                <div className="ml-3 mt-0.5 space-y-0.5">
                  <button
                    onClick={() => onHistorySubTabChange("meetings")}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      historySubTab === "meetings" ? "text-brand-700 bg-brand-50" : "text-gray-500 hover:bg-gray-50"
                    }`}
                  >
                    会议记录
                  </button>
                  <button
                    onClick={() => onHistorySubTabChange("week")}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      historySubTab === "week" ? "text-brand-700 bg-brand-50" : "text-gray-500 hover:bg-gray-50"
                    }`}
                  >
                    周报
                  </button>
                  <button
                    onClick={() => onHistorySubTabChange("month")}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      historySubTab === "month" ? "text-brand-700 bg-brand-50" : "text-gray-500 hover:bg-gray-50"
                    }`}
                  >
                    月报
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}

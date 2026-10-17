// EasyWork - Interview app sidebar
import { ArrowLeft } from "lucide-react";
import { CalendarDays, FileText, Clock } from "lucide-react";
import type { MinutesTab } from "../../types";

const TABS: { key: MinutesTab; icon: typeof CalendarDays; label: string }[] = [
  { key: "today", icon: CalendarDays, label: "面试记录" },
  { key: "history", icon: FileText, label: "历史复盘" },
  { key: "schedule", icon: Clock, label: "面试日程" },
];

export default function MinutesSidebar({
  tab,
  onTabChange,
  historySubTab,
  onHistorySubTabChange,
  onBack,
}: {
  tab: MinutesTab;
  onTabChange: (tab: MinutesTab) => void;
  historySubTab: "meetings" | "week" | "month";
  onHistorySubTabChange: (sub: "meetings" | "week" | "month") => void;
  onBack: () => void;
}) {
  return (
    <aside className="w-56 bg-white rounded-lg overflow-hidden flex flex-col flex-shrink-0">
      <div className="px-4 py-4 border-b border-gray-50">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-700 transition-colors mb-2"
        >
          <ArrowLeft size={14} />
          返回工作台
        </button>
        <h1 className="text-xl font-bold text-gray-900">面试记录</h1>
      </div>

      <nav className="flex-1 px-2 py-2 space-y-1 overflow-y-auto">
        {TABS.map(({ key, icon: Icon, label }) => {
          return (
            <div key={key}>
              <button
                onClick={() => onTabChange(key)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-colors ${
                  tab === key
                    ? "bg-brand-50 text-brand-700"
                    : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                }`}
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
                    面试记录
                  </button>
                  <button
                    onClick={() => onHistorySubTabChange("week")}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      historySubTab === "week" ? "text-brand-700 bg-brand-50" : "text-gray-500 hover:bg-gray-50"
                    }`}
                  >
                    复盘周报
                  </button>
                  <button
                    onClick={() => onHistorySubTabChange("month")}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      historySubTab === "month" ? "text-brand-700 bg-brand-50" : "text-gray-500 hover:bg-gray-50"
                    }`}
                  >
                    复盘月报
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

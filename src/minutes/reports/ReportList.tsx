// EasyWork - Saved reports list (weekly/monthly)
import { Sparkles, X } from "lucide-react";
import type { ReportItem } from "../../types";

export default function ReportList({
  reports,
  periodType,
  onView,
  onDelete,
}: {
  reports: ReportItem[];
  periodType: string;
  onView: (content: string) => void;
  onDelete: (id: string) => void;
}) {
  const filtered = reports.filter((r) => r.period_type === periodType);

  return (
    <div className="flex-1 overflow-y-auto px-8 py-4">
      {filtered.length === 0 && (
        <div className="text-center py-16">
          <div className="w-14 h-14 rounded-2xl bg-gray-100 flex items-center justify-center mx-auto mb-4">
            <Sparkles size={26} className="text-gray-300" />
          </div>
          <p className="text-sm text-gray-400 pointer-events-none">暂无{periodType === "week" ? "周报" : "月报"}</p>
        </div>
      )}
      <div className="space-y-2">
        {filtered.map((r) => (
          <div
            key={r.id}
            className="flex items-center gap-4 px-5 py-4 rounded-xl bg-white border border-gray-100 shadow-sm hover:shadow-md hover:border-brand-200 transition-all group"
          >
            <button
              onClick={() => onView(r.content)}
              className="flex-1 text-left min-w-0"
            >
              <p className="text-sm font-semibold text-gray-900">{r.period_label}</p>
              <p className="text-xs text-gray-400 mt-0.5 line-clamp-1">{r.content.slice(0, 100)}</p>
            </button>
            <button
              onClick={() => onDelete(r.id)}
              className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
              title="删除"
            >
              <X size={15} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// EasyWork - Schedule View (calendar + schedule management)
import { FileText, Plus, X } from "lucide-react";
import ConfirmDialog from "../components/ConfirmDialog";
import { useSchedule } from "./useSchedule";
import CalendarGrid from "./CalendarGrid";
import DayDetailPanel from "./DayDetailPanel";
import ScheduleForm from "./ScheduleForm";
import ReportModal from "./ReportModal";

export default function ScheduleView({
  onNavigateRecording,
  onViewMinutes,
  onReportsChanged,
}: {
  onNavigateRecording: (title: string, scheduleId?: string) => void;
  onViewMinutes: (id: string) => void;
  onReportsChanged: () => void;
}) {
  const h = useSchedule(onReportsChanged);
  const todayStr = new Date().toISOString().slice(0, 10);
  const isPastDate = h.selectedDate ? h.selectedDate < todayStr : false;

  return (
    <>
      <header className="px-8 py-4 bg-white flex items-center justify-between">
        <div>
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wider pointer-events-none">日历视图 · 会议日程 · 工作报告</p>
          <h2 className="text-2xl font-semibold text-gray-900 mt-1">日程管理</h2>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => h.generateReport("week")}
            disabled={h.loadingReport}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-50 transition-colors"
          >
            <FileText size={15} />周报
          </button>
          <button
            onClick={() => h.generateReport("month")}
            disabled={h.loadingReport}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-50 transition-colors"
          >
            <FileText size={15} />月报
          </button>
          <button
            onClick={() => { h.openNewForm(); }}
            disabled={isPastDate}
            title={isPastDate ? "无法为过去的日期创建日程" : "新建日程"}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-xl transition-all ${
              isPastDate
                ? "bg-gray-100 text-gray-300 cursor-not-allowed"
                : "bg-brand-600 text-white hover:bg-brand-700 active:scale-95"
            }`}
          >
            <Plus size={16} />
            新建日程
          </button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        <CalendarGrid
          viewYear={h.viewYear}
          viewMonth={h.viewMonth}
          selectedDate={h.selectedDate}
          todayStr={todayStr}
          scheduled={h.scheduled}
          onSelectDate={h.setSelectedDate}
          onPrevMonth={h.prevMonth}
          onNextMonth={h.nextMonth}
        />

        {h.selectedDate && (
          <DayDetailPanel
            selectedDate={h.selectedDate}
            meetings={h.dateMeetings}
            onClose={() => h.setSelectedDate(null)}
            onEdit={h.handleEdit}
            onDelete={(m) => h.setDeleteTarget(m)}
            onViewMinutes={onViewMinutes}
            onNavigateRecording={onNavigateRecording}
          />
        )}
      </div>

      <ReportModal
        report={h.report}
        loading={h.loadingReport}
        onClose={() => h.setReport(null)}
      />

      <ConfirmDialog
        open={!!h.deleteTarget}
        icon={<X size={24} className="text-red-500" />}
        title="删除日程"
        description={`确定要删除此日程吗？此操作不可撤销。\n"${h.deleteTarget?.title}"`}
        onConfirm={() => h.deleteTarget && h.confirmDelete(h.deleteTarget.id)}
        onCancel={() => h.setDeleteTarget(null)}
      />

      {h.showForm && (
        <ScheduleForm
          editingMeeting={h.editingMeeting}
          initialDate={h.selectedDate || todayStr}
          onSubmit={h.handleFormSubmit}
          onCancel={() => { h.setShowForm(false); h.setEditingMeeting(null); }}
        />
      )}
    </>
  );
}

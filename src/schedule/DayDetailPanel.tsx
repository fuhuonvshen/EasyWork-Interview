// EasyWork - Right side panel showing meetings for the selected date
import { X, Clock, Video, Pencil } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import type { ScheduledMeeting } from "../types";

interface Props {
  selectedDate: string;
  meetings: ScheduledMeeting[];
  onClose: () => void;
  onEdit: (m: ScheduledMeeting) => void;
  onDelete: (m: ScheduledMeeting) => void;
  onViewMinutes: (id: string) => void;
  onNavigateRecording: (title: string, scheduleId?: string) => void;
}

export default function DayDetailPanel({
  selectedDate, meetings, onClose, onEdit, onDelete, onViewMinutes, onNavigateRecording,
}: Props) {
  return (
    <aside className="w-80 border-l border-gray-100 bg-white flex flex-col flex-shrink-0 overflow-y-auto">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
        <div>
          <h4 className="text-sm font-semibold text-gray-900">{selectedDate}</h4>
          <p className="text-xs text-gray-400 mt-0.5">{meetings.length} 个日程</p>
        </div>
        <button onClick={onClose} aria-label="关闭详情" className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
          <X size={16} />
        </button>
      </div>
      <div className="flex-1 px-4 py-3 space-y-2.5">
        {meetings.length === 0 && (
          <div className="text-center py-10">
            <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center mx-auto mb-3">
              <Clock size={20} className="text-gray-300" />
            </div>
            <p className="text-sm text-gray-400 pointer-events-none">当天无日程</p>
          </div>
        )}
        {meetings.map((m) => (
          <div key={m.id} className="p-4 rounded-xl bg-white border border-gray-100 shadow-sm hover:shadow-md hover:border-gray-200 transition-all">
            <button
              className="flex items-start gap-3 w-full text-left cursor-pointer"
              onClick={async () => {
                try {
                  const id = await invoke<string | null>("find_meeting_by_schedule", { scheduleId: m.id });
                  if (id) onViewMinutes(id);
                } catch {}
              }}
              title="点击查看历史纪要"
              aria-label={`查看 ${m.title} 的纪要`}
            >
              <div className="flex-shrink-0 px-2.5 py-1 rounded-lg bg-brand-50 text-brand-700 text-xs font-semibold text-center leading-tight">
                {m.start_time.slice(11, 16)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 leading-snug group-hover:text-brand-600 transition-colors">{m.title}</p>
              </div>
            </button>
            <div className="flex items-center justify-end gap-1.5 mt-3 pt-3 border-t border-gray-50">
              {m.zoom_url && (
                <button
                  onClick={() => { invoke("launch_meeting_link", { url: m.zoom_url }); onNavigateRecording(m.title, m.id); }}
                  aria-label={`加入 ${m.title}`}
                  className="flex items-center gap-1 px-3 py-1.5 bg-brand-500 text-white text-xs font-medium rounded-lg hover:bg-brand-700 active:scale-95 transition-all"
                >
                  <Video size={12} /> 入会
                </button>
              )}
              <button
                onClick={() => onEdit(m)}
                aria-label={`编辑 ${m.title}`}
                className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 active:scale-95 transition-all"
              >
                <Pencil size={12} /> 编辑
              </button>
              <button
                onClick={() => onDelete(m)}
                aria-label={`删除 ${m.title}`}
                className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-500 bg-gray-50 rounded-lg hover:bg-red-50 hover:text-red-600 active:scale-95 transition-all"
              >
                <X size={12} /> 删除
              </button>
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}
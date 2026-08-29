// EasyWork - Create / edit scheduled meeting form modal
import { useState, useId } from "react";
import type { ScheduledMeeting } from "../types";

interface Props {
  editingMeeting: ScheduledMeeting | null;
  initialDate?: string;
  onSubmit: (data: { title: string; zoomUrl: string; date: string; time: string }) => void;
  onCancel: () => void;
}

export default function ScheduleForm({ editingMeeting, initialDate, onSubmit, onCancel }: Props) {
  const uid = useId();
  const [title, setTitle] = useState(editingMeeting?.title ?? "");
  const [zoomUrl, setZoomUrl] = useState(editingMeeting?.zoom_url ?? "");
  const [date, setDate] = useState(editingMeeting?.start_time.slice(0, 10) ?? initialDate ?? "");
  const [time, setTime] = useState(editingMeeting?.start_time.slice(11, 16) ?? "");

  const canSubmit = title.trim() && date && time;

  const handleSubmit = () => {
    if (!canSubmit) return;
    onSubmit({ title: title.trim(), zoomUrl: zoomUrl.trim(), date, time });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 mx-4">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">{editingMeeting ? "编辑日程" : "新建日程"}</h2>
        <div className="space-y-3">
          <div>
            <label htmlFor={`${uid}-title`} className="block text-xs font-medium text-gray-500 mb-1">会议标题</label>
            <input id={`${uid}-title`} type="text" placeholder="会议标题" value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300" />
          </div>
          <div>
            <label htmlFor={`${uid}-zoom`} className="block text-xs font-medium text-gray-500 mb-1">会议链接</label>
            <input id={`${uid}-zoom`} type="url" placeholder="会议链接 (可选)" value={zoomUrl}
              onChange={(e) => setZoomUrl(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300" />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label htmlFor={`${uid}-date`} className="block text-xs font-medium text-gray-500 mb-1">日期</label>
              <input id={`${uid}-date`} type="date" value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300" />
            </div>
            <div className="flex-1">
              <label htmlFor={`${uid}-time`} className="block text-xs font-medium text-gray-500 mb-1">时间</label>
              <input id={`${uid}-time`} type="time" value={time}
                onChange={(e) => setTime(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300" />
            </div>
          </div>
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={onCancel}
            className="flex-1 px-4 py-2.5 border border-gray-200 text-gray-600 text-sm font-medium rounded-xl hover:bg-gray-50 transition-colors">
            取消
          </button>
          <button onClick={handleSubmit} disabled={!canSubmit}
            className="flex-1 px-4 py-2.5 bg-brand-600 text-white text-sm font-medium rounded-xl hover:bg-brand-700 disabled:opacity-40 transition-colors">
            {editingMeeting ? "保存" : "添加"}
          </button>
        </div>
      </div>
    </div>
  );
}

// EasyWork - 日程提醒弹窗
import { invoke } from "@tauri-apps/api/core";
import { Clock } from "lucide-react";

interface ReminderModalProps {
  reminder: { id: string; title: string; startTime: string; zoomUrl: string };
  onGo: (reminder: { id: string; title: string; startTime: string; zoomUrl: string }) => void;
  onClose: () => void;
}

export default function ReminderModal({ reminder, onGo, onClose }: ReminderModalProps) {
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in">
      <div className="bg-white rounded-2xl shadow-2xl p-8 mx-4 max-w-sm w-full text-center animate-in zoom-in">
        <div className="w-16 h-16 rounded-full bg-brand-100 flex items-center justify-center mx-auto mb-4">
          <Clock size={32} className="text-brand-600" />
        </div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">会议提醒</h2>
        <p className="text-base text-gray-700 font-medium mb-1">{reminder.title}</p>
        <p className="text-sm text-gray-400 mb-6">
          {reminder.startTime.slice(11, 16)} 开始
        </p>
        <div className="flex gap-3 justify-center">
          <button
            onClick={onClose}
            className="px-6 py-2.5 text-sm font-medium text-gray-600 bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors"
          >
            取消
          </button>
          <button
            onClick={async () => {
              if (reminder.zoomUrl) {
                await invoke("launch_meeting_link", { url: reminder.zoomUrl });
              }
              await invoke("dismiss_reminder");
              onGo(reminder);
            }}
            className="px-6 py-2.5 text-sm font-medium text-white bg-brand-600 rounded-xl hover:bg-brand-700 transition-colors"
          >
            前往
          </button>
        </div>
      </div>
    </div>
  );
}

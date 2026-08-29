// EasyWork - Single day cell in the calendar grid
import type { ScheduledMeeting } from "../types";

const MAX_VISIBLE_MEETINGS = 3;

interface Props {
  day: number;
  kind: "prev" | "current" | "next";
  meetings: ScheduledMeeting[];
  isToday: boolean;
  isSelected: boolean;
  onSelect: (dateStr: string) => void;
  dateStr: string;
}

const WEEKDAY_NAMES = ["日", "一", "二", "三", "四", "五", "六"];

export default function CalendarDayCell({ day, kind, meetings, isToday, isSelected, onSelect, dateStr }: Props) {
  const isEdge = kind !== "current";
  const isCurrent = kind === "current";

  let ariaLabel: string;
  if (isCurrent) {
    const d = new Date(dateStr);
    const wd = WEEKDAY_NAMES[d.getDay()];
    ariaLabel = `${dateStr} 星期${wd}`;
    if (isToday) ariaLabel += "，今天";
    if (meetings.length > 0) ariaLabel += `，${meetings.length} 个会议`;
  } else {
    const prefix = kind === "prev" ? "上月" : "下月";
    ariaLabel = `${prefix} ${day}日`;
  }

  return (
    <td
      role="gridcell"
      aria-selected={isCurrent ? isSelected : undefined}
      aria-label={ariaLabel}
      className={`border border-gray-200 ${isEdge ? "bg-gray-50" : isSelected ? "bg-brand-50" : "bg-white"}`}
    >
      <button
        onClick={() => isCurrent && onSelect(dateStr)}
        disabled={isEdge}
        tabIndex={isEdge ? -1 : 0}
        className="w-full min-h-[100px] flex flex-col items-center transition-colors hover:bg-gray-50/50 focus:outline-none focus:ring-2 focus:ring-brand-300 focus:ring-inset"
      >
        <div className="flex items-center justify-center py-1.5">
          <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-medium ${
            isEdge ? "text-gray-300" : isToday ? "bg-brand-600 text-white" : "text-gray-500"
          }`}>
            {day}
          </span>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center p-1 w-full">
          {isCurrent && meetings.length === 0 && (
            <span className="text-[10px] text-gray-300">-</span>
          )}
          {isCurrent && meetings.slice(0, MAX_VISIBLE_MEETINGS).map((m) => (
            <div key={m.id} className="text-[10px] leading-tight px-1 py-0.5 rounded bg-brand-100 text-brand-700 truncate w-full text-center" title={m.title}>
              {m.start_time.slice(11, 16)} {m.title}
            </div>
          ))}
          {isCurrent && meetings.length > MAX_VISIBLE_MEETINGS && (
            <div className="text-[10px] text-gray-400">+{meetings.length - MAX_VISIBLE_MEETINGS} 更多</div>
          )}
        </div>
      </button>
    </td>
  );
}

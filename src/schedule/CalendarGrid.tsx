// EasyWork - Calendar grid with month navigation
import { useMemo } from "react";
import { ChevronDown } from "lucide-react";
import CalendarDayCell from "./CalendarDayCell";
import { buildCalendarCells, formatDateStr, groupIntoRows, buildMeetingsMap } from "../utils/calendar";
import type { ScheduledMeeting } from "../types";

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

interface Props {
  viewYear: number;
  viewMonth: number;
  selectedDate: string | null;
  todayStr: string;
  scheduled: ScheduledMeeting[];
  onSelectDate: (dateStr: string) => void;
  onPrevMonth: () => void;
  onNextMonth: () => void;
}

export default function CalendarGrid({
  viewYear, viewMonth, selectedDate, todayStr, scheduled,
  onSelectDate, onPrevMonth, onNextMonth,
}: Props) {
  const cells = useMemo(() => buildCalendarCells(viewYear, viewMonth), [viewYear, viewMonth]);
  const rows = useMemo(() => groupIntoRows(cells, 7), [cells]);
  const meetingsByDate = useMemo(() => buildMeetingsMap(scheduled), [scheduled]);

  const monthLabel = `${viewYear}年${viewMonth + 1}月`;

  return (
    <div className="flex-1 overflow-y-auto px-8 py-6">
      <div className="flex items-center justify-between mb-6">
        <button onClick={onPrevMonth} aria-label="上一个月" className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
          <ChevronDown size={18} className="rotate-90" />
        </button>
        <h3 className="text-lg font-semibold text-gray-900">{monthLabel}</h3>
        <button onClick={onNextMonth} aria-label="下一个月" className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
          <ChevronDown size={18} className="-rotate-90" />
        </button>
      </div>

      <div className="rounded-xl overflow-hidden border border-gray-200">
        <table role="grid" aria-label={monthLabel} className="w-full table-fixed border-collapse">
          <thead>
            <tr className="bg-gray-50">
              {WEEKDAYS.map((w) => (
                <th key={w} scope="col" className="text-center text-xs font-medium text-gray-400 py-2 border-b border-gray-200">
                  {w}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri}>
                {row.map((cell, ci) => {
                  const isCurrent = cell.kind === "current";
                  const dateStr = isCurrent
                    ? formatDateStr(viewYear, viewMonth, cell.day)
                    : "";
                  const meetings = isCurrent ? (meetingsByDate.get(dateStr) as ScheduledMeeting[] | undefined) ?? [] : [];
                  const isToday = dateStr === todayStr;
                  const isSelected = dateStr === selectedDate;

                  return (
                    <CalendarDayCell
                      key={`${ri}-${ci}`}
                      day={cell.day}
                      kind={cell.kind}
                      meetings={meetings}
                      isToday={isToday}
                      isSelected={isSelected}
                      onSelect={onSelectDate}
                      dateStr={dateStr}
                    />
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

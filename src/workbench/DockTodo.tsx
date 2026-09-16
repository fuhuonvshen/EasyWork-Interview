// EasyWork - 主控台侧边栏待办面板（上：月历；下：选中日期的待办）
// 侧边栏窄，日历只放日期 + 优先级圆点，具体内容放下半部分
import { useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Loader, Mail, Trash2 } from "lucide-react";
import { buildCalendarCells, formatDateStr } from "../utils/calendar";
import type { TodoItem } from "../types";

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];
const WEEKDAY_NAMES = ["日", "一", "二", "三", "四", "五", "六"];
const MAX_DOTS = 3;

const DOT_COLOR: Record<string, string> = {
  high: "bg-red-500",
  medium: "bg-amber-400",
  low: "bg-slate-300",
};

const PRIORITY_CHIP: Record<string, { label: string; cls: string }> = {
  high: { label: "高", cls: "text-red-600 bg-red-50" },
  medium: { label: "中", cls: "text-amber-600 bg-amber-50" },
  low: { label: "低", cls: "text-gray-500 bg-gray-100" },
};

// 本地日期字符串（不能用 toISOString：会按 UTC 偏移错一天）
function todayLocal(): string {
  const d = new Date();
  return formatDateStr(d.getFullYear(), d.getMonth(), d.getDate());
}

function formatDayLabel(dateStr: string, today: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const wd = WEEKDAY_NAMES[new Date(y, m - 1, d).getDay()];
  const prefix = String(y) === today.slice(0, 4) ? "" : `${y}年`;
  return `${prefix}${m}月${d}日 周${wd}`;
}

interface Props {
  todos: TodoItem[];
  loading: boolean;
  onToggle: (id: string, done: boolean) => void;
  onDelete: (id: string) => void;
}

export default function DockTodo({ todos, loading, onToggle, onDelete }: Props) {
  const today = useMemo(todayLocal, []);
  const [viewYear, setViewYear] = useState(() => new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(() => new Date().getMonth());
  // null = 未排期（没有截止日期的待办）
  const [selectedDate, setSelectedDate] = useState<string | null>(today);

  const byDate = useMemo(() => {
    const map = new Map<string, TodoItem[]>();
    for (const t of todos) {
      if (!t.deadline) continue;
      const key = t.deadline.slice(0, 10);
      const bucket = map.get(key);
      if (bucket) bucket.push(t);
      else map.set(key, [t]);
    }
    return map;
  }, [todos]);

  const undated = useMemo(() => todos.filter((t) => !t.deadline), [todos]);
  const cells = useMemo(() => buildCalendarCells(viewYear, viewMonth), [viewYear, viewMonth]);

  const dayTodos = useMemo(() => {
    const list = selectedDate ? (byDate.get(selectedDate) ?? []) : undated;
    // 未完成排在前面
    return [...list].sort((a, b) => (a.status === "done" ? 1 : 0) - (b.status === "done" ? 1 : 0));
  }, [selectedDate, byDate, undated]);
  const pendingCount = dayTodos.filter((t) => t.status === "pending").length;

  const prevMonth = () => {
    if (viewMonth === 0) { setViewYear(viewYear - 1); setViewMonth(11); }
    else setViewMonth(viewMonth - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewYear(viewYear + 1); setViewMonth(0); }
    else setViewMonth(viewMonth + 1);
  };

  if (loading && todos.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center gap-2 text-xs text-gray-400">
        <Loader size={14} className="animate-spin" /> 加载中...
      </div>
    );
  }

  return (
    <div className="wb-todo">
      <div className="wb-cal">
        <div className="wb-cal-head">
          <span className="wb-cal-title">{viewYear}年{viewMonth + 1}月</span>
          <div className="wb-cal-nav">
            <button type="button" onClick={prevMonth} title="上个月" aria-label="上个月">
              <ChevronLeft size={14} />
            </button>
            <button type="button" onClick={nextMonth} title="下个月" aria-label="下个月">
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
        <div className="wb-cal-week">
          {WEEKDAYS.map((w) => <span key={w}>{w}</span>)}
        </div>
        <div className="wb-cal-grid">
          {cells.map((cell, i) => {
            const edge = cell.kind !== "current";
            const dateStr = edge ? "" : formatDateStr(viewYear, viewMonth, cell.day);
            const pending = edge
              ? []
              : (byDate.get(dateStr) ?? []).filter((t) => t.status === "pending");
            const isToday = !edge && dateStr === today;
            const isSelected = !edge && dateStr === selectedDate;
            const overdue = !edge && pending.length > 0 && dateStr < today;

            const cls = ["wb-cal-cell"];
            if (edge) cls.push("wb-cal-edge");
            if (isToday) cls.push("wb-cal-today");
            if (overdue) cls.push("wb-cal-overdue");
            if (isSelected) cls.push("wb-cal-sel");

            const dots = pending.slice(0, MAX_DOTS);
            const more = pending.length - dots.length;

            return (
              <button
                key={i}
                type="button"
                disabled={edge}
                onClick={() => setSelectedDate(dateStr)}
                className={cls.join(" ")}
                aria-pressed={isSelected}
                aria-label={edge ? undefined : `${dateStr} ${pending.length} 项待办`}
              >
                <span className="wb-cal-day">{cell.day}</span>
                <span className="wb-cal-dots">
                  {dots.map((t) => (
                    <span
                      key={t.id}
                      className={`wb-cal-dot ${DOT_COLOR[t.priority] ?? DOT_COLOR.low}`}
                    />
                  ))}
                  {more > 0 && <span className="wb-cal-more">+{more}</span>}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="wb-todo-detail">
        <div className="wb-todo-detail-head">
          <CalendarDays size={12} className="text-emerald-500 flex-shrink-0" />
          <span className="wb-todo-date">
            {selectedDate ? formatDayLabel(selectedDate, today) : "未排期"}
          </span>
          {selectedDate === today && <span className="wb-todo-today">今天</span>}
          {pendingCount > 0 && (
            <span className="text-[10px] text-gray-400 flex-shrink-0">{pendingCount} 项待完成</span>
          )}
          <div className="flex-1" />
          {undated.length > 0 && (
            <button
              type="button"
              onClick={() => setSelectedDate(selectedDate === null ? today : null)}
              className={`wb-todo-undated ${selectedDate === null ? "active" : ""}`}
              title="没有截止日期的待办"
            >
              未排期 {undated.length}
            </button>
          )}
        </div>

        <div className="wb-todo-list">
          {dayTodos.length === 0 && (
            <p className="text-xs text-gray-400 text-center py-8">
              {selectedDate === null ? "没有未排期的待办" : "这天没有待办"}
            </p>
          )}
          {dayTodos.map((t) => {
            const done = t.status === "done";
            const chip = PRIORITY_CHIP[t.priority] ?? PRIORITY_CHIP.low;
            const overdue = !done && !!t.deadline && t.deadline.slice(0, 10) < today;
            return (
              <div
                key={t.id}
                className="group flex items-center gap-2 px-2 py-2 rounded-xl hover:bg-white/60 transition-colors"
              >
                <input
                  type="checkbox"
                  checked={done}
                  onChange={(e) => onToggle(t.id, e.target.checked)}
                  className="w-3.5 h-3.5 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 flex-shrink-0 cursor-pointer"
                />
                <span
                  className={`flex-1 min-w-0 text-xs truncate ${done ? "line-through text-gray-400" : "text-gray-700"}`}
                  title={t.title}
                >
                  {t.title}
                </span>
                {!done && t.source === "email" && (
                  <span title="来自求职邮件" className="flex-shrink-0">
                    <Mail size={10} className="text-sky-500" />
                  </span>
                )}
                {overdue && (
                  <span className="text-[9.5px] font-medium text-red-600 bg-red-50 px-1.5 py-0.5 rounded-full flex-shrink-0">
                    逾期
                  </span>
                )}
                {!done && (
                  <span className={`text-[9.5px] font-medium px-1.5 py-0.5 rounded-full flex-shrink-0 ${chip.cls}`}>
                    {chip.label}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => onDelete(t.id)}
                  className="p-0.5 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
                  title="删除"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

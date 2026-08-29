// EasyWork - Calendar grid computation utilities
export interface CalendarCell {
  day: number;
  kind: "prev" | "current" | "next";
}

export function buildCalendarCells(year: number, month: number): CalendarCell[] {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startPad = (firstDay.getDay() + 6) % 7;
  const daysInMonth = lastDay.getDate();
  const prevMonthDays = new Date(year, month, 0).getDate();

  const cells: CalendarCell[] = [];
  for (let i = startPad - 1; i >= 0; i--) {
    cells.push({ day: prevMonthDays - i, kind: "prev" });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, kind: "current" });
  }
  const totalCells = Math.ceil((startPad + daysInMonth) / 7) * 7;
  const remaining = totalCells - cells.length;
  for (let d = 1; d <= remaining; d++) {
    cells.push({ day: d, kind: "next" });
  }
  return cells;
}

export function formatDateStr(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function groupIntoRows<T>(cells: T[], cols: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < cells.length; i += cols) {
    rows.push(cells.slice(i, i + cols));
  }
  return rows;
}

export function buildMeetingsMap(scheduled: { start_time: string }[]): Map<string, { start_time: string }[]> {
  const map = new Map<string, { start_time: string }[]>();
  for (const m of scheduled) {
    const date = m.start_time.slice(0, 10);
    let bucket = map.get(date);
    if (!bucket) { bucket = []; map.set(date, bucket); }
    bucket.push(m);
  }
  return map;
}

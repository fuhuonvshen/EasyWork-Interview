// EasyWork - 题库场次的展示元数据（封面配色/标题/难度标签），卡片流与分享弹窗共用
import type { QuestionSession } from "../types";
import { STAGE_LABELS } from "../minutes/history/HistoryDetail";

export const DIFF_LABEL: Record<string, { label: string; cls: string }> = {
  easy: { label: "简单", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  medium: { label: "中等", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  hard: { label: "困难", cls: "bg-rose-50 text-rose-700 border-rose-200" },
};

// 「未归类」卡（无来源会议 / 来源会议已删）在列表里的 key
const UNCAT_KEY = "__uncat__";
const UNCAT_HUE = 218;

export const sessionKey = (s: QuestionSession) => s.meeting_id ?? UNCAT_KEY;

// 公司名 → 稳定色相（djb2）：同一家公司每次进来都是同一个颜色
export function hueFromString(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h % 360;
}

export function coverHue(s: QuestionSession): number {
  if (!s.meeting_id) return UNCAT_HUE;
  const seed = (s.company || s.title || "").trim();
  return seed ? hueFromString(seed) : UNCAT_HUE;
}

export function coverInitial(s: QuestionSession): string {
  const src = (s.company || s.title || "").trim();
  return src ? Array.from(src)[0] : "?";
}

// 会议名可能没起过（录制/导入时留空会存成这些占位标题），这时用公司/岗位兜底
const PLACEHOLDER_TITLES = ["未命名会议", "未命名面试", "未命名", "导入的会议", "导入的面试"];

export function coverTitle(s: QuestionSession): string {
  const t = (s.title || "").trim();
  if (t && !PLACEHOLDER_TITLES.includes(t)) return t;
  const parts = [s.company, s.position].filter(Boolean);
  return parts.join(" ").trim() || t || "未命名面试";
}

// 封面副标题：公司 · 岗位 · 轮次（标题里已经出现的就不重复）
export function coverSub(s: QuestionSession): string {
  if (!s.meeting_id) return "未关联面试记录";
  const title = coverTitle(s);
  const parts: string[] = [];
  if (s.company && !title.includes(s.company)) parts.push(s.company);
  if (s.position && !title.includes(s.position)) parts.push(s.position);
  const stageLabel = s.stage && STAGE_LABELS[s.stage] ? STAGE_LABELS[s.stage].label : "";
  if (stageLabel && !title.includes(stageLabel)) parts.push(stageLabel);
  return parts.join(" · ");
}

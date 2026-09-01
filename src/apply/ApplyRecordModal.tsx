// EasyWork - 投递记录新增/编辑弹窗
import { useState } from "react";
import { Briefcase, X } from "lucide-react";
import { APPLY_STATUS_LABELS, type ApplyRecord, type ApplyStatus } from "../types";

const STATUSES = Object.keys(APPLY_STATUS_LABELS) as ApplyStatus[];

interface Props {
  initial?: ApplyRecord | null;
  /** 从公司库「去投递」预填（company/url） */
  prefill?: { company: string; url: string; site?: string } | null;
  onSave: (rec: {
    company: string;
    position: string;
    url: string;
    site: string;
    status: ApplyStatus;
    notes: string;
  }) => void;
  onClose: () => void;
}

export default function ApplyRecordModal({ initial, prefill, onSave, onClose }: Props) {
  const [company, setCompany] = useState(initial?.company ?? prefill?.company ?? "");
  const [position, setPosition] = useState(initial?.position ?? "");
  const [url, setUrl] = useState(initial?.url ?? prefill?.url ?? "");
  const [site, setSite] = useState(initial?.site ?? prefill?.site ?? "");
  const [status, setStatus] = useState<ApplyStatus>(initial?.status ?? "pending");
  const [notes, setNotes] = useState(initial?.notes ?? "");

  const deriveSite = (u: string) => {
    try {
      const h = new URL(u.startsWith("http") ? u : `https://${u}`).hostname;
      return h.startsWith("www.") ? h.slice(4) : h;
    } catch {
      return "";
    }
  };

  const save = () => {
    const c = company.trim();
    if (!c) return;
    const finalSite = site.trim() || deriveSite(url.trim());
    onSave({
      company: c,
      position: position.trim(),
      url: url.trim(),
      site: finalSite,
      status,
      notes: notes.trim(),
    });
  };

  const inputCls =
    "w-full px-3 py-2 text-xs text-gray-700 bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-300 placeholder-gray-300";

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in">
      <div className="bg-white rounded-2xl shadow-2xl p-6 mx-4 max-w-md w-full animate-in zoom-in">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-gray-900 flex items-center gap-2">
            <Briefcase size={16} className="text-teal-600" />
            {initial ? "编辑投递记录" : "新增投递记录"}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-3">
          <label className="block">
            <span className="block text-[10px] font-medium text-gray-400 mb-1">公司名称 *</span>
            <input className={inputCls} value={company} onChange={(e) => setCompany(e.target.value)} placeholder="如：字节跳动" autoFocus />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-[10px] font-medium text-gray-400 mb-1">岗位</span>
              <input className={inputCls} value={position} onChange={(e) => setPosition(e.target.value)} placeholder="如：前端开发" />
            </label>
            <label className="block">
              <span className="block text-[10px] font-medium text-gray-400 mb-1">状态</span>
              <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value as ApplyStatus)}>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{APPLY_STATUS_LABELS[s]}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="block">
            <span className="block text-[10px] font-medium text-gray-400 mb-1">招聘网址</span>
            <input className={inputCls} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…（点击记录时在浏览器打开）" />
          </label>
          <label className="block">
            <span className="block text-[10px] font-medium text-gray-400 mb-1">网站</span>
            <input className={inputCls} value={site} onChange={(e) => setSite(e.target.value)} placeholder="留空则从网址自动识别" />
          </label>
          <label className="block">
            <span className="block text-[10px] font-medium text-gray-400 mb-1">备注</span>
            <textarea className={`${inputCls} resize-y`} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="面试官信息、准备材料等" />
          </label>
        </div>

        <div className="flex gap-3 justify-end mt-5">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
          >
            取消
          </button>
          <button
            onClick={save}
            disabled={!company.trim()}
            className="px-4 py-2 text-xs font-semibold text-white bg-teal-600 rounded-lg hover:bg-teal-700 disabled:opacity-40 transition-colors"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

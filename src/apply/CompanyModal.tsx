// EasyWork - 公司库新增弹窗（名称 / 业务类型 / 招聘网站）
import { useState } from "react";
import { Building2, X, Loader } from "lucide-react";

interface Props {
  initial?: { name: string; industry: string; url: string } | null;
  onSave: (c: { name: string; industry: string; url: string }) => Promise<void>;
  onClose: () => void;
}

export default function CompanyModal({ initial, onSave, onClose }: Props) {
  const [name, setName] = useState(initial?.name ?? "");
  const [industry, setIndustry] = useState(initial?.industry ?? "");
  const [url, setUrl] = useState(initial?.url ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    const n = name.trim();
    if (!n || saving) return;
    setSaving(true);
    setError("");
    try {
      await onSave({ name: n, industry: industry.trim(), url: url.trim() });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setSaving(false);
  };

  const inputCls =
    "w-full px-3 py-2 text-xs text-gray-700 bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-300 placeholder-gray-300";

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in">
      <div className="bg-white rounded-2xl shadow-2xl p-6 mx-4 max-w-md w-full animate-in zoom-in">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-gray-900 flex items-center gap-2">
            <Building2 size={16} className="text-teal-600" />
            {initial ? "编辑公司" : "新增公司"}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-3">
          <label className="block">
            <span className="block text-[10px] font-medium text-gray-400 mb-1">公司名称 *</span>
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="如：字节跳动" autoFocus />
          </label>
          <label className="block">
            <span className="block text-[10px] font-medium text-gray-400 mb-1">业务类型</span>
            <input className={inputCls} value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="如：互联网 / 金融 / 汽车新能源…" />
          </label>
          <label className="block">
            <span className="block text-[10px] font-medium text-gray-400 mb-1">招聘网站</span>
            <input className={inputCls} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…（点击公司在浏览器打开）" />
          </label>
          {error && (
            <p className="text-[11px] text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>
          )}
          <p className="text-[10px] text-gray-400">保存时 AI 会校验信息准确性</p>
        </div>

        <div className="flex gap-3 justify-end mt-5">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 text-xs font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-50"
          >
            取消
          </button>
          <button
            onClick={save}
            disabled={!name.trim() || saving}
            className="px-4 py-2 text-xs font-semibold text-white bg-teal-600 rounded-lg hover:bg-teal-700 disabled:opacity-40 transition-colors flex items-center gap-1.5"
          >
            {saving && <Loader size={12} className="animate-spin" />}
            {saving ? "校验中..." : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}

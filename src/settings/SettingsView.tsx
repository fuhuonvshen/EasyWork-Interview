// EasyWork - 设置页：我的简历（全局资产）+ 投递页地址 + 模型下载入口
import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ArrowLeft, FileText, Upload, Trash2, Globe, Download, Check, Loader, Sparkles } from "lucide-react";
import type { Resume } from "../types";
import { showToast } from "../components/Toast";
import ModelDownloadDialog from "./ModelDownloadDialog";

export default function SettingsView({ onBack }: { onBack: () => void }) {
  const [resume, setResume] = useState<Resume | null>(null);
  const [loadingResume, setLoadingResume] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [applyUrl, setApplyUrl] = useState("");
  const [savingUrl, setSavingUrl] = useState(false);
  const [showModel, setShowModel] = useState(false);

  // 加载当前简历 + 投递页地址
  useEffect(() => {
    invoke<Resume | null>("get_resume")
      .then(setResume)
      .catch(() => {})
      .finally(() => setLoadingResume(false));
    invoke<Record<string, string>>("get_settings")
      .then((s) => { if (s["apply_url"]) setApplyUrl(s["apply_url"]); })
      .catch(() => {});
  }, []);

  const doSaveResume = async (fileName: string, content: string) => {
    if (!content.trim()) { showToast("简历内容为空", "error"); return; }
    setUploading(true);
    try {
      await invoke("save_resume", { fileName, content });
      setResume({ id: "", file_name: fileName, content, created_at: new Date().toISOString() });
      setPasteText("");
      setShowPaste(false);
      showToast("简历已保存，面试回答时会自动参考", "success");
    } catch {
      showToast("保存简历失败", "error");
    }
    setUploading(false);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => doSaveResume(file.name, String(reader.result || ""));
    reader.onerror = () => showToast("读取文件失败", "error");
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleSaveUrl = async () => {
    setSavingUrl(true);
    let url = applyUrl.trim();
    if (url && !/^https?:\/\//.test(url)) url = "https://" + url;
    try {
      await invoke("update_setting", { key: "apply_url", value: url });
      setApplyUrl(url);
      showToast("投递页地址已保存", "success");
    } catch {
      showToast("保存失败", "error");
    }
    setSavingUrl(false);
  };

  return (
    <div className="h-full flex flex-col bg-white rounded-lg overflow-hidden">
      <header className="px-6 py-4 border-b border-gray-100 flex items-center gap-3 flex-shrink-0">
        <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
          <ArrowLeft size={18} />
        </button>
        <h2 className="text-lg font-semibold text-gray-900">设置</h2>
      </header>

      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="max-w-xl mx-auto space-y-8">
          {/* ── 我的简历 ── */}
          <section>
            <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2 mb-1">
              <FileText size={16} className="text-amber-500" />
              我的简历
              <span className="text-[10px] font-medium text-gray-400">面试回答演练时 AI 会参考你的项目/实习经历</span>
            </h3>
            <p className="text-xs text-gray-400 mb-4">支持 .txt / .md 或直接粘贴文本 · PDF/DOCX 解析即将支持</p>

            {loadingResume ? (
              <div className="flex items-center gap-2 text-xs text-gray-400 py-4">
                <Loader size={14} className="animate-spin" /> 加载中...
              </div>
            ) : resume ? (
              <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-amber-100 bg-amber-50/50 mb-3">
                <div className="w-9 h-9 rounded-lg bg-amber-100 text-amber-600 flex items-center justify-center flex-shrink-0">
                  <FileText size={16} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{resume.file_name || "我的简历"}</p>
                  <p className="text-[11px] text-gray-400">
                    {resume.content.length} 字 · 更新于 {resume.created_at.slice(0, 10)}
                  </p>
                </div>
                <span className="text-[10px] font-semibold px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1">
                  <Check size={10} /> 已保存
                </span>
              </div>
            ) : (
              <div className="px-4 py-4 rounded-xl border border-dashed border-gray-200 text-center mb-3">
                <p className="text-xs text-gray-400">还没有上传简历</p>
              </div>
            )}

            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.md"
                onChange={handleFileChange}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="px-4 py-2 text-xs font-semibold text-white bg-gradient-to-r from-amber-500 to-orange-500 rounded-xl shadow-md shadow-amber-500/25 hover:opacity-90 disabled:opacity-50 transition-all flex items-center gap-1.5"
              >
                {uploading ? <Loader size={13} className="animate-spin" /> : <Upload size={13} />}
                {resume ? "更新简历" : "上传简历"}
              </button>
              <button
                onClick={() => setShowPaste((v) => !v)}
                className="px-4 py-2 text-xs font-medium text-gray-600 bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors"
              >
                粘贴文本
              </button>
              {resume && (
                <button
                  onClick={() => { setResume(null); showToast("请重新上传以替换简历", "info"); }}
                  className="p-2 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                  title="移除简历（重新上传即替换）"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>

            {showPaste && (
              <div className="mt-3">
                <textarea
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  placeholder="粘贴简历全文（教育背景、技能、项目经历、实习经历…）"
                  rows={6}
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-700 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-amber-300 resize-y"
                />
                <div className="flex justify-end mt-2">
                  <button
                    onClick={() => doSaveResume("粘贴的简历.txt", pasteText)}
                    disabled={uploading || !pasteText.trim()}
                    className="px-4 py-1.5 text-xs font-semibold text-white bg-amber-500 rounded-lg hover:bg-amber-600 disabled:opacity-40 transition-colors"
                  >
                    保存
                  </button>
                </div>
              </div>
            )}
          </section>

          {/* ── 投递页地址 ── */}
          <section>
            <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2 mb-1">
              <Globe size={16} className="text-blue-500" />
              前往投递 · 内嵌网页地址
            </h3>
            <p className="text-xs text-gray-400 mb-3">主控台「前往投递」卡片内嵌的网页 URL（你自己的投递页面）</p>
            <div className="flex items-center gap-2">
              <input
                type="url"
                value={applyUrl}
                onChange={(e) => setApplyUrl(e.target.value)}
                placeholder="https://你的投递页地址"
                className="flex-1 px-3 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-700 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
              <button
                onClick={handleSaveUrl}
                disabled={savingUrl}
                className="px-4 py-2.5 text-xs font-semibold text-white bg-blue-500 rounded-xl hover:bg-blue-600 disabled:opacity-50 transition-colors"
              >
                {savingUrl ? "保存中..." : "保存"}
              </button>
            </div>
          </section>

          {/* ── 模型下载 ── */}
          <section>
            <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2 mb-3">
              <Download size={16} className="text-emerald-500" />
              语音与本地模型
            </h3>
            <button
              onClick={() => setShowModel(true)}
              className="px-4 py-2 text-xs font-semibold text-emerald-700 bg-emerald-50 rounded-xl hover:bg-emerald-100 transition-colors flex items-center gap-1.5"
            >
              <Sparkles size={13} />
              管理模型下载
            </button>
          </section>
        </div>
      </div>

      {showModel && (
        <ModelDownloadDialog
          onDone={() => setShowModel(false)}
          onClose={() => setShowModel(false)}
        />
      )}
    </div>
  );
}

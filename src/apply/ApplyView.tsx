// EasyWork - 前往投递：内嵌外部投递网页（可配置 URL，settings.apply_url）
// 说明：你的个人投递页只要允许 iframe 嵌入（无 X-Frame-Options 限制），
// 就能直接内嵌在应用里；遇到登录态/第三方 cookie 问题时可点「在浏览器打开」。
import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ArrowLeft, RefreshCw, ExternalLink, Globe, Pencil, Check, X } from "lucide-react";

const DEFAULT_APPLY_URL = "https://example.com";

export default function ApplyView({ onBack }: { onBack: () => void }) {
  const [url, setUrl] = useState(DEFAULT_APPLY_URL);
  const [editingUrl, setEditingUrl] = useState(false);
  const [draftUrl, setDraftUrl] = useState(DEFAULT_APPLY_URL);
  const [frameKey, setFrameKey] = useState(0); // 强制 iframe 刷新
  const [loading, setLoading] = useState(true);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // 读取配置的投递页 URL
  useEffect(() => {
    invoke<Record<string, string>>("get_settings")
      .then((s) => {
        const stored = s["apply_url"];
        if (stored && /^https?:\/\//.test(stored)) {
          setUrl(stored);
          setDraftUrl(stored);
        }
      })
      .catch(() => {});
  }, []);

  const saveUrl = async () => {
    let next = draftUrl.trim();
    if (!/^https?:\/\//.test(next)) next = "https://" + next;
    setUrl(next);
    setDraftUrl(next);
    setEditingUrl(false);
    setFrameKey((k) => k + 1);
    try {
      await invoke("update_setting", { key: "apply_url", value: next });
    } catch {}
  };

  return (
    <div className="h-full flex flex-col bg-white rounded-lg overflow-hidden">
      {/* 工具栏 */}
      <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-3 flex-shrink-0">
        <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
          <ArrowLeft size={18} />
        </button>
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Globe size={16} className="text-gray-400 flex-shrink-0" />
          {editingUrl ? (
            <div className="flex items-center gap-1.5 flex-1 min-w-0">
              <input
                type="url"
                value={draftUrl}
                onChange={(e) => setDraftUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") saveUrl(); if (e.key === "Escape") setEditingUrl(false); }}
                autoFocus
                className="flex-1 min-w-0 px-3 py-1.5 rounded-lg border border-gray-200 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand-300"
                placeholder="https://你的投递页地址"
              />
              <button onClick={saveUrl} className="p-1.5 rounded-lg text-brand-600 hover:bg-brand-50"><Check size={14} /></button>
              <button onClick={() => setEditingUrl(false)} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100"><X size={14} /></button>
            </div>
          ) : (
            <>
              <span className="text-sm font-medium text-gray-700 truncate">{url.replace(/^https?:\/\//, "")}</span>
              <button onClick={() => { setDraftUrl(url); setEditingUrl(true); }} className="p-1 rounded-lg text-gray-300 hover:text-gray-500 hover:bg-gray-100" title="修改投递页地址">
                <Pencil size={13} />
              </button>
            </>
          )}
        </div>
        <button
          onClick={() => { setLoading(true); setFrameKey((k) => k + 1); }}
          className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors" title="刷新"
        >
          <RefreshCw size={15} />
        </button>
        <button
          onClick={() => invoke("open_external_url", { url }).catch(() => window.open(url, "_blank"))}
          className="px-3 py-1.5 text-xs font-medium text-brand-600 bg-brand-50 rounded-lg hover:bg-brand-100 transition-colors flex items-center gap-1"
          title="在系统浏览器中打开（登录态更完整）"
        >
          <ExternalLink size={13} />
          浏览器打开
        </button>
      </div>

      {/* 嵌入区 */}
      <div className="flex-1 min-h-0 bg-gray-50 relative">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <p className="text-sm text-gray-400">加载中…</p>
          </div>
        )}
        <iframe
          key={frameKey}
          ref={iframeRef}
          src={url}
          title="投递网页"
          className="w-full h-full border-0"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          onLoad={() => setLoading(false)}
        />
      </div>

      <p className="px-5 py-2 text-[11px] text-gray-400 border-t border-gray-50 flex-shrink-0">
        💡 提示：你的投递页若禁止 iframe 嵌入（X-Frame-Options），请用「浏览器打开」；登录状态在嵌入模式下可能不共享。
      </p>
    </div>
  );
}

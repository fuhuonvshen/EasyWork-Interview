// EasyWork - 前往投递：内嵌投递网页（地址内置，用户不可见、无感）
// 说明：投递页允许 iframe 嵌入（无 X-Frame-Options 限制），直接内嵌在应用里；
// 若遇到登录态/第三方 cookie 问题可点「在浏览器打开」。
// 简历同步：投递页内嵌 postMessage 脚本（见 docs/面试改造方案.md 第七节），
// 用户在投递页上传简历后自动推送 → 此处校验来源域名 → save_resume 存为全局简历。
import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ArrowLeft, RefreshCw, ExternalLink, Globe, FileText, AlertTriangle, Loader } from "lucide-react";
import { showToast } from "../components/Toast";

const APPLY_URL = "http://8.159.128.153:8000/";

export default function ApplyView({ onBack }: { onBack: () => void }) {
  const [url] = useState(APPLY_URL);
  const [frameKey, setFrameKey] = useState(0); // 强制 iframe 刷新
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [syncedResume, setSyncedResume] = useState<string | null>(null);
  const loadTimerRef = useRef<number | null>(null);

  // 接收投递页 postMessage 推送的简历（仅接受配置域名来源）
  useEffect(() => {
    const onMessage = async (e: MessageEvent) => {
      const data = e.data;
      if (!data || typeof data !== "object") return;
      if (data.source !== "easywork-apply" || data.type !== "resume") return;
      // 来源校验：只接受投递页自己的域名（防伪造）
      let allowed = "";
      try {
        allowed = new URL(APPLY_URL).origin;
      } catch {
        return;
      }
      if (e.origin !== allowed) {
        console.warn("[简历同步] 忽略未知来源:", e.origin);
        return;
      }
      const fileName = String(data.fileName || "投递页简历.txt");
      const content = String(data.content || "");
      if (!content.trim()) return;
      try {
        // 投递页同步的简历保持原文（投递表单自动填充需要完整信息）
        await invoke("save_resume", { fileName, content });
        setSyncedResume(fileName);
        showToast("已从投递页同步简历，投递表单可自动填充", "success");
      } catch {
        showToast("简历同步失败", "error");
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // 加载超时检测：8s 内 iframe 未触发 onLoad 视为加载失败（连接拒绝/服务器未启动）
  useEffect(() => {
    setLoading(true);
    setFailed(false);
    loadTimerRef.current = window.setTimeout(() => {
      setLoading(false);
      setFailed(true);
    }, 8000);
    return () => {
      if (loadTimerRef.current) window.clearTimeout(loadTimerRef.current);
    };
  }, [frameKey]);

  return (
    <div className="h-full flex flex-col bg-white rounded-lg overflow-hidden">
      {/* 工具栏 */}
      <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-3 flex-shrink-0">
        <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
          <ArrowLeft size={18} />
        </button>
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Globe size={16} className="text-gray-400 flex-shrink-0" />
          <span className="text-sm font-medium text-gray-700 truncate">我的投递工作台</span>
        </div>
        <button
          onClick={() => { setFrameKey((k) => k + 1); }}
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
        {loading && !failed && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <p className="text-sm text-gray-400 flex items-center gap-2">
              <Loader size={14} className="animate-spin" /> 加载中…
            </p>
          </div>
        )}
        {failed ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-8">
            <div className="w-14 h-14 rounded-2xl bg-red-50 flex items-center justify-center">
              <AlertTriangle size={26} className="text-red-400" />
            </div>
            <div className="text-center space-y-1">
              <p className="text-sm font-medium text-gray-700">投递页连接失败</p>
              <p className="text-xs text-gray-400">可能是网络问题或服务未启动，请稍后重试，或改用浏览器打开</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setFrameKey((k) => k + 1)}
                className="px-4 py-2 text-xs font-semibold text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors flex items-center gap-1.5"
              >
                <RefreshCw size={13} /> 重试
              </button>
              <button
                onClick={() => invoke("open_external_url", { url }).catch(() => window.open(url, "_blank"))}
                className="px-4 py-2 text-xs font-semibold text-white bg-brand-600 rounded-lg hover:bg-brand-700 transition-colors flex items-center gap-1.5"
              >
                <ExternalLink size={13} /> 浏览器打开
              </button>
            </div>
          </div>
        ) : (
          <iframe
            key={frameKey}
            src={url}
            title="投递网页"
            className="w-full h-full border-0"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            onLoad={() => {
              if (loadTimerRef.current) window.clearTimeout(loadTimerRef.current);
              setLoading(false);
              setFailed(false);
            }}
          />
        )}
      </div>

      <p className="px-5 py-2 text-[11px] text-gray-400 border-t border-gray-50 flex-shrink-0">
        {syncedResume ? (
          <span className="flex items-center gap-1.5 text-emerald-600">
            <FileText size={12} /> 已同步简历：{syncedResume}
          </span>
        ) : (
          <span>🔐 首次打开需在页面内登录，登录态保存在本机 · 投递页若禁止 iframe 嵌入请用「浏览器打开」 · 上传简历后会自动同步到面试助手</span>
        )}
      </p>
    </div>
  );
}

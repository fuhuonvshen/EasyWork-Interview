// EasyWork - Model Download Dialog (Speech + LLM)
import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { X, Loader, Mic, Brain, Bot, FolderOpen, AlertTriangle, Monitor, Settings, Cpu, Mail, Trash2 } from "lucide-react";
import type { ModelInfo, SpeechModelEntry, LlmModelEntry, EmailAccount, EmailScanSummary } from "../types";
import ModelCard from "./ModelCard";
import { useModelDownload, DownloadStatus } from "./useModelDownload";
import { showToast } from "../components/Toast";

function parseAccounts(raw: string | undefined): EmailAccount[] {
  try {
    const arr = JSON.parse(raw || "[]");
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

const KNOWN_IMAP: Record<string, string> = {
  "163.com": "imap.163.com",
  "126.com": "imap.126.com",
  "yeah.net": "imap.yeah.net",
  "qq.com": "imap.qq.com",
  "foxmail.com": "imap.qq.com",
  "gmail.com": "imap.gmail.com",
};

function guessImapHost(email: string): string {
  const domain = (email || "").trim().split("@")[1]?.toLowerCase() || "";
  return KNOWN_IMAP[domain] || (domain ? `imap.${domain}` : "");
}

// ── Confirm Delete Modal ──
function ConfirmDeleteModal({
  title, message, onConfirm, onCancel,
}: {
  title: string; message: string; onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-dialog-title"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm"
    >
      <div className="bg-white rounded-2xl shadow-xl p-6 mx-4 max-w-sm w-full text-center">
        <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
          <AlertTriangle size={24} className="text-red-500" />
        </div>
        <h3 id="delete-dialog-title" className="text-lg font-semibold text-gray-900 mb-1">{title}</h3>
        <p className="text-sm text-gray-500 mb-6">{message}</p>
        <div className="flex gap-3 justify-center">
          <button onClick={onCancel} className="px-5 py-2.5 text-sm font-medium text-gray-600 bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors">取消</button>
          <button onClick={onConfirm} className="px-5 py-2.5 text-sm font-medium text-white bg-red-500 rounded-xl hover:bg-red-600 transition-colors">确定删除</button>
        </div>
      </div>
    </div>
  );
}

// ── Main Dialog ──
export default function ModelDownloadDialog({
  onDone, onClose,
}: {
  onDone: () => void; onClose: () => void;
}) {
  const [tab, setTab] = useState<"general" | "speech" | "llm" | "email">("general");
  const [agentSettings, setAgentSettings] = useState<Record<string, string>>({});
  const [defaultRoot, setDefaultRoot] = useState("");
  const [autoStart, setAutoStart] = useState(false);

  // ── 邮箱账号（求职邮件监控）──
  const [emailAccounts, setEmailAccounts] = useState<EmailAccount[]>([]);
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [emailForm, setEmailForm] = useState({ email: "", auth_code: "", host: "" });
  const [emailTesting, setEmailTesting] = useState(false);
  const [emailTestMsg, setEmailTestMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [showAuthHelp, setShowAuthHelp] = useState(false);

  const setEmailFormField = (key: "email" | "auth_code" | "host", value: string) => {
    setEmailForm((prev) => {
      const next = { ...prev, [key]: value };
      if (key === "email" && !prev.host.trim()) next.host = guessImapHost(value);
      return next;
    });
  };

  const handleEmailTest = async () => {
    if (!emailForm.email.trim() || !emailForm.auth_code.trim()) {
      setEmailTestMsg({ ok: false, text: "请先填写邮箱和授权码" });
      return;
    }
    setEmailTesting(true);
    setEmailTestMsg(null);
    try {
      const res = await invoke<{ ok: boolean; error: string; host: string }>("email_test_account", {
        email: emailForm.email.trim(),
        authCode: emailForm.auth_code.trim(),
        host: emailForm.host.trim() || null,
      });
      setEmailTestMsg(res.ok ? { ok: true, text: `连接成功（${res.host}）` } : { ok: false, text: res.error || "连接失败" });
    } catch (e) {
      setEmailTestMsg({ ok: false, text: typeof e === "string" ? e : "连接失败" });
    }
    setEmailTesting(false);
  };

  const handleEmailAdd = () => {
    const email = emailForm.email.trim();
    const authCode = emailForm.auth_code.trim();
    if (!email || !authCode) { setEmailTestMsg({ ok: false, text: "请填写邮箱和授权码" }); return; }
    if (emailAccounts.some((a) => a.email.toLowerCase() === email.toLowerCase())) {
      setEmailTestMsg({ ok: false, text: "该邮箱已添加" });
      return;
    }
    setEmailAccounts((prev) => [...prev, {
      id: crypto.randomUUID(),
      email,
      auth_code: authCode,
      host: emailForm.host.trim(),
    }]);
    setEmailForm({ email: "", auth_code: "", host: "" });
    setEmailTestMsg(null);
    setShowEmailForm(false);
  };

  // ── Speech models (Whisper + SenseVoice) ──
  const kindMap = useRef<Record<string, "whisper" | "sensevoice">>({});
  // DB 中保存的后端值，用于保存时检测是否切换了本地/在线
  const originalBackend = useRef("local");

  const speech = useModelDownload<SpeechModelEntry>({
    fetch: async () => {
      const [w, sv] = await Promise.all([
        invoke<{ models: ModelInfo[]; modelsDir: string }>("whisper_list_models"),
        invoke<{ models: ModelInfo[]; modelsDir: string }>("sv_list_models"),
      ]);
      const merged: SpeechModelEntry[] = [
        ...w.models.map((m) => ({
          name: m.name,
          displayName: m.name.replace(".bin", ""),
          size_display: m.size_display,
          downloaded: m.downloaded,
          is_recommended: m.is_recommended,
          kind: "whisper" as const,
        })),
        ...sv.models.map((m) => ({
          name: m.name,
          displayName: "SenseVoice",
          size_display: m.size_display,
          downloaded: m.downloaded,
          is_recommended: m.is_recommended,
          kind: "sensevoice" as const,
        })),
      ];
      kindMap.current = {};
      merged.forEach((m) => { kindMap.current[m.name] = m.kind; });
      return merged;
    },
    download: async (name) => {
      if (kindMap.current[name] === "whisper") await invoke("whisper_download_model", { filename: name });
      else await invoke("sv_download_model", { filename: name });
    },
    cancel: async (name) => {
      if (kindMap.current[name] === "whisper") await invoke("whisper_cancel_download");
      else await invoke("sv_cancel_download");
    },
    remove: async (name) => {
      if (kindMap.current[name] === "whisper") await invoke("whisper_delete_model", { filename: name });
      else await invoke("sv_delete_model", { filename: name });
    },
    poll: () => invoke<{ status: string; progress: number; downloadedBytes: number; totalBytes: number; speed: number }>("whisper_download_status"),
    shouldPoll: (name) => kindMap.current[name] !== "sensevoice",
    onComplete: async (name) => {
      try { await invoke("whisper_load_model", { filename: name }); }
      catch (e) { console.error("模型加载失败:", e); }
    },
    initEvents: ["whisper", "sensevoice"],
  });

  // SenseVoice progress events (event-based, not polling)
  useEffect(() => {
    let unP: (() => void) | undefined;
    let unC: (() => void) | undefined;
    (async () => {
      unP = await listen<{ modelName: string; progress: number; downloadedBytes: number; totalSize: number; speed: number }>("sv-download-progress", (e) => {
        speech.setProgress(e.payload.progress);
        if (e.payload.downloadedBytes) speech.setDownloadedBytes(e.payload.downloadedBytes);
        if (e.payload.totalSize) speech.setTotalBytes(e.payload.totalSize);
        if (e.payload.speed) speech.setSpeed(e.payload.speed);
      });
      unC = await listen("sv-download-complete", () => {
        speech.resetDownload();
        speech.reload();
      });
    })();
    return () => { unP?.(); unC?.(); };
  }, []);

  // ── LLM models ──
  const llm = useModelDownload<LlmModelEntry>({
    fetch: async () => {
      const res = await invoke<{
        models: LlmModelEntry[];
        serverHealthy: boolean;
        currentModel: string | null;
        binaryReady: boolean;
      }>("llm_list_models");
      return res.models;
    },
    download: async (name) => { await invoke("llm_download_model", { name }); },
    cancel: async () => { await invoke("llm_cancel_download"); },
    remove: async (name) => { await invoke("llm_delete_model", { name }); },
    poll: () => invoke<{ status: string; progress: number; downloadedBytes: number; totalBytes: number; speed: number }>("llm_download_status"),
    initEvents: ["llm"],
  });

  // ── llama-server 推理引擎二进制 ──
  const [binaryReady, setBinaryReady] = useState(false);
  const [binaryDownloading, setBinaryDownloading] = useState(false);
  const [binaryStatus, setBinaryStatus] = useState<DownloadStatus | null>(null);
  const [binaryError, setBinaryError] = useState("");

  const refreshBinary = useCallback(() => {
    invoke<{ binaryReady: boolean }>("llm_server_status")
      .then((s) => setBinaryReady(s.binaryReady))
      .catch(() => {});
  }, []);

  useEffect(() => { refreshBinary(); }, [refreshBinary]);

  const startBinaryDownload = async () => {
    setBinaryError("");
    setBinaryDownloading(true);
    setBinaryStatus(null);
    try {
      await invoke("llm_download_binary");
    } catch (e) {
      setBinaryError(typeof e === "string" ? e : "下载 llama-server 失败");
    }
    setBinaryDownloading(false);
    refreshBinary();
  };

  // 二进制下载进度轮询
  useEffect(() => {
    if (!binaryDownloading) return;
    const poll = async () => {
      try {
        const s = await invoke<DownloadStatus>("llm_download_status");
        setBinaryStatus(s);
        if (s.status === "complete" || s.status.startsWith("error:")) {
          setBinaryDownloading(false);
          refreshBinary();
        }
      } catch {}
    };
    poll();
    const t = setInterval(poll, 500);
    return () => clearInterval(t);
  }, [binaryDownloading, refreshBinary]);

  // ── Settings ──
  useEffect(() => {
    invoke<Record<string, string>>("get_settings")
      .then((s) => {
        originalBackend.current = s["agent_llm_backend"] || "local";
        setAgentSettings(s);
        setEmailAccounts(parseAccounts(s["email_accounts"]));
      })
      .catch((e) => console.warn("加载设置失败", e));
    invoke<{ root: string }>("get_default_paths").then((d) => setDefaultRoot(d.root)).catch(() => {});
    invoke<boolean>("plugin:autostart|is_enabled").then(setAutoStart).catch(() => {});
  }, []);

  const updateAgentSetting = (key: string, value: string) => {
    setAgentSettings((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    for (const [key, value] of Object.entries(agentSettings)) {
      try { await invoke("update_setting", { key, value }); }
      catch (e) { console.error("保存设置失败", key, e); }
    }
    const newBackend = agentSettings["agent_llm_backend"] || "local";
    if (newBackend !== originalBackend.current) {
      showToast("LLM 后端已切换，重启应用后生效", "info");
    }
    try {
      if (autoStart) await invoke("plugin:autostart|enable");
      else await invoke("plugin:autostart|disable");
    } catch (e) { console.error("自动启动设置失败", e); }

    // 邮箱账号：持久化后立即扫描一轮（模型未就绪时提示，稍后自动补扫）
    await invoke("update_setting", { key: "email_accounts", value: JSON.stringify(emailAccounts) })
      .catch((e) => console.error("保存邮箱配置失败", e));
    if (emailAccounts.length > 0) {
      try {
        const s = await invoke<EmailScanSummary>("email_scan_now");
        if (s.errors.length > 0) {
          showToast(s.errors[0].message, "info");
        } else if (s.job_mails > 0) {
          showToast(`识别到 ${s.job_mails} 封求职邮件，待办页可确认添加`, "info");
        } else if (s.scanned > 0) {
          showToast(`扫描完成，处理 ${s.scanned} 封邮件，未发现新的求职邮件`, "success");
        } else {
          showToast("扫描完成，暂无新邮件", "success");
        }
      } catch (e) {
        console.error("邮箱扫描失败", e);
      }
    }
    onDone();
  };

  const tabs = [
    { key: "general" as const, label: "通用设置", icon: Settings },
    { key: "speech" as const, label: "会议纪要", icon: Mic },
    { key: "llm" as const, label: "面试助手", icon: Bot },
    { key: "email" as const, label: "求职邮箱", icon: Mail },
  ];

  // ── LLM model list (used in both speech and llm tabs) ──
  function LlmModelList() {
    if (llm.loading) return null;
    return (
      <div className="space-y-2">
        {/* 推理引擎 (llama-server) — macOS 内置即就绪，Windows 需手动下载 */}
        <div className="flex items-center justify-between p-3 rounded-xl border border-gray-100 bg-gray-50">
          <div className="flex items-center gap-2 min-w-0">
            <Cpu size={14} className="text-gray-500 flex-shrink-0" />
            <span className="text-xs font-medium text-gray-700">推理引擎 (llama-server)</span>
            {binaryReady ? (
              <span className="text-[10px] text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded flex-shrink-0">已就绪</span>
            ) : (
              <span className="text-[10px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded flex-shrink-0">未安装</span>
            )}
          </div>
          {!binaryReady && (
            <button
              onClick={startBinaryDownload}
              disabled={binaryDownloading}
              className="flex-shrink-0 px-3 py-1 text-xs font-medium text-white bg-violet-500 rounded-lg hover:bg-violet-600 disabled:opacity-50 transition-colors"
            >
              {binaryDownloading ? "下载中..." : "下载"}
            </button>
          )}
        </div>
        {binaryDownloading && (
          <div className="px-1">
            <div className="w-full h-1.5 bg-gray-200 rounded-full overflow-hidden">
              <div
                className={`h-full ${binaryStatus && binaryStatus.totalBytes > 0 ? "bg-violet-500 rounded-full transition-all duration-300" : "w-1/2 bg-violet-500 rounded-full animate-pulse"}`}
                style={binaryStatus && binaryStatus.totalBytes > 0 ? { width: `${binaryStatus.progress}%` } : undefined}
              />
            </div>
            <p className="text-[10px] text-gray-400 mt-1">
              {binaryStatus && binaryStatus.totalBytes > 0
                ? `${binaryStatus.progress}% · ${(binaryStatus.speed / 1024 / 1024).toFixed(1)} MB/s`
                : "正在下载（约 20-240 MB，视 CPU / CUDA 版而定）..."}
            </p>
          </div>
        )}
        {binaryError && (
          <div className="p-2 rounded-lg bg-red-50 border border-red-100 text-[11px] text-red-600">{binaryError}</div>
        )}
        {llm.models.map((m) => (
          <ModelCard
            key={m.name}
            displayName={m.display_name}
            sizeDisplay={m.size_display}
            downloaded={m.downloaded}
            isRecommended={m.is_recommended}
            badges={m.is_loaded ? [{ label: "运行中", className: "bg-blue-100 text-blue-700" }] : undefined}
            readyLabel="就绪"
            isDownloading={llm.downloading === m.name}
            downloadProgress={llm.progress}
            downloadedBytes={llm.downloadedBytes}
            totalBytes={llm.totalBytes}
            speed={llm.speed}
            disabled={llm.downloading !== null}
            color="violet"
            onDownload={() => llm.startDownload(m.name)}
            onCancel={llm.cancelDownload}
            onDelete={() => llm.setDeleteTarget(m)}
          />
        ))}
        {llm.error && (
          <div className="p-3 rounded-lg bg-amber-50 border border-amber-100 text-xs text-amber-700">{llm.error}</div>
        )}
      </div>
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="model-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
    >
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[85vh] mx-4 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-4 pb-0 flex-shrink-0">
          <h2 id="model-dialog-title" className="text-lg font-semibold text-gray-900">模型管理</h2>
          <button onClick={onClose} aria-label="关闭" className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 px-6 pt-3 pb-2 border-b border-gray-100 flex-shrink-0">
          {tabs.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg transition-colors ${
                tab === key ? "bg-accent-50 text-accent-700" : "text-gray-400 hover:text-gray-600 hover:bg-gray-50"
              }`}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
          {/* ── Tab: 通用设置 ── */}
          {tab === "general" && (
            <div className="space-y-4">
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Monitor size={15} className="text-gray-500" />
                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">系统设置</span>
                </div>
                <div className="p-3 rounded-xl border border-gray-100 bg-white space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-gray-700">开机自启动</span>
                    <button
                      role="switch"
                      aria-checked={autoStart}
                      onClick={() => setAutoStart(!autoStart)}
                      className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ${autoStart ? "bg-accent-500" : "bg-gray-200"}`}
                    >
                      <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${autoStart ? "translate-x-4" : ""}`} />
                    </button>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-gray-700">默认启动页</span>
                    <select
                      value={agentSettings["agent_startup_page"] || "workbench"}
                      onChange={(e) => updateAgentSetting("agent_startup_page", e.target.value)}
                      className="px-2 py-1 text-xs text-gray-600 bg-white border border-gray-200 rounded-lg"
                    >
                      <option value="workbench">工作台</option>
                      <option value="minutes">会议纪要</option>
                      <option value="agent">面试助手</option>
                    </select>
                  </div>
                </div>
              </div>

              <div>
                <div className="flex items-center gap-2 mb-3">
                  <FolderOpen size={15} className="text-gray-500" />
                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">存储路径</span>
                </div>
                <div className="p-3 rounded-xl border border-gray-100 bg-white space-y-3">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-medium text-gray-700">数据根目录</span>
                      <span className="text-[10px] text-gray-400">(修改后需重启)</span>
                    </div>
                    <p className="text-[10px] text-gray-400 mb-2">
                      设置后自动创建子目录：models/、sensevoice_models/、llm_models/、recordings/、bin/
                    </p>
                    <div className="flex gap-2">
                      <input type="text" readOnly
                        value={agentSettings["data_root_dir"] || ""}
                        placeholder={defaultRoot || "默认位置"}
                        className="flex-1 px-3 py-2 text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg truncate"
                      />
                      <button onClick={async () => {
                        const path = await invoke<string | null>("select_folder", { defaultPath: agentSettings["data_root_dir"] || null }).catch(() => null);
                        if (path) updateAgentSetting("data_root_dir", path);
                      }} className="px-3 py-2 text-xs font-medium text-accent-600 bg-accent-50 border border-accent-200 rounded-lg hover:bg-accent-100 transition-colors">
                        浏览
                      </button>
                      {agentSettings["data_root_dir"] && (
                        <button onClick={() => updateAgentSetting("data_root_dir", "")}
                          className="px-3 py-2 text-xs font-medium text-gray-500 bg-gray-100 border border-gray-200 rounded-lg hover:bg-gray-200 transition-colors">
                          重置
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>

            </div>
          )}

          {/* ── Tab: 会议纪要 ── */}
          {tab === "speech" && (
            <>
              {/* 语音识别（本地模型） */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Mic size={15} className="text-accent-500" />
                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">语音识别</span>
                </div>
                <div className="p-3 rounded-xl border border-gray-100 bg-white space-y-3">
                  {speech.loading && (
                    <div className="flex items-center gap-3 text-sm text-gray-400 py-4 justify-center">
                      <Loader size={16} className="animate-spin" />
                      加载模型列表...
                    </div>
                  )}
                  {speech.error && (
                    <div className="p-3 rounded-lg bg-red-50 border border-red-100 text-sm text-red-700">{speech.error}</div>
                  )}
                  {!speech.loading && speech.models.map((m) => (
                    <ModelCard
                      key={m.kind + ":" + m.name}
                      displayName={m.displayName}
                      sizeDisplay={m.size_display}
                      downloaded={m.downloaded}
                      isRecommended={m.is_recommended}
                      isDownloading={speech.downloading === m.name}
                      downloadProgress={speech.progress}
                      downloadedBytes={speech.downloadedBytes}
                      totalBytes={speech.totalBytes}
                      speed={speech.speed}
                      disabled={speech.downloading !== null}
                      onDownload={() => speech.startDownload(m.name)}
                      onCancel={speech.cancelDownload}
                      onDelete={() => speech.setDeleteTarget(m)}
                    />
                  ))}
                </div>
              </div>

              {/* 纪要生成说明（语言模型与 AI 对话共用，在「面试助手」页签配置） */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Brain size={15} className="text-violet-500" />
                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">纪要生成</span>
                </div>
                <div className="p-3 rounded-xl border border-gray-100 bg-white">
                  <p className="text-[11px] text-gray-500 leading-relaxed">
                    纪要生成、周报与 AI 对话共用同一个语言模型（要么都本地，要么都在线），请到「面试助手」页签统一配置。
                  </p>
                </div>
              </div>
            </>
          )}

          {/* ── Tab: 面试助手 ── */}
          {tab === "llm" && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Brain size={15} className="text-violet-500" />
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">语言模型</span>
              </div>
              <p className="text-[10px] text-gray-400 mb-2">
                AI 对话、纪要生成与周报共用此模型。本地小模型可能无法稳定调用工具，推荐使用在线模型
              </p>
              <div className="p-3 rounded-xl border border-gray-100 bg-white space-y-3">
                <div>
                  <label className="text-xs font-medium text-gray-700">LLM 后端</label>
                  <select
                    value={agentSettings["agent_llm_backend"] || "local"}
                    onChange={(e) => updateAgentSetting("agent_llm_backend", e.target.value)}
                    className="mt-1 w-full px-3 py-2 text-xs text-gray-600 bg-white border border-gray-200 rounded-lg"
                  >
                    <option value="local">本地模型 (llama.cpp)</option>
                    <option value="online">在线模型 (OpenAI 兼容)</option>
                  </select>
                </div>

                {agentSettings["agent_llm_backend"] !== "online" && (
                  <div className="border-t border-gray-50 pt-3">
                    <LlmModelList />
                  </div>
                )}

                {agentSettings["agent_llm_backend"] === "online" && (
                  <>
                    <div>
                      <label className="text-xs font-medium text-gray-700">API Key</label>
                      <input type="password"
                        value={agentSettings["agent_online_key"] || ""}
                        onChange={(e) => updateAgentSetting("agent_online_key", e.target.value)}
                        placeholder="sk-..." className="mt-1 w-full px-3 py-2 text-xs text-gray-600 bg-white border border-gray-200 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-700">模型名称</label>
                      <input type="text"
                        value={agentSettings["agent_online_model"] || ""}
                        onChange={(e) => updateAgentSetting("agent_online_model", e.target.value)}
                        placeholder="例如 qwen-plus / gpt-4o / deepseek-chat" className="mt-1 w-full px-3 py-2 text-xs text-gray-600 bg-white border border-gray-200 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-700">API 地址</label>
                      <input type="text"
                        value={agentSettings["agent_online_url"] || ""}
                        onChange={(e) => updateAgentSetting("agent_online_url", e.target.value)}
                        placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1" className="mt-1 w-full px-3 py-2 text-xs text-gray-600 bg-white border border-gray-200 rounded-lg"
                      />
                    </div>
                    <p className="text-[10px] text-gray-400 -mt-1">
                      支持任意 OpenAI 兼容接口（DeepSeek / 阿里云百炼 / OpenAI 等），地址可含或省略末尾 /v1。保存后重启 EasyWork 生效
                    </p>
                    <div className="flex items-center justify-between border-t border-gray-50 pt-3">
                      <div>
                        <span className="text-xs font-medium text-gray-700">推理思考</span>
                        <p className="text-[10px] text-gray-400 mt-0.5">
                          关闭后在线模型不再生成思考过程（更省 token、回答更快不截断）；复杂推理问题建议保持开启。需模型支持（DeepSeek V3.1+ / Qwen3），保存后重启生效
                        </p>
                      </div>
                      <button
                        onClick={() => updateAgentSetting("agent_llm_thinking", (agentSettings["agent_llm_thinking"] ?? "1") === "1" ? "0" : "1")}
                        className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ${(agentSettings["agent_llm_thinking"] ?? "1") === "1" ? "bg-violet-500" : "bg-gray-300"}`}
                      >
                        <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${(agentSettings["agent_llm_thinking"] ?? "1") === "1" ? "translate-x-4" : ""}`} />
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* ── Tab: 求职邮箱 ── */}
          {tab === "email" && (
            <div className="space-y-4">
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Mail size={15} className="text-sky-500" />
                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">求职邮箱</span>
                </div>
                <p className="text-[11px] text-gray-500 leading-relaxed mb-3">
                  定期检查 163 等邮箱，AI 自动识别求职相关邮件（笔试/面试邀请等），并提取核心事项与截止日期，放入「面试助手 → 待办」等待你确认。
                  识别在本地进行，邮件原文不会保存。
                </p>

                {/* 已配置账号 */}
                <div className="space-y-2">
                  {emailAccounts.map((acc) => (
                    <div key={acc.id} className="flex items-center gap-3 p-3 rounded-xl border border-gray-100 bg-white">
                      <div className="w-8 h-8 rounded-lg bg-sky-50 text-sky-500 flex items-center justify-center flex-shrink-0">
                        <Mail size={14} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-gray-800 truncate">{acc.email}</p>
                        <p className="text-[10px] text-gray-400 truncate">
                          {acc.host || guessImapHost(acc.email)} · 授权码 ••••{acc.auth_code.slice(-4)}
                        </p>
                      </div>
                      <button
                        onClick={() => setEmailAccounts((prev) => prev.filter((a) => a.id !== acc.id))}
                        className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors flex-shrink-0"
                        title="移除账号"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                  {emailAccounts.length === 0 && !showEmailForm && (
                    <div className="p-3 rounded-xl border border-dashed border-gray-200 text-center text-[11px] text-gray-400">
                      还没有配置邮箱
                    </div>
                  )}
                </div>

                {/* 添加账号表单 */}
                {!showEmailForm && (
                  <button
                    onClick={() => { setShowEmailForm(true); setEmailTestMsg(null); }}
                    className="mt-2 px-4 py-2 text-xs font-semibold text-sky-600 bg-sky-50 border border-sky-200 rounded-lg hover:bg-sky-100 transition-colors"
                  >
                    + 添加邮箱账号
                  </button>
                )}
                {showEmailForm && (
                  <div className="mt-2 p-3 rounded-xl border border-gray-100 bg-white space-y-2.5">
                    <div>
                      <label className="text-xs font-medium text-gray-700">邮箱地址</label>
                      <input type="text"
                        value={emailForm.email}
                        onChange={(e) => setEmailFormField("email", e.target.value)}
                        placeholder="xxx@163.com"
                        className="mt-1 w-full px-3 py-2 text-xs text-gray-600 bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-200"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-700">IMAP 授权码</label>
                      <input type="password"
                        value={emailForm.auth_code}
                        onChange={(e) => setEmailFormField("auth_code", e.target.value)}
                        placeholder="在网页邮箱设置里生成的授权码"
                        className="mt-1 w-full px-3 py-2 text-xs text-gray-600 bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-200"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-700">
                        IMAP 服务器 <span className="text-gray-400 font-normal">（留空自动识别）</span>
                      </label>
                      <input type="text"
                        value={emailForm.host}
                        onChange={(e) => setEmailFormField("host", e.target.value)}
                        placeholder={guessImapHost(emailForm.email) || "imap.163.com"}
                        className="mt-1 w-full px-3 py-2 text-xs text-gray-600 bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-200"
                      />
                    </div>
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        onClick={handleEmailTest}
                        disabled={emailTesting}
                        className="px-3 py-2 text-xs font-medium text-sky-600 bg-sky-50 border border-sky-200 rounded-lg hover:bg-sky-100 disabled:opacity-50 transition-colors"
                      >
                        {emailTesting ? <Loader size={12} className="inline animate-spin mr-1" /> : null}
                        测试连接
                      </button>
                      <button
                        onClick={handleEmailAdd}
                        className="px-4 py-2 text-xs font-semibold text-white bg-sky-600 rounded-lg hover:bg-sky-700 transition-colors"
                      >
                        添加
                      </button>
                      <button
                        onClick={() => setShowEmailForm(false)}
                        className="px-3 py-2 text-xs text-gray-400 hover:text-gray-600 transition-colors"
                      >
                        取消
                      </button>
                    </div>
                    {emailTestMsg && (
                      <p className={`text-[11px] ${emailTestMsg.ok ? "text-emerald-600" : "text-red-500"}`}>{emailTestMsg.text}</p>
                    )}
                    <button
                      onClick={() => setShowAuthHelp(!showAuthHelp)}
                      className="text-[11px] text-sky-600 hover:text-sky-700"
                    >
                      {showAuthHelp ? "收起" : "163 邮箱如何获取授权码？"}
                    </button>
                    {showAuthHelp && (
                      <p className="text-[11px] text-gray-400 leading-relaxed">
                        电脑浏览器登录 mail.163.com → 设置 → POP3/IMAP/SMTP/Exchange/CardDAV/CalDAV → 开启 IMAP/SMTP 服务 →
                        按提示「新增授权密码」，生成的一串密码即为授权码（不是登录密码）。
                      </p>
                    )}
                  </div>
                )}

                <p className="text-[10px] text-gray-400 mt-3 leading-relaxed">
                  已配置的账号每 5 分钟自动检查一次新邮件；识别出的求职邮件会出现在「面试助手 → 待办」页，确认后才会加入待办。
                  保存设置后会立即扫描一轮。
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-3 border-t border-gray-100 flex-shrink-0">
          <button onClick={onClose} className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors">取消</button>
          <button onClick={handleSave} className="px-4 py-1.5 text-xs font-medium text-white bg-accent-600 rounded-lg hover:bg-accent-700 transition-colors">保存</button>
        </div>

        {/* Delete confirm modals */}
        {speech.deleteTarget && (
          <ConfirmDeleteModal
            title="删除模型"
            message={`确定要删除 "${speech.deleteTarget.displayName}" 吗？删除后需重新下载。`}
            onConfirm={speech.confirmDelete}
            onCancel={() => speech.setDeleteTarget(null)}
          />
        )}
        {llm.deleteTarget && (
          <ConfirmDeleteModal
            title="删除模型"
            message={`确定要删除 "${llm.deleteTarget.display_name}" 吗？删除后需重新下载。`}
            onConfirm={llm.confirmDelete}
            onCancel={() => llm.setDeleteTarget(null)}
          />
        )}
      </div>
    </div>
  );
}

// EasyWork - 前端主界面
// 两层导航：Workbench（Agent 入口） ↔ MinutesApp（会议纪要内页）

import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import Workbench from "./workbench/Workbench";
import FeedbackView from "./workbench/FeedbackView";
import MinutesApp from "./minutes";
import AgentApp from "./agent/AgentApp";
import ReminderModal from "./ReminderModal";
import TitleBar from "./components/TitleBar";
import { ToastContainer, showToast } from "./components/Toast";
import UpdateDialog from "./components/UpdateDialog";
import type { MinutesTab } from "./types";

const MINUTES_TABS: MinutesTab[] = ["today", "history", "schedule", "reports"];
const isMinutesTab = (v: string): v is MinutesTab => MINUTES_TABS.includes(v as MinutesTab);

export default function App() {
  const [view, setView] = useState<"workbench" | "minutes" | "agent" | "feedback">("workbench");
  const [prefillTitle, setPrefillTitle] = useState("");
  const [initialTab, setInitialTab] = useState<MinutesTab>("today");

  // Load startup page setting
  useEffect(() => {
    (async () => {
      try {
        const settings = await invoke<Record<string, string>>("get_settings");
        const startupPage = settings["agent_startup_page"];
        if (startupPage === "minutes") setView("minutes");
        else if (startupPage === "agent") setView("agent");
      } catch {}
    })();
  }, []);

  // Track agent sidecar initialization status (shown in agent UI)
  const [agentInitStatus, setAgentInitStatus] = useState<{ status: string; message: string } | null>(null);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      unlisten = await listen<{ module: string; status: string; message: string }>("init-status", (e) => {
        if (e.payload.module === "agent") {
          setAgentInitStatus({ status: e.payload.status, message: e.payload.message });
        }
      });
    })();
    return () => { unlisten?.(); };
  }, []);

  // Check for updates on startup
  const [updateInfo, setUpdateInfo] = useState<{
    version: string;
    body: string;
    downloadUrl?: string;
    downloadAndInstall: () => Promise<void>;
  } | null>(null);
  const [updateProgress, setUpdateProgress] = useState(0);

  useEffect(() => {
    (async () => {
      try {
        const isWindows = navigator.userAgent.includes("Windows");
        if (isWindows) {
          // Windows：自研更新流程（插件 downloadAndInstall 同步等待 msiexec，
          // 应用活着时 sidecar 锁文件 → 安装必失败），见 update.rs
          const info = await invoke<{ version: string; notes: string; url: string } | null>("update_check");
          if (info) {
            setUpdateInfo({
              version: info.version,
              body: info.notes,
              downloadUrl: info.url,
              downloadAndInstall: async () => {},
            });
          }
        } else {
          const { check } = await import("@tauri-apps/plugin-updater");
          const update = await check();
          if (update?.available) {
            setUpdateInfo({
              version: update.version,
              body: update.body || "",
              downloadAndInstall: () => update.downloadAndInstall(),
            });
          }
        }
      } catch {}
    })();
  }, []);

  // Download progress events (Windows self-implemented flow)
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      unlisten = await listen<number>("update-progress", (e) => {
        setUpdateProgress(e.payload);
      });
    })();
    return () => { unlisten?.(); };
  }, []);

  const handleUpdateInstall = async () => {
    if (!updateInfo) return;
    setUpdateProgress(1);
    try {
      if (updateInfo.downloadUrl) {
        // Windows：下载 → Rust 清理 sidecar → 异步启动 msiexec → 退出应用
        const installerPath = await invoke<string>("update_download", { url: updateInfo.downloadUrl });
        setUpdateProgress(100);
        await invoke("install_update", { installerPath });
      } else {
        await updateInfo.downloadAndInstall();
        setUpdateProgress(100);
        // 不要 relaunch：新进程会锁住安装文件导致 MSI 安装失败（Error 1310）。
        // exit_for_update 会先清理 easywork-agent/llama-server 子进程再正常退出，
        // 让 msiexec 完成安装；安装完成后请手动重新打开应用。
        await invoke("exit_for_update");
      }
    } catch (e) {
      setUpdateProgress(0);
      console.error("更新失败", e);
    }
  };

  // Schedule reminder — poll every 2s
  const [reminder, setReminder] = useState<{ id: string; title: string; startTime: string; zoomUrl: string } | null>(null);
  const [currentScheduleId, setCurrentScheduleId] = useState<string | null>(null);

  // Tray menu navigation
  useEffect(() => {
    const unlisten = listen<{ view: string; tab?: string }>("tray-navigate", (e) => {
      const { view, tab } = e.payload;
      if (view === "workbench") {
        setView("workbench");
      } else if (view === "minutes") {
        if (tab && isMinutesTab(tab)) setInitialTab(tab);
        setView("minutes");
      } else if (view === "agent") {
        setView("agent");
      }
    });
    return () => { unlisten.then((f) => f()); };
  }, []);

  // 生产环境禁用浏览器右键菜单
  useEffect(() => {
    if (!import.meta.env.PROD) return;
    const handler = (e: MouseEvent) => e.preventDefault();
    document.addEventListener("contextmenu", handler);
    return () => document.removeEventListener("contextmenu", handler);
  }, []);

  const navigateToRecording = useCallback((title: string, scheduleId?: string) => {
    setPrefillTitle(title);
    setCurrentScheduleId(scheduleId || null);
    setInitialTab("today");
    setView("minutes");
  }, []);

  useEffect(() => {
    const poll = async () => {
      try {
        const r = await invoke<{ id: string; title: string; startTime: string; zoomUrl: string } | null>("get_pending_reminder");
        if (r) setReminder(r);
      } catch (e) {
        console.error("轮询提醒失败", e);
      }
    };

    // Pause polling when the document is hidden (window minimized to tray)
    const onVisibilityChange = () => {
      if (document.hidden) {
        clearInterval(intervalId);
      } else {
        poll();
        intervalId = setInterval(poll, 5000);
      }
    };

    poll();
    let intervalId = setInterval(poll, 2000);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  return (
    <div className="h-screen relative overflow-hidden">
      {/* 底层：浅灰蓝渐变 + 微光光斑（底图） */}
      <div className="app-bg absolute inset-0" />
      {/* 遮罩层：半透明白 + 背景模糊（玻璃质感） */}
      <div className="absolute inset-0 bg-white/40 backdrop-blur-md" />
      {/* 内容层 */}
      <div className="relative h-full flex flex-col">
      <TitleBar />
      <div className={`flex-1 min-h-0 ${view === "workbench" ? "" : "p-2.5 pt-0"}`}>
      {view === "workbench" && (
        <Workbench
          onEnter={(title?: string, action?: string) => {
            if (action === "agent") {
              setView("agent");
            } else if (action === "feedback") {
              setView("feedback");
            } else {
              setPrefillTitle(title || "");
              setCurrentScheduleId(null);
              setInitialTab(action && isMinutesTab(action) ? action : "today");
              setView("minutes");
            }
          }}
        />
      )}
      {view === "minutes" && (
        <MinutesApp
          prefillTitle={prefillTitle}
          scheduleId={currentScheduleId}
          initialTab={initialTab}
          onBack={() => setView("workbench")}
          onNavigateRecording={navigateToRecording}
        />
      )}
      {view === "agent" && (
        <AgentApp onBack={() => setView("workbench")} initStatus={agentInitStatus} />
      )}
      {view === "feedback" && (
        <FeedbackView onBack={() => setView("workbench")} />
      )}
      </div>
      </div>

      {reminder && (
        <ReminderModal
          reminder={reminder}
          onGo={(r) => {
            setReminder(null);
            navigateToRecording(r.title, r.id);
          }}
          onClose={() => { setReminder(null); invoke("dismiss_reminder"); }}
        />
      )}
      {updateInfo && (
        <UpdateDialog
          version={updateInfo.version}
          body={updateInfo.body}
          progress={updateProgress}
          onInstall={handleUpdateInstall}
          onDismiss={() => { setUpdateInfo(null); setUpdateProgress(0); }}
        />
      )}
      <ToastContainer />
    </div>
  );
}

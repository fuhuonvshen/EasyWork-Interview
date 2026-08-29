// EasyWork - 会议模型检查弹窗
// 进入会议模块时检查 VAD + 声纹模型是否就绪，未就绪则显示下载进度
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface ModelStatus {
  vadReady: boolean;
  diarizationReady: boolean;
  vadProgress: number;
  diarizationProgress: number;
}

export default function MeetingModelCheck({ children }: { children: React.ReactNode }) {
  const [initialized, setInitialized] = useState(false);
  const [status, setStatus] = useState<ModelStatus>({
    vadReady: false,
    diarizationReady: false,
    vadProgress: 0,
    diarizationProgress: 0,
  });

  const check = async () => {
    try {
      const res = await invoke<{ vadReady: boolean; diarizationReady: boolean; bothReady: boolean }>(
        "check_meeting_models"
      );
      setStatus((s) => ({ ...s, vadReady: res.vadReady, diarizationReady: res.diarizationReady }));
      setInitialized(true);
    } catch {
      setInitialized(true);
    }
  };

  useEffect(() => {
    check();

    const unlistenVad = listen<{ progress: number }>("vad-download-progress", (e) => {
      setStatus((s) => ({
        ...s,
        vadProgress: e.payload.progress,
        vadReady: e.payload.progress >= 100,
      }));
    });
    const unlistenDiar = listen<{ progress: number }>("diarization-download-progress", (e) => {
      setStatus((s) => ({
        ...s,
        diarizationProgress: e.payload.progress,
        diarizationReady: e.payload.progress >= 100,
      }));
    });
    const interval = setInterval(check, 2000);

    return () => {
      unlistenVad.then((fn) => fn());
      unlistenDiar.then((fn) => fn());
      clearInterval(interval);
    };
  }, []);

  // All models ready → render children immediately (no flash)
  if (initialized && status.vadReady && status.diarizationReady) return <>{children}</>;
  // Before first check completes → show nothing (avoid flash)
  if (!initialized) return <>{children}</>;

  const bothDone = status.vadReady && status.diarizationReady;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-100">
            <svg className="h-5 w-5 text-brand-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
          </div>
          <div>
            <h2 className="text-base font-semibold text-gray-900">准备录制环境</h2>
            <p className="text-xs text-gray-500 pointer-events-none">正在下载所需模型文件</p>
          </div>
        </div>

        {/* VAD progress */}
        <div className="mb-5">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-sm text-gray-700">语音活动检测模型</span>
            <span className="text-xs text-gray-400">
              {status.vadReady ? "✓ 已完成" : `${status.vadProgress}%`}
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
            <div
              className="h-full rounded-full bg-brand-500 transition-all duration-500 ease-out"
              style={{ width: status.vadReady ? "100%" : `${Math.max(status.vadProgress, 3)}%` }}
            />
          </div>
        </div>

        {/* Diarization progress */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-sm text-gray-700">声纹识别模型</span>
            <span className="text-xs text-gray-400">
              {status.diarizationReady ? "✓ 已完成" : `${status.diarizationProgress}%`}
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
            <div
              className="h-full rounded-full bg-brand-500 transition-all duration-500 ease-out"
              style={{ width: status.diarizationReady ? "100%" : `${Math.max(status.diarizationProgress, 3)}%` }}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end">
          {bothDone ? (
            <div className="flex items-center gap-2 text-sm text-emerald-600 font-medium">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              准备就绪
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-brand-400 border-t-transparent" />
              下载中…
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

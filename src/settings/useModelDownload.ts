// EasyWork - Generic model download state management hook
// Handles: model list loading, download progress polling, init-event auto-reload, deletion
import { useState, useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { ERRORS, toUserError } from "../errors";

export type DownloadStatus = {
  status: string;
  progress: number;
  downloadedBytes: number;
  totalBytes: number;
  speed: number;
};

export interface UseModelDownloadConfig<T> {
  fetch: () => Promise<T[]>;
  download: (name: string) => Promise<void>;
  cancel: (name: string) => Promise<void>;
  remove: (name: string) => Promise<void>;
  poll: () => Promise<DownloadStatus>;
  /** Called with the current downloading model name; return false to skip polling */
  shouldPoll?: (name: string) => boolean;
  /** Called after a download completes (before reloading the list) */
  onComplete?: (name: string) => Promise<void>;
  /** Module names that trigger an auto-reload via init-status events */
  initEvents?: string[];
}

export function useModelDownload<T extends { name: string }>(
  config: UseModelDownloadConfig<T>,
) {
  const [models, setModels] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [downloadedBytes, setDownloadedBytes] = useState(0);
  const [totalBytes, setTotalBytes] = useState(0);
  const [speed, setSpeed] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<T | null>(null);
  const loadIdRef = useRef(0);
  const configRef = useRef(config);
  configRef.current = config;

  const load = async () => {
    const id = ++loadIdRef.current;
    setLoading(true);
    try {
      const result = await configRef.current.fetch();
      if (id !== loadIdRef.current) return;
      setModels(result);
      setError("");
    } catch (e) {
      if (id !== loadIdRef.current) return;
      setError(toUserError(ERRORS.LOAD_MODEL, e));
    }
    if (id === loadIdRef.current) setLoading(false);
  };

  useEffect(() => { load(); }, []);

  // Auto-reload on init-status events
  useEffect(() => {
    const events = configRef.current.initEvents;
    if (!events?.length) return;
    let unlistenFn: (() => void) | undefined;
    (async () => {
      unlistenFn = await listen<{ module: string; status: string }>("init-status", (e) => {
        if ((events.includes(e.payload.module) || e.payload.module === "all") && e.payload.status === "ok") {
          load();
        }
      });
    })();
    return () => { unlistenFn?.(); };
  }, []);

  // Progress polling
  useEffect(() => {
    if (!downloading) return;
    if (configRef.current.shouldPoll && !configRef.current.shouldPoll(downloading)) return;

    const modelName = downloading;
    const poll = async () => {
      try {
        const state = await configRef.current.poll();
        if (state.status === "downloading") {
          setProgress(state.progress);
          setDownloadedBytes(state.downloadedBytes);
          setTotalBytes(state.totalBytes);
          setSpeed(state.speed);
        } else if (state.status === "complete") {
          setDownloading(null);
          setProgress(0);
          load();
          await configRef.current.onComplete?.(modelName);
        } else if (state.status === "cancelled") {
          setDownloading(null);
          setProgress(0);
          load();
        } else if (state.status.startsWith("error:")) {
          const ERROR_PREFIX_LEN = "error:".length;
          setError(state.status.slice(ERROR_PREFIX_LEN));
          setDownloading(null);
          setProgress(0);
          load();
        }
      } catch (e) {
        console.warn("轮询下载状态失败:", e);
      }
    };
    poll();
    const interval = setInterval(poll, 500);
    return () => clearInterval(interval);
  }, [downloading]);

  const startDownload = async (name: string) => {
    setError("");
    setDownloading(name);
    setProgress(0);
    setDownloadedBytes(0);
    setTotalBytes(0);
    setSpeed(0);
    try {
      await configRef.current.download(name);
    } catch (e) {
      setDownloading(null);
      setError(toUserError(ERRORS.DOWNLOAD_MODEL, e));
    }
  };

  const cancelDownload = async () => {
    const name = downloading;
    if (!name) return;
    try {
      await configRef.current.cancel(name);
    } catch (e) {
      setError(toUserError(ERRORS.DOWNLOAD_MODEL, e));
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const name = deleteTarget.name;
    try {
      await configRef.current.remove(name);
      setDeleteTarget(null);
      load();
    } catch (e) {
      setError(toUserError(ERRORS.DOWNLOAD_MODEL, e));
    }
  };

  const resetDownload = () => {
    setDownloading(null);
    setProgress(0);
    setDownloadedBytes(0);
    setTotalBytes(0);
    setSpeed(0);
  };

  return {
    models, loading, error,
    downloading, progress, downloadedBytes, totalBytes, speed,
    setProgress, setDownloadedBytes, setTotalBytes, setSpeed,
    deleteTarget, setDeleteTarget,
    reload: load,
    startDownload, cancelDownload, confirmDelete, resetDownload,
  };
}

// EasyWork - Recording session state, lifted to app level so it survives page switches.
// The actual capture/transcription lives in Rust; this provider keeps the UI-side
// session (config snapshot, live subtitles, timer anchor, generation result).
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ERRORS, toCommandError, toUserError } from "../../errors";
import { showToast } from "../../components/Toast";
import type { InterviewQuestion } from "../../types";

export type RecordingPhase = "idle" | "recording" | "generating";

export interface LiveChunk {
  speaker: string;
  text: string;
}

export interface RecordingConfig {
  /** 生成纪要使用的标题（也是 start_capture 的 label） */
  title: string;
  /** 录音视图显示的名称（会议名称输入框） */
  label: string;
  scheduleId: string | null;
  meetingType: string;
  isInterview: boolean;
  /** 实时辅助答题：仅在线模型 + 面试录音时开启 */
  assistEnabled: boolean;
  company: string | null;
  position: string | null;
  stage: string | null;
}

export interface RecordingResult {
  meetingId: string;
  content: string;
  questions?: InterviewQuestion[];
}

interface RecordingSessionValue {
  phase: RecordingPhase;
  /** 录音开始时间戳；generating（导入）时为 null */
  startedAt: number | null;
  liveTranscripts: LiveChunk[];
  config: RecordingConfig | null;
  error: string | null;
  clearError: () => void;
  startRecording: (deviceName: string, config: RecordingConfig) => Promise<boolean>;
  stopAndGenerate: () => Promise<void>;
  generateFromImport: (path: string, config: RecordingConfig) => Promise<void>;
  pendingResult: RecordingResult | null;
  takePendingResult: () => RecordingResult | null;
}

const RecordingSessionContext = createContext<RecordingSessionValue | null>(null);

export function RecordingSessionProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<RecordingPhase>("idle");
  const phaseRef = useRef<RecordingPhase>("idle");
  const setPhaseSafe = useCallback((p: RecordingPhase) => {
    phaseRef.current = p;
    setPhase(p);
  }, []);

  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [liveTranscripts, setLiveTranscripts] = useState<LiveChunk[]>([]);
  // 轮询/停止是异步的，用 ref 保证读到最新字幕，避免 stale closure
  const transcriptsRef = useRef<LiveChunk[]>([]);
  const [config, setConfig] = useState<RecordingConfig | null>(null);
  const configRef = useRef<RecordingConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingResult, setPendingResult] = useState<RecordingResult | null>(null);
  const pendingResultRef = useRef<RecordingResult | null>(null);
  // start/stop 是异步的，phase 更新前有窗口：连点会重复发起请求
  const opInFlightRef = useRef(false);

  const clearError = useCallback(() => setError(null), []);

  // 录音期间由 Provider 统一轮询（drain 语义），切页不丢字幕。
  // 注意：仅当有新块时才 setState，避免每秒无意义重渲染。
  useEffect(() => {
    if (phase !== "recording") return;
    let cancelled = false;
    const poll = async () => {
      try {
        const chunks = await invoke<LiveChunk[]>("get_transcript_chunks");
        if (cancelled || !Array.isArray(chunks) || chunks.length === 0) return;
        transcriptsRef.current = [...transcriptsRef.current, ...chunks];
        setLiveTranscripts(transcriptsRef.current);
      } catch {}
    };
    poll();
    const interval = setInterval(poll, 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [phase]);

  const runGeneration = useCallback(async (args: {
    wavPath: string;
    liveText: string | null;
    liveTranscriptJson: string | null;
    config: RecordingConfig;
  }) => {
    const cfg = args.config;
    setPhaseSafe("generating");
    try {
      const raw = await invoke<string>("generate_minutes", {
        wavPath: args.wavPath,
        meetingTitle: cfg.title,
        liveText: args.liveText,
        liveTranscriptJson: args.liveTranscriptJson,
        scheduleId: cfg.scheduleId,
        meetingType: cfg.meetingType,
        isInterview: cfg.isInterview,
        company: cfg.isInterview ? cfg.company : null,
        position: cfg.isInterview ? cfg.position : null,
        stage: cfg.isInterview ? cfg.stage : null,
      });
      let result: RecordingResult;
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed?.meetingId === "string" && typeof parsed?.content === "string") {
          result = parsed;
        } else {
          throw new Error(ERRORS.PARSE_MINUTES);
        }
      } catch {
        throw new Error(ERRORS.PARSE_MINUTES);
      }
      pendingResultRef.current = result;
      setPendingResult(result);
      if ("Notification" in window && Notification.permission === "granted") {
        new Notification("EasyWork", {
          body: cfg.isInterview ? "面试复盘已生成" : "会议纪要已生成",
        });
      }
    } catch (e) {
      const msg = toCommandError(ERRORS.GENERATE_MINUTES, e);
      setError(msg);
      // 用户可能已切到其他页面，全局提示保证失败可见
      showToast(msg, "error");
    } finally {
      transcriptsRef.current = [];
      setLiveTranscripts([]);
      configRef.current = null;
      setConfig(null);
      setStartedAt(null);
      setPhaseSafe("idle");
    }
  }, [setPhaseSafe]);

  const startRecording = useCallback(async (deviceName: string, cfg: RecordingConfig) => {
    if (phaseRef.current !== "idle" || opInFlightRef.current) return false;
    opInFlightRef.current = true;
    setError(null);
    try {
      await invoke("start_capture", { deviceName, label: cfg.title });
      // 后端 start_capture 不清 chunk buffer：先排空上一场残留
      try {
        await invoke<LiveChunk[]>("get_transcript_chunks");
      } catch {}
      transcriptsRef.current = [];
      setLiveTranscripts([]);
      configRef.current = cfg;
      setConfig(cfg);
      setStartedAt(Date.now());
      setPhaseSafe("recording");

      if ("Notification" in window && Notification.permission === "default") {
        Notification.requestPermission();
      }
      if ("Notification" in window && Notification.permission === "granted") {
        new Notification("EasyWork", { body: "录制已开始" });
      }
      return true;
    } catch (e) {
      setError(toUserError(ERRORS.START_RECORDING, e));
      return false;
    } finally {
      opInFlightRef.current = false;
    }
  }, [setPhaseSafe]);

  const stopAndGenerate = useCallback(async () => {
    if (phaseRef.current !== "recording" || opInFlightRef.current) return;
    const cfg = configRef.current;
    if (!cfg) return;
    opInFlightRef.current = true;
    const live = transcriptsRef.current;
    const liveText = live.map((item) => `[${item.speaker}] ${item.text}`).join("\n");
    try {
      const path = await invoke<string>("stop_capture");
      setPhaseSafe("generating");
      // 收尾：把停止前最后一批 chunk 并入字幕
      try {
        const tail = await invoke<LiveChunk[]>("get_transcript_chunks");
        if (Array.isArray(tail) && tail.length > 0) {
          transcriptsRef.current = [...transcriptsRef.current, ...tail];
          setLiveTranscripts(transcriptsRef.current);
        }
      } catch {}
      await runGeneration({
        wavPath: path,
        liveText: liveText || null,
        liveTranscriptJson: live.length > 0 ? JSON.stringify(live) : null,
        config: cfg,
      });
    } catch (e) {
      const msg = toCommandError(ERRORS.STOP_RECORDING, e);
      setError(msg);
      showToast(msg, "error");
      transcriptsRef.current = [];
      setLiveTranscripts([]);
      configRef.current = null;
      setConfig(null);
      setStartedAt(null);
      setPhaseSafe("idle");
    } finally {
      opInFlightRef.current = false;
    }
  }, [runGeneration, setPhaseSafe]);

  const generateFromImport = useCallback(async (path: string, cfg: RecordingConfig) => {
    if (phaseRef.current !== "idle" || opInFlightRef.current) return;
    opInFlightRef.current = true;
    setError(null);
    configRef.current = cfg;
    setConfig(cfg);
    try {
      await runGeneration({
        wavPath: path,
        liveText: null,
        liveTranscriptJson: null,
        config: cfg,
      });
    } finally {
      opInFlightRef.current = false;
    }
  }, [runGeneration]);

  const takePendingResult = useCallback(() => {
    const result = pendingResultRef.current;
    if (!result) return null;
    pendingResultRef.current = null;
    setPendingResult(null);
    return result;
  }, []);

  return (
    <RecordingSessionContext.Provider
      value={{
        phase,
        startedAt,
        liveTranscripts,
        config,
        error,
        clearError,
        startRecording,
        stopAndGenerate,
        generateFromImport,
        pendingResult,
        takePendingResult,
      }}
    >
      {children}
    </RecordingSessionContext.Provider>
  );
}

export function useRecordingSession(): RecordingSessionValue {
  const value = useContext(RecordingSessionContext);
  if (!value) throw new Error("useRecordingSession 必须在 RecordingSessionProvider 内使用");
  return value;
}

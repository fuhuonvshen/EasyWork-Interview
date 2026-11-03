// EasyWork - 面试实时辅助答题的会话状态。
// 挂在 App 层跟随录音会话：切页不丢；录音开始时快照简历，每段系统音频
// （面试官）触发请求，间隙内的麦克风转写作为候选人实际回答进入 history。
// 新段取消上一条回答流。不进数据库、不进面试记录。
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type Event, type UnlistenFn } from "@tauri-apps/api/event";
import { useRecordingSession } from "./RecordingSession";
import { buildHistory, type AssistChunk } from "./assistHistory";
import { showToast } from "../../components/Toast";
import { ERRORS } from "../../errors";
import type { InterviewAssistStreamEvent, Resume, TranscriptChunkEvent } from "../../types";

export type AssistTurnStatus = "streaming" | "done" | "interrupted" | "error";

export interface AssistTurn {
  id: string;
  question: string;
  answer: string;
  status: AssistTurnStatus;
  error?: string;
}

interface InterviewAssistValue {
  active: boolean;
  visible: boolean;
  toggleVisible: () => void;
  /** 右侧栏宽度百分比（拖动分隔条调整，跨页面保留） */
  panePercent: number;
  setPanePercent: (value: number) => void;
  turns: AssistTurn[];
}

const InterviewAssistContext = createContext<InterviewAssistValue | null>(null);

const ASSIST_ERROR = ERRORS.INTERVIEW_ASSIST;

let requestSeq = 0;
function createRequestId(): string {
  requestSeq += 1;
  return `${Date.now()}-${requestSeq}-${Math.random().toString(36).slice(2, 8)}`;
}

function hasContent(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text);
}

export function InterviewAssistProvider({ children }: { children: ReactNode }) {
  const { phase, startedAt, config } = useRecordingSession();
  const [turns, setTurns] = useState<AssistTurn[]>([]);
  const [visible, setVisible] = useState(true);
  const [panePercent, setPanePercentState] = useState(40);

  const turnsRef = useRef<AssistTurn[]>([]);
  const activeRef = useRef(false);
  const configRef = useRef(config);
  const activeRequestIdRef = useRef<string | null>(null);
  const sessionKeyRef = useRef<number | null>(null);
  const toastShownRef = useRef(false);
  const chunksRef = useRef<AssistChunk[]>([]);
  const chunkSeqRef = useRef(0);
  const resumePromiseRef = useRef<Promise<string | null> | null>(null);

  const updateTurns = useCallback(
    (next: AssistTurn[] | ((prev: AssistTurn[]) => AssistTurn[])) => {
      const computed = typeof next === "function" ? next(turnsRef.current) : next;
      turnsRef.current = computed;
      setTurns(computed);
    },
    []
  );

  // 一场录音只读一次简历：系统提示词整场使用同一份快照
  const ensureResumeFields = useCallback(async (): Promise<string | null> => {
    if (resumePromiseRef.current) return resumePromiseRef.current;
    const promise = invoke<Resume | null>("get_resume")
      .then((resume) => (resume?.fields?.trim() ? resume.fields : null))
      .catch((e) => {
        console.warn("[interview-assist] load resume failed", e);
        return null;
      });
    resumePromiseRef.current = promise;
    return promise;
  }, []);

  useEffect(() => {
    configRef.current = config;
  }, [config]);

  const active = phase === "recording" && !!config?.isInterview && !!config?.assistEnabled;

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  // 离开录音/关闭辅助：取消在途请求；离开录音时清空本场问答
  useEffect(() => {
    if (active) return;
    const requestId = activeRequestIdRef.current;
    if (requestId) {
      activeRequestIdRef.current = null;
      invoke("interview_assist_cancel", { requestId }).catch(() => {});
    }
    if (phase !== "recording") {
      toastShownRef.current = false;
      chunksRef.current = [];
      chunkSeqRef.current = 0;
      resumePromiseRef.current = null;
      updateTurns([]);
    }
  }, [active, phase, updateTurns]);

  // 新一场录音：清空对话缓冲，并在开始时快照当前简历
  useEffect(() => {
    if (phase !== "recording" || !startedAt || sessionKeyRef.current === startedAt) return;
    sessionKeyRef.current = startedAt;
    activeRequestIdRef.current = null;
    toastShownRef.current = false;
    chunksRef.current = [];
    chunkSeqRef.current = 0;
    resumePromiseRef.current = null;
    updateTurns([]);
    setVisible(true);
    void ensureResumeFields();
  }, [phase, startedAt, ensureResumeFields, updateTurns]);

  useEffect(() => {
    let disposed = false;
    let unlistenChunk: UnlistenFn | null = null;
    let unlistenStream: UnlistenFn | null = null;

    const onChunk = (event: Event<TranscriptChunkEvent>) => {
      if (!activeRef.current) return;
      const chunk = event.payload;
      const text = (chunk?.text ?? "").trim();
      if (!chunk || !text || !hasContent(text)) return;

      const previous = chunksRef.current[chunksRef.current.length - 1];
      const start =
        typeof chunk.start === "number" && Number.isFinite(chunk.start)
          ? chunk.start
          : previous
            ? previous.start + 0.001
            : 0;
      const seq = chunkSeqRef.current++;

      // 麦克风（候选人实际回答）只入对话缓冲，不触发新请求
      if (chunk.speaker === "我") {
        chunksRef.current.push({ seq, role: "assistant", text, start });
        return;
      }

      const cfg = configRef.current;
      if (!cfg) return;

      const previousId = activeRequestIdRef.current;
      if (previousId) {
        updateTurns((prev) =>
          prev.map((turn) =>
            turn.id === previousId && turn.status === "streaming"
              ? { ...turn, status: "interrupted" }
              : turn
          )
        );
      }

      // 以系统音频（面试官）为边界：只取当前问题开始之前的转写作为历史
      const history = buildHistory(chunksRef.current, start);
      chunksRef.current.push({ seq, role: "user", text, start });

      const requestId = createRequestId();
      activeRequestIdRef.current = requestId;
      updateTurns((prev) => [
        ...prev,
        { id: requestId, question: text, answer: "", status: "streaming" },
      ]);

      void (async () => {
        const resumeFields = await ensureResumeFields();
        if (!activeRef.current || activeRequestIdRef.current !== requestId) return;
        try {
          await invoke("interview_assist_start", {
            requestId,
            question: text,
            history,
            resumeFields,
            company: cfg.company ?? null,
            position: cfg.position ?? null,
          });
        } catch (e) {
          console.warn("[interview-assist] start failed", e);
          if (activeRequestIdRef.current !== requestId) return;
          activeRequestIdRef.current = null;
          updateTurns((prev) =>
            prev.map((turn) =>
              turn.id === requestId ? { ...turn, status: "error", error: ASSIST_ERROR } : turn
            )
          );
          if (!toastShownRef.current) {
            toastShownRef.current = true;
            showToast(ASSIST_ERROR, "error");
          }
        }
      })();
    };

    const onStream = (event: Event<InterviewAssistStreamEvent>) => {
      const payload = event.payload;
      if (!payload || payload.request_id !== activeRequestIdRef.current) return;

      if (payload.type === "delta") {
        if (!payload.text) return;
        updateTurns((prev) =>
          prev.map((turn) =>
            turn.id === payload.request_id ? { ...turn, answer: turn.answer + payload.text } : turn
          )
        );
        return;
      }

      if (payload.type === "done") {
        activeRequestIdRef.current = null;
        updateTurns((prev) =>
          prev.map((turn) =>
            turn.id === payload.request_id && turn.status === "streaming"
              ? { ...turn, status: "done" }
              : turn
          )
        );
        return;
      }

      if (payload.type === "error") {
        activeRequestIdRef.current = null;
        console.warn("[interview-assist] stream error", payload.message);
        updateTurns((prev) =>
          prev.map((turn) =>
            turn.id === payload.request_id
              ? { ...turn, status: "error", error: ASSIST_ERROR }
              : turn
          )
        );
        if (!toastShownRef.current) {
          toastShownRef.current = true;
          showToast(ASSIST_ERROR, "error");
        }
      }
    };

    Promise.all([
      listen<TranscriptChunkEvent>("transcript-chunk", onChunk),
      listen<InterviewAssistStreamEvent>("interview-assist-stream", onStream),
    ])
      .then(([u1, u2]) => {
        if (disposed) {
          u1();
          u2();
        } else {
          unlistenChunk = u1;
          unlistenStream = u2;
        }
      })
      .catch((e) => console.warn("[interview-assist] listen failed", e));

    return () => {
      disposed = true;
      unlistenChunk?.();
      unlistenStream?.();
    };
  }, [ensureResumeFields, updateTurns]);

  const toggleVisible = useCallback(() => setVisible((v) => !v), []);
  const setPanePercent = useCallback((value: number) => {
    setPanePercentState(Math.min(80, Math.max(20, Math.round(value * 10) / 10)));
  }, []);

  return (
    <InterviewAssistContext.Provider
      value={{ active, visible, toggleVisible, panePercent, setPanePercent, turns }}
    >
      {children}
    </InterviewAssistContext.Provider>
  );
}

export function useInterviewAssist(): InterviewAssistValue {
  const value = useContext(InterviewAssistContext);
  if (!value) throw new Error("useInterviewAssist 必须在 InterviewAssistProvider 内使用");
  return value;
}

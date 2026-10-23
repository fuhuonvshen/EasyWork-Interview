// EasyWork - 面试实时辅助答题的会话状态。
// 挂在 App 层跟随录音会话：切页不丢；每段系统音频转写立即请求在线模型，
// 新段取消上一条回答流。不进数据库、不进面试记录。
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type Event, type UnlistenFn } from "@tauri-apps/api/event";
import { useRecordingSession } from "./RecordingSession";
import { showToast } from "../../components/Toast";
import { ERRORS } from "../../errors";
import type { InterviewAssistStreamEvent, TranscriptChunkEvent } from "../../types";

export type AssistTurnStatus = "streaming" | "done" | "interrupted" | "error";

export interface AssistTurn {
  id: string;
  question: string;
  answer: string;
  status: AssistTurnStatus;
  error?: string;
}

interface AssistHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

interface InterviewAssistValue {
  active: boolean;
  visible: boolean;
  toggleVisible: () => void;
  turns: AssistTurn[];
}

const InterviewAssistContext = createContext<InterviewAssistValue | null>(null);

const HISTORY_TURNS = 8;
const ASSIST_ERROR = ERRORS.INTERVIEW_ASSIST;

let requestSeq = 0;
function createRequestId(): string {
  requestSeq += 1;
  return `${Date.now()}-${requestSeq}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildHistory(turns: AssistTurn[]): AssistHistoryMessage[] {
  const messages: AssistHistoryMessage[] = [];
  for (const turn of turns) {
    const question = turn.question.trim();
    const answer = turn.answer.trim();
    // 没有回答的中断轮不进入上下文，避免出现连续 user 消息
    if (!question || !answer) continue;
    messages.push({ role: "user", content: question });
    messages.push({ role: "assistant", content: answer });
  }
  return messages.slice(-HISTORY_TURNS * 2);
}

function hasContent(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text);
}

export function InterviewAssistProvider({ children }: { children: ReactNode }) {
  const { phase, startedAt, config } = useRecordingSession();
  const [turns, setTurns] = useState<AssistTurn[]>([]);
  const [visible, setVisible] = useState(true);

  const turnsRef = useRef<AssistTurn[]>([]);
  const activeRef = useRef(false);
  const configRef = useRef(config);
  const activeRequestIdRef = useRef<string | null>(null);
  const sessionKeyRef = useRef<number | null>(null);
  const toastShownRef = useRef(false);

  const updateTurns = useCallback(
    (next: AssistTurn[] | ((prev: AssistTurn[]) => AssistTurn[])) => {
      const computed = typeof next === "function" ? next(turnsRef.current) : next;
      turnsRef.current = computed;
      setTurns(computed);
    },
    []
  );

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
      updateTurns([]);
    }
  }, [active, phase, updateTurns]);

  // 新一场录音：重置问答与面板显示
  useEffect(() => {
    if (phase !== "recording" || !startedAt || sessionKeyRef.current === startedAt) return;
    sessionKeyRef.current = startedAt;
    activeRequestIdRef.current = null;
    toastShownRef.current = false;
    updateTurns([]);
    setVisible(true);
  }, [phase, startedAt, updateTurns]);

  useEffect(() => {
    let disposed = false;
    let unlistenChunk: UnlistenFn | null = null;
    let unlistenStream: UnlistenFn | null = null;

    const onChunk = (event: Event<TranscriptChunkEvent>) => {
      if (!activeRef.current) return;
      const chunk = event.payload;
      const text = (chunk?.text ?? "").trim();
      if (!chunk || chunk.speaker === "我" || !text || !hasContent(text)) return;
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

      const history = buildHistory(turnsRef.current);
      const requestId = createRequestId();
      activeRequestIdRef.current = requestId;
      updateTurns((prev) => [
        ...prev,
        { id: requestId, question: text, answer: "", status: "streaming" },
      ]);

      invoke("interview_assist_start", {
        requestId,
        question: text,
        history,
        company: cfg.company ?? null,
        position: cfg.position ?? null,
      }).catch((e) => {
        console.warn("[interview-assist] start failed", e);
        if (activeRequestIdRef.current === requestId) activeRequestIdRef.current = null;
        updateTurns((prev) =>
          prev.map((turn) =>
            turn.id === requestId ? { ...turn, status: "error", error: ASSIST_ERROR } : turn
          )
        );
        if (!toastShownRef.current) {
          toastShownRef.current = true;
          showToast(ASSIST_ERROR, "error");
        }
      });
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
  }, [updateTurns]);

  const toggleVisible = useCallback(() => setVisible((v) => !v), []);

  return (
    <InterviewAssistContext.Provider value={{ active, visible, toggleVisible, turns }}>
      {children}
    </InterviewAssistContext.Provider>
  );
}

export function useInterviewAssist(): InterviewAssistValue {
  const value = useContext(InterviewAssistContext);
  if (!value) throw new Error("useInterviewAssist 必须在 InterviewAssistProvider 内使用");
  return value;
}

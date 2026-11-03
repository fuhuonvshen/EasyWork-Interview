// 实时辅助答题的对话历史构建：以系统音频（面试官）为边界，
// 间隙内的麦克风转写作为候选人实际回答。
export interface AssistHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AssistChunk {
  seq: number;
  role: "user" | "assistant";
  text: string;
  start: number;
}

export const HISTORY_TURNS = 8;

export function buildHistory(
  chunks: AssistChunk[],
  beforeStart: number
): AssistHistoryMessage[] {
  const prior = chunks
    .filter((chunk) => chunk.start < beforeStart)
    .sort((a, b) => a.start - b.start || a.seq - b.seq);

  const messages: AssistHistoryMessage[] = [];
  for (const chunk of prior) {
    const last = messages[messages.length - 1];
    if (last && last.role === chunk.role) {
      last.content += `\n${chunk.text}`;
    } else {
      messages.push({ role: chunk.role, content: chunk.text });
    }
  }
  // 没有前置问题的候选人独白不进入上下文
  while (messages.length && messages[0].role === "assistant") messages.shift();
  return messages.slice(-HISTORY_TURNS * 2);
}

// EasyWork - 录音页右侧的实时辅助答题栏（只读）。
import { useEffect, useRef } from "react";
import { Loader, MessageSquare, Sparkles } from "lucide-react";
import Markdown from "../../components/Markdown";
import type { AssistTurn } from "./InterviewAssist";

export default function AssistPane({ turns }: { turns: AssistTurn[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const prevCountRef = useRef(0);

  useEffect(() => {
    // 新问题一定滚到底；流式更新只在用户停留底部附近时跟随
    if (turns.length > prevCountRef.current) stickToBottomRef.current = true;
    prevCountRef.current = turns.length;
    if (!stickToBottomRef.current) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  return (
    <aside className="flex-1 min-w-0 flex flex-col min-h-0 bg-gray-50/70">
      <div className="px-5 py-3.5 border-b border-gray-200/70 bg-white flex items-center gap-2 flex-shrink-0">
        <Sparkles size={16} className="text-brand-500" />
        <span className="text-base font-semibold text-gray-900">实时辅助答题</span>
      </div>

      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-5 py-5 space-y-6">
        {turns.length === 0 ? (
          <div className="min-h-full flex flex-col items-center justify-center text-center px-8">
            <div className="w-11 h-11 rounded-full bg-white border border-gray-100 flex items-center justify-center mb-4">
              <MessageSquare size={20} className="text-gray-300" />
            </div>
            <p className="text-sm text-gray-400">等待面试官提问…</p>
          </div>
        ) : (
          turns.map((turn) => (
            <div key={turn.id} className="space-y-2.5">
              <div className="flex items-start gap-2.5">
                <span className="mt-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded bg-gray-200/80 text-gray-600 flex-shrink-0">
                  面试官
                </span>
                <p className="selectable text-sm text-gray-700 leading-relaxed whitespace-pre-wrap break-words">
                  {turn.question}
                </p>
              </div>

              <div className="rounded-xl border border-gray-200/70 bg-white px-4 py-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
                {turn.answer ? (
                  <Markdown content={turn.answer} />
                ) : turn.status === "error" ? (
                  <p className="text-sm text-red-600">{turn.error || "实时辅助暂不可用"}</p>
                ) : (
                  <div className="flex items-center gap-2 text-sm text-gray-400">
                    <Loader size={14} className="animate-spin" />
                    正在生成回答…
                  </div>
                )}
                {turn.status === "streaming" && turn.answer && (
                  <span className="inline-block w-1.5 h-4 ml-0.5 align-middle bg-brand-400 animate-pulse rounded-sm" />
                )}
                {turn.status === "interrupted" && (
                  <p className="mt-2 text-[11px] text-gray-300">已中断</p>
                )}
                {turn.status === "error" && turn.answer && (
                  <p className="mt-2 text-[11px] text-red-400">{turn.error || "实时辅助暂不可用"}</p>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}

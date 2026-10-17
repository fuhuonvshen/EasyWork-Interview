// EasyWork - Floating recording indicator: visible on every page while a
// recording/generation session is active. Draggable; click returns to the
// recording page. Rendered at app root so it survives view switches.
import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { Loader, Mic } from "lucide-react";
import { useRecordingSession } from "./RecordingSession";

const SIZE = 56;

function formatElapsed(total: number): string {
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export default function FloatingRecorder({ onOpen }: { onOpen: () => void }) {
  const { phase, startedAt } = useRecordingSession();
  const [elapsed, setElapsed] = useState(0);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null);
  const movedRef = useRef(false);
  const suppressClickRef = useRef(false);

  useEffect(() => {
    if (phase !== "recording" || !startedAt) {
      setElapsed(0);
      return;
    }
    const tick = () => setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [phase, startedAt]);

  const clamp = (x: number, y: number) => ({
    x: Math.max(8, Math.min(window.innerWidth - SIZE - 8, x)),
    y: Math.max(40, Math.min(window.innerHeight - SIZE - 8, y)),
  });

  const handlePointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = e.currentTarget.getBoundingClientRect();
    dragRef.current = { startX: e.clientX, startY: e.clientY, baseX: rect.left, baseY: rect.top };
    movedRef.current = false;
    suppressClickRef.current = false;
    setDragging(true);
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (!movedRef.current && Math.hypot(dx, dy) > 4) movedRef.current = true;
    if (movedRef.current) setPos(clamp(drag.baseX + dx, drag.baseY + dy));
  };

  const handlePointerUp = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setDragging(false);
    suppressClickRef.current = movedRef.current;
  };

  const handleClick = () => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    onOpen();
  };

  if (phase === "idle") return null;

  return (
    <button
      type="button"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => {
        dragRef.current = null;
        setDragging(false);
        suppressClickRef.current = true;
      }}
      onClick={handleClick}
      title={phase === "recording" ? "正在录音 · 点击回到录音页" : "正在生成纪要 · 点击查看"}
      style={pos ? { left: pos.x, top: pos.y } : undefined}
      className={`fixed z-30 w-14 h-14 rounded-full text-white shadow-xl flex flex-col items-center justify-center gap-0.5 touch-none overflow-visible ${
        pos ? "" : "right-5 bottom-24"
      } ${dragging ? "cursor-grabbing" : "cursor-grab"} ${
        phase === "recording"
          ? "bg-gradient-to-br from-brand-500 to-violet-600"
          : "bg-gradient-to-br from-brand-500 to-emerald-500"
      } transition-shadow hover:shadow-2xl`}
    >
      {phase === "recording" ? (
        <>
          <Mic size={17} />
          <span className="text-[9px] font-semibold tabular-nums leading-none">{formatElapsed(elapsed)}</span>
          <span className="absolute top-0.5 right-0.5 w-2.5 h-2.5 rounded-full bg-red-500 ring-2 ring-white animate-pulse" />
        </>
      ) : (
        <>
          <Loader size={17} className="animate-spin" />
          <span className="text-[9px] font-medium leading-none">生成中</span>
        </>
      )}
    </button>
  );
}

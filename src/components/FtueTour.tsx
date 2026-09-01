// EasyWork - 首屏新手指引（漫游式 Tour，仅首次启动展示）
// 步骤配置驱动：target 为元素选择器，rAF 跟随目标位置（工作台卡片会漂移）

import { useEffect, useRef, useState } from "react";

export interface FtueStep {
  target: string;
  title: string;
  desc: string;
}

interface Props {
  steps: FtueStep[];
  onDone: () => void;
}

const SPACING = 14;
const BUBBLE_W = 320;

export default function FtueTour({ steps, onDone }: Props) {
  const [stepIdx, setStepIdx] = useState(0);
  const [ready, setReady] = useState(false);
  const maskRefs = useRef<(HTMLDivElement | null)[]>([]); // 四块遮罩
  const boxRef = useRef<HTMLDivElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const stepIdxRef = useRef(0);
  stepIdxRef.current = stepIdx;

  // 当前步骤：高亮目标 + 更新遮罩/高亮框/气泡位置（rAF 跟随漂移卡片）
  useEffect(() => {
    const step = steps[stepIdx];
    const el = document.querySelector(step.target);
    if (!el) {
      // 目标不存在：自动跳过（防止引导卡死）
      if (stepIdx >= steps.length - 1) onDone();
      else setStepIdx((i) => i + 1);
      return;
    }
    setReady(true);

    let raf = 0;
    const tick = () => {
      const rect = el.getBoundingClientRect();
      const m = maskRefs.current;
      const box = boxRef.current;
      const bubble = bubbleRef.current;
      if (m.length === 4 && box && bubble) {
        // 四块遮罩：上/下/左/右（目标区域透明）
        m[0]!.style.top = "0";
        m[0]!.style.left = "0";
        m[0]!.style.width = "100%";
        m[0]!.style.height = `${rect.top}px`;
        m[1]!.style.top = `${rect.bottom}px`;
        m[1]!.style.left = "0";
        m[1]!.style.width = "100%";
        m[1]!.style.height = `calc(100% - ${rect.bottom}px)`;
        m[2]!.style.top = `${rect.top}px`;
        m[2]!.style.left = "0";
        m[2]!.style.width = `${rect.left}px`;
        m[2]!.style.height = `${rect.height}px`;
        m[3]!.style.top = `${rect.top}px`;
        m[3]!.style.left = `${rect.right}px`;
        m[3]!.style.width = `calc(100% - ${rect.right}px)`;
        m[3]!.style.height = `${rect.height}px`;
        // 高亮边框
        box.style.top = `${rect.top - 3}px`;
        box.style.left = `${rect.left - 3}px`;
        box.style.width = `${rect.width + 6}px`;
        box.style.height = `${rect.height + 6}px`;
        // 气泡：目标下方（空间不足放上方）
        const placeBelow = rect.bottom + SPACING + 150 < window.innerHeight;
        const top = placeBelow ? rect.bottom + SPACING : rect.top - SPACING - 150;
        const left = Math.max(8, Math.min(rect.left + rect.width / 2 - BUBBLE_W / 2, window.innerWidth - BUBBLE_W - 8));
        bubble.style.top = `${top}px`;
        bubble.style.left = `${left}px`;
        // 箭头方向
        bubble.dataset.arrow = placeBelow ? "up" : "down";
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [stepIdx, steps]);

  const next = () => {
    if (stepIdx >= steps.length - 1) {
      onDone();
    } else {
      setStepIdx((i) => i + 1);
    }
  };

  if (!ready) return null;

  const step = steps[stepIdx];

  return (
    <div className="fixed inset-0 z-[9999]">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} ref={(el) => { maskRefs.current[i] = el; }} className="fixed bg-black/45" style={{ pointerEvents: "none" }} />
      ))}
      {/* 高亮框 */}
      <div ref={boxRef} className="fixed rounded-2xl border-2 border-white shadow-[0_0_0_4px_rgba(255,255,255,0.35)]" style={{ pointerEvents: "none" }} />

      {/* 气泡 */}
      <div
        ref={bubbleRef}
        className="fixed w-[320px] bg-white rounded-2xl shadow-2xl p-5"
        style={{ pointerEvents: "auto" }}
      >
        <div
          data-arrow-placeholder=""
          className="absolute w-3 h-3 bg-white rotate-45"
          style={{ top: -6, left: 40 }}
        />
        <p className="text-[10px] font-semibold text-teal-500 uppercase tracking-wider mb-1.5">
          {stepIdx + 1} / {steps.length}
        </p>
        <h3 className="text-sm font-bold text-gray-900 mb-1.5">{step.title}</h3>
        <p className="text-xs text-gray-600 leading-relaxed">{step.desc}</p>
        <div className="flex items-center justify-between mt-4">
          <button
            onClick={onDone}
            className="text-[11px] text-gray-400 hover:text-gray-600 transition-colors"
          >
            跳过
          </button>
          <button
            onClick={next}
            className="px-4 py-1.5 text-xs font-semibold text-white bg-gradient-to-r from-teal-500 to-emerald-500 rounded-lg shadow-md shadow-teal-500/25 hover:opacity-90 transition-all"
          >
            {stepIdx >= steps.length - 1 ? "开始使用" : "下一步"}
          </button>
        </div>
      </div>
    </div>
  );
}

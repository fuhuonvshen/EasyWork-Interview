// EasyWork - 漫游式引导（Tour）：遮罩 + 高亮目标 + 紧贴气泡
// 步骤配置驱动：target 为元素选择器，rAF 跟随目标位置（工作台卡片会漂移）
// storageKey：关闭/完成后写设置标记，保证只展示一次

import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface FtueStep {
  target: string;
  title: string;
  desc: string;
}

interface Props {
  steps: FtueStep[];
  storageKey: string;
  onDone?: () => void;
}

const SPACING = 14;
const BUBBLE_W = 300;

export default function FtueTour({ steps, storageKey, onDone }: Props) {
  const [stepIdx, setStepIdx] = useState(0);
  const [show, setShow] = useState(false);
  const maskRefs = useRef<(HTMLDivElement | null)[]>([]);
  const boxRef = useRef<HTMLDivElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const arrowRef = useRef<HTMLDivElement>(null);

  // 首次展示（设置无标记）
  useEffect(() => {
    invoke<Record<string, string>>("get_settings")
      .then((s) => {
        if (s[storageKey] !== "1") setShow(true);
      })
      .catch(() => {});
  }, [storageKey]);

  const finish = () => {
    setShow(false);
    invoke("update_setting", { key: storageKey, value: "1" }).catch(() => {});
    onDone?.();
  };

  // 当前步骤：高亮目标 + 更新遮罩/高亮框/气泡位置（rAF 跟随漂移卡片）
  useEffect(() => {
    const step = steps[stepIdx];
    const el = document.querySelector(step.target);
    if (!el) {
      // 目标不存在：结束引导（防止卡死）
      finish();
      return;
    }

    let raf = 0;
    const tick = () => {
      const rect = el.getBoundingClientRect();
      const m = maskRefs.current;
      const box = boxRef.current;
      const bubble = bubbleRef.current;
      const arrow = arrowRef.current;
      if (m.length === 4 && box && bubble && arrow) {
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
        // 高亮框
        box.style.top = `${rect.top - 3}px`;
        box.style.left = `${rect.left - 3}px`;
        box.style.width = `${rect.width + 6}px`;
        box.style.height = `${rect.height + 6}px`;

        // 气泡定位：优先目标下方，空间不足放上方；水平居中对准目标
        const bh = bubble.offsetHeight || 140;
        const placeBelow = rect.bottom + SPACING + bh < window.innerHeight;
        const bubbleTop = placeBelow
          ? rect.bottom + SPACING
          : Math.max(8, rect.top - SPACING - bh);
        const leftMin = 8;
        const leftMax = Math.max(leftMin, window.innerWidth - BUBBLE_W - 8);
        const targetCenter = rect.left + rect.width / 2;
        const bubbleLeft = Math.min(Math.max(targetCenter - BUBBLE_W / 2, leftMin), leftMax);
        bubble.style.top = `${bubbleTop}px`;
        bubble.style.left = `${bubbleLeft}px`;
        // 箭头：贴目标一侧，水平指向目标中心
        const arrowLeft = Math.min(Math.max(targetCenter - bubbleLeft - 6, 8), BUBBLE_W - 20);
        arrow.style.top = placeBelow ? "-6px" : "auto";
        arrow.style.bottom = placeBelow ? "auto" : "-6px";
        arrow.style.left = `${arrowLeft}px`;

        bubble.style.opacity = "1";
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [stepIdx, steps, onDone]);

  const next = () => {
    if (stepIdx >= steps.length - 1) {
      finish();
    } else {
      setStepIdx((i) => i + 1);
    }
  };

  const step = steps[stepIdx];
  if (!show || !step) return null;

  return (
    <div className="fixed inset-0 z-[9999]">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} ref={(el) => { maskRefs.current[i] = el; }} className="fixed bg-black/45" style={{ pointerEvents: "none" }} />
      ))}
      {/* 高亮框 */}
      <div ref={boxRef} className="fixed rounded-2xl border-2 border-white shadow-[0_0_0_4px_rgba(255,255,255,0.35)]" style={{ pointerEvents: "none" }} />

      {/* 气泡（初始隐藏，定位后淡入） */}
      <div
        ref={bubbleRef}
        className="fixed w-[300px] bg-white rounded-2xl shadow-2xl p-4 opacity-0 transition-opacity duration-200"
        style={{ pointerEvents: "auto" }}
      >
        <div ref={arrowRef} className="absolute w-3 h-3 bg-white rotate-45" />
        <p className="text-[10px] font-semibold text-teal-500 uppercase tracking-wider mb-1">
          {stepIdx + 1} / {steps.length}
        </p>
        <h3 className="text-[13px] font-bold text-gray-900 mb-1">{step.title}</h3>
        <p className="text-[11px] text-gray-600 leading-relaxed">{step.desc}</p>
        <div className="flex items-center justify-between mt-3">
          <button
            onClick={finish}
            className="text-[11px] text-gray-400 hover:text-gray-600 transition-colors"
          >
            跳过
          </button>
          <button
            onClick={next}
            className="px-4 py-1.5 text-[11px] font-semibold text-white bg-gradient-to-r from-teal-500 to-emerald-500 rounded-lg shadow-md shadow-teal-500/25 hover:opacity-90 transition-all"
          >
            {stepIdx >= steps.length - 1 ? "开始使用" : "下一步"}
          </button>
        </div>
      </div>
    </div>
  );
}

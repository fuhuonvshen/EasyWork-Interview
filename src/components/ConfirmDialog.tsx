// EasyWork - Generic confirmation dialog
import { useRef, useEffect } from "react";
import type { ReactNode } from "react";

export default function ConfirmDialog({
  open,
  icon,
  title,
  description,
  cancelLabel = "取消",
  confirmLabel = "确定",
  confirmVariant = "danger",
  onConfirm,
  onCancel,
  children,
}: {
  open: boolean;
  icon?: ReactNode;
  title: string;
  description?: string;
  cancelLabel?: string;
  confirmLabel?: string;
  confirmVariant?: "danger" | "primary";
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const el = containerRef.current;
    if (!el) return;
    const first = el.querySelector<HTMLElement>("button");
    first?.focus();
  }, [open]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { onCancel(); return; }
    if (e.key !== "Tab" || !containerRef.current) return;
    const focusable = containerRef.current.querySelectorAll<HTMLElement>("button");
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  if (!open) return null;

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      role="dialog" aria-modal="true" aria-label={title}
      onKeyDown={handleKeyDown}
    >
      <div className="bg-white rounded-2xl shadow-xl p-6 mx-4 max-w-sm w-full text-center">
        {icon && <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">{icon}</div>}
        <h3 className="text-lg font-semibold text-gray-900 mb-1">{title}</h3>
        {description && <p className="text-sm text-gray-500 whitespace-pre-line mb-4">{description}</p>}
        {children}
        <div className="flex gap-3 justify-center mt-5">
          <button autoFocus onClick={onCancel} className="px-5 py-2.5 text-sm font-medium text-gray-600 bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors">{cancelLabel}</button>
          <button onClick={onConfirm} className={`px-5 py-2.5 text-sm font-medium text-white rounded-xl hover:opacity-90 transition-colors ${confirmVariant === "danger" ? "bg-red-500" : "bg-brand-600"}`}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

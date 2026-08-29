// EasyWork - Report view/export modal
import { useRef, useEffect } from "react";
import { Sparkles, X } from "lucide-react";
import Markdown from "../../components/Markdown";
import ExportDropdown from "../../components/ExportDropdown";

export default function ReportViewModal({
  content,
  onClose,
}: {
  content: string;
  onClose: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const first = el.querySelector<HTMLElement>("button");
    first?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { onClose(); return; }
    if (e.key !== "Tab" || !containerRef.current) return;
    const focusable = containerRef.current.querySelectorAll<HTMLElement>("button");
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
      role="dialog" aria-modal="true" aria-label="工作报告"
      onKeyDown={handleKeyDown}
    >
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[85vh] mx-4 flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Sparkles size={18} className="text-brand-500" />
            <h2 className="text-lg font-semibold text-gray-900">工作报告</h2>
          </div>
          <div className="flex items-center gap-2">
            <ExportDropdown content={content} />
            <button autoFocus onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
              <X size={18} />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <Markdown content={content} />
        </div>
      </div>
    </div>
  );
}

// EasyWork - Reusable export dropdown (MD / DOCX / PDF / PNG)
import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Download } from "lucide-react";
import { ERRORS, toUserError } from "../errors";
import { showToast } from "./Toast";

const FORMATS = [
  { key: "md", label: "Markdown" },
  { key: "docx", label: "Word (.docx)" },
  { key: "pdf", label: "PDF" },
  { key: "png", label: "图片 (.png)" },
];

export default function ExportDropdown({ content }: { content: string }) {
  const [open, setOpen] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);

  const handleExport = async (format: string) => {
    setOpen(false);
    setExporting(format);
    try {
      await invoke<string>("export_report", { content, format });
      setExporting(null);
    } catch (e) {
      setExporting(null);
      showToast(toUserError(ERRORS.GENERATE_REPORT, e), "error");
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        disabled={!!exporting}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 disabled:opacity-50 transition-colors"
      >
        <Download size={14} />
        {exporting ? `导出 ${exporting.toUpperCase()} 中...` : "导出"}
      </button>
      {open && <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />}
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 bg-white border border-gray-100 rounded-xl shadow-lg py-1 w-28">
          {FORMATS.map((fmt) => (
            <button
              key={fmt.key}
              onClick={() => handleExport(fmt.key)}
              className="w-full text-left px-4 py-2 text-xs text-gray-700 hover:bg-gray-50 transition-colors"
            >
              {fmt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

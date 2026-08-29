// EasyWork - Report loading spinner and result modal
import { Loader, Sparkles, X } from "lucide-react";
import Markdown from "../components/Markdown";
import ExportDropdown from "../components/ExportDropdown";

interface Props {
  report: string | null;
  loading: boolean;
  onClose: () => void;
}

export default function ReportModal({ report, loading, onClose }: Props) {
  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
        <div className="bg-white rounded-2xl shadow-xl p-8 mx-4 text-center">
          <Loader size={32} className="animate-spin text-brand-400 mx-auto mb-4" />
          <p className="text-sm text-gray-600 pointer-events-none">AI 正在生成报告...</p>
        </div>
      </div>
    );
  }

  if (!report) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[85vh] mx-4 flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Sparkles size={18} className="text-brand-500" />
            <h2 className="text-lg font-semibold text-gray-900">工作报告</h2>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <ExportDropdown content={report} />
            </div>
            <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
              <X size={18} />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <Markdown content={report} />
        </div>
      </div>
    </div>
  );
}

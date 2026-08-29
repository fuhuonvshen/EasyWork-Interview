// EasyWork - Generic model card for download list
import { Download } from "lucide-react";

function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec >= 1_000_000) return `${(bytesPerSec / 1_000_000).toFixed(1)} MB/s`;
  if (bytesPerSec >= 1_000) return `${(bytesPerSec / 1_000).toFixed(0)} KB/s`;
  if (bytesPerSec > 0) return `${bytesPerSec} B/s`;
  return "";
}

function formatDownloaded(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(0)} KB`;
  return `${bytes} B`;
}

export interface ModelCardBadge {
  label: string;
  className: string;
}

export interface ModelCardProps {
  displayName: string;
  sizeDisplay: string;
  downloaded: boolean;
  isRecommended: boolean;
  badges?: ModelCardBadge[];
  isDownloading: boolean;
  downloadProgress: number;
  downloadedBytes: number;
  totalBytes: number;
  speed: number;
  disabled?: boolean;
  color?: "accent" | "violet";
  /** Show a small label next to the delete button when downloaded (e.g. "就绪") */
  readyLabel?: string;
  onDownload: () => void;
  onCancel: () => void;
  onDelete: () => void;
}

export default function ModelCard({
  color = "accent",
  ...p
}: ModelCardProps) {
  const c = color === "violet"
    ? { badge: "bg-violet-100 text-violet-700", btn: "bg-violet-500 hover:bg-violet-600", barBg: "bg-violet-100", barFill: "bg-violet-500", text: "text-violet-600", textDim: "text-violet-400" }
    : { badge: "bg-accent-100 text-accent-700", btn: "bg-accent-600 hover:bg-accent-700", barBg: "bg-accent-100", barFill: "bg-accent-500", text: "text-accent-600", textDim: "text-accent-400" };

  return (
    <div className="p-3 rounded-xl border border-gray-100 bg-white">
      <div className="flex items-center justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-900">{p.displayName}</span>
            {p.isRecommended && (
              <span className={`text-[10px] ${c.badge} px-1.5 py-0.5 rounded font-medium`}>推荐</span>
            )}
            {p.downloaded && (
              <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-medium">已下载</span>
            )}
            {p.badges?.map((b, i) => (
              <span key={i} className={`text-[10px] ${b.className} px-1.5 py-0.5 rounded font-medium`}>{b.label}</span>
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-0.5">{p.sizeDisplay}</p>
        </div>
        <div className="flex items-center gap-1.5">
          {p.isDownloading ? (
            <button onClick={p.onCancel}
              className="px-3 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-100 rounded-lg transition-colors">
              取消
            </button>
          ) : p.downloaded ? (
            <div className="flex items-center gap-1.5">
              {p.readyLabel && (
                <span className="text-[10px] text-green-600 bg-green-50 px-2 py-1 rounded font-medium">{p.readyLabel}</span>
              )}
              <button onClick={p.onDelete}
                className="text-[10px] text-red-400 hover:text-red-600 px-2 py-1 rounded hover:bg-red-50 transition-colors">
                删除
              </button>
            </div>
          ) : (
            <button onClick={p.onDownload}
              disabled={p.disabled}
              className={`flex items-center gap-1.5 px-3 py-1.5 ${c.btn} text-white text-xs font-medium rounded-lg disabled:opacity-40 transition-all`}>
              <Download size={14} />下载
            </button>
          )}
        </div>
      </div>
      {p.isDownloading && (
        <div className="mt-2">
          <div className="flex items-center justify-between mb-1">
            <div className={`flex items-center gap-2 text-xs ${c.text} font-medium`}>
              <span>
                {p.totalBytes > 0 ? `${p.downloadProgress}%` : ""}
                {p.downloadedBytes > 0 ? ` ${formatDownloaded(p.downloadedBytes)}` : ""}
                {p.totalBytes > 0 ? ` / ${formatDownloaded(p.totalBytes)}` : ""}
              </span>
              {p.speed > 0 && (
                <span className={`text-[10px] ${c.textDim}`}>{formatSpeed(p.speed)}</span>
              )}
            </div>
          </div>
          <div className={`w-full h-1.5 ${c.barBg} rounded-full overflow-hidden`}>
            {p.totalBytes > 0 ? (
              <div className={`h-full ${c.barFill} rounded-full transition-all duration-300`}
                style={{ width: `${p.downloadProgress}%` }} />
            ) : (
              <div className={`h-full w-1/2 ${c.barFill} rounded-full animate-pulse`} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

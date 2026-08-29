// EasyWork - 自定义标题栏（无边框窗口）
// Windows/Linux 自绘控制按钮；macOS 保留原生红绿灯（titleBarStyle: Overlay），左侧留白。
import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, Copy, X } from "lucide-react";

const appWindow = getCurrentWindow();
const isMac = navigator.userAgent.includes("Mac");

export default function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    const refresh = () => appWindow.isMaximized().then(setIsMaximized).catch(() => {});
    appWindow.onResized(refresh).then((fn) => { unlisten = fn; });
    refresh();
    return () => { unlisten?.(); };
  }, []);

  return (
    <div
      data-tauri-drag-region
      onDoubleClick={() => appWindow.toggleMaximize()}
      className="h-8 flex items-center select-none flex-shrink-0"
    >
      {/* macOS: 左侧给红绿灯留位 */}
      {isMac && <div className="w-[78px] flex-shrink-0" data-tauri-drag-region />}
      <div data-tauri-drag-region className="flex-1 min-w-0 flex items-center gap-1.5 pl-2.5">
        <img src="/easywork-icon.png" alt="EasyWork" className="w-4 h-4 rounded" draggable={false} />
        <span className="text-xs font-medium text-gray-600">EasyWork</span>
      </div>
      {!isMac && (
        <div className="flex h-full">
          <button
            onClick={() => appWindow.minimize()}
            aria-label="最小化"
            className="w-11 h-full flex items-center justify-center text-gray-500 hover:bg-gray-200/60 transition-colors"
          >
            <Minus size={15} />
          </button>
          <button
            onClick={() => appWindow.toggleMaximize()}
            aria-label={isMaximized ? "还原" : "最大化"}
            className="w-11 h-full flex items-center justify-center text-gray-500 hover:bg-gray-200/60 transition-colors"
          >
            {isMaximized ? <Copy size={13} /> : <Square size={13} />}
          </button>
          <button
            onClick={() => appWindow.close()}
            aria-label="关闭"
            className="w-11 h-full flex items-center justify-center text-gray-500 hover:bg-red-500 hover:text-white transition-colors"
          >
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

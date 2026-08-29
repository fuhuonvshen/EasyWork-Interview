// EasyWork - Global toast manager
import { useState, useEffect, useCallback } from "react";

type ToastItem = { id: number; message: string; type: "success" | "error" | "info" };
let nextId = 0;
let currentSetToasts: ((fn: (prev: ToastItem[]) => ToastItem[]) => void) | null = null;

export function showToast(message: string, type: ToastItem["type"] = "error") {
  currentSetToasts?.((prev) => [...prev, { id: nextId++, message, type }]);
}

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  // Assign the setter in effect (not render) so it's React-rule compliant.
  // Cleanup on unmount so stale closures don't accumulate.
  useEffect(() => {
    currentSetToasts = setToasts;
    return () => {
      currentSetToasts = null;
    };
  }, []);

  const remove = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[9999] flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <ToastItem key={t.id} item={t} onDone={() => remove(t.id)} />
      ))}
    </div>
  );
}

function ToastItem({ item, onDone }: { item: ToastItem; onDone: () => void }) {
  useEffect(() => { const t = setTimeout(onDone, 3000); return () => clearTimeout(t); }, [onDone]);

  const bg = item.type === "success" ? "bg-green-600" : item.type === "error" ? "bg-red-600" : "bg-gray-800";

  return (
    <div className={`${bg} text-white text-sm px-4 py-2.5 rounded-lg shadow-lg animate-in fade-in slide-in-from-bottom-2 pointer-events-auto flex items-center gap-2 max-w-md`}>
      <span>{item.message}</span>
      <button onClick={onDone} className="ml-1 opacity-60 hover:opacity-100 text-xs">✕</button>
    </div>
  );
}

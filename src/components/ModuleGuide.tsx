// EasyWork - 模块内新手指引（用户首次进入某模块时展示一次，关闭后写标记）
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Sparkles, X } from "lucide-react";

interface Props {
  storageKey: string;
  text: string;
  accent?: "amber" | "teal" | "violet";
}

const ACCENTS = {
  amber: { bar: "from-amber-50 to-orange-50", border: "border-amber-200", icon: "text-amber-600", btn: "bg-amber-100 text-amber-700 hover:bg-amber-200" },
  teal: { bar: "from-teal-50 to-emerald-50", border: "border-teal-200", icon: "text-teal-600", btn: "bg-teal-100 text-teal-700 hover:bg-teal-200" },
  violet: { bar: "from-violet-50 to-purple-50", border: "border-violet-200", icon: "text-violet-600", btn: "bg-violet-100 text-violet-700 hover:bg-violet-200" },
};

export default function ModuleGuide({ storageKey, text, accent = "amber" }: Props) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    invoke<Record<string, string>>("get_settings")
      .then((s) => {
        if (s[storageKey] !== "1") setVisible(true);
      })
      .catch(() => {});
  }, [storageKey]);

  if (!visible) return null;

  const a = ACCENTS[accent];
  const dismiss = () => {
    setVisible(false);
    invoke("update_setting", { key: storageKey, value: "1" }).catch(() => {});
  };

  return (
    <div className={`flex items-center gap-3 px-4 py-2.5 rounded-xl border ${a.border} bg-gradient-to-r ${a.bar}`}>
      <Sparkles size={14} className={`${a.icon} flex-shrink-0`} />
      <p className="flex-1 text-[11px] text-gray-600 leading-relaxed">{text}</p>
      <button
        onClick={dismiss}
        className={`px-3 py-1 text-[11px] font-medium rounded-lg transition-colors flex-shrink-0 ${a.btn}`}
      >
        知道了
      </button>
      <button onClick={dismiss} className={`${a.icon} opacity-50 hover:opacity-100 transition-opacity flex-shrink-0`} title="关闭">
        <X size={13} />
      </button>
    </div>
  );
}

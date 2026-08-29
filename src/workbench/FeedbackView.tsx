// EasyWork - 意见反馈
// 大卡片布局（无侧边栏），邮件形式提交：发件人用户邮箱，收件人开发者邮箱。
// 点击发送直接 POST 到飞书群机器人 webhook（签名校验），推送反馈到开发者。
import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ArrowLeft, Mail, Send, Loader } from "lucide-react";
import { showToast } from "../components/Toast";

export default function FeedbackView({ onBack }: { onBack: () => void }) {
  const [sender, setSender] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  const handleSend = async () => {
    setSending(true);
    try {
      await invoke("send_feedback", { from: sender, subject, body });
      showToast("反馈已发送，感谢你的意见！", "success");
      setSender("");
      setSubject("");
      setBody("");
    } catch (e) {
      console.error("发送反馈失败", e);
      showToast("发送失败，请稍后重试", "error");
    }
    setSending(false);
  };

  const canSend = sender.trim() !== "" && body.trim() !== "" && !sending;

  return (
    <div className="h-full flex items-center justify-center px-8 py-6">
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow-sm border border-gray-100 flex flex-col overflow-hidden">
        {/* 头部 */}
        <div className="px-8 pt-6 pb-5">
          <div className="flex items-center gap-3">
            <button
              onClick={onBack}
              aria-label="返回工作台"
              className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors"
            >
              <ArrowLeft size={18} />
            </button>
            <h2 className="text-xl font-semibold text-gray-900">意见反馈</h2>
          </div>
          <p className="text-sm text-gray-500 leading-relaxed mt-3">
            你的每一次反馈，都在定义 EasyWork 的未来。
            好的建议会落实到下一个版本里，请畅所欲言，你的意见就是产品前进的方向。
          </p>
        </div>

        {/* 邮件表单 */}
        <div className="flex-1 px-8 pb-8 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">收件人</label>
              <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-gray-200 bg-gray-100 text-sm text-gray-600 select-none">
                开发者（sun）
              </div>
            </div>            
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">发件人（你的邮箱）</label>
              <input
                type="email"
                value={sender}
                onChange={(e) => setSender(e.target.value)}
                placeholder="you@ab-inbev.com"
                className="w-full px-3 py-2.5 rounded-lg border border-gray-200 bg-gray-50 text-sm text-gray-900 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-brand-300 focus:border-brand-400 focus:bg-white transition-colors"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">主题</label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="一句话概括你的建议"
              className="w-full px-3 py-2.5 rounded-lg border border-gray-200 bg-gray-50 text-sm text-gray-900 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-brand-300 focus:border-brand-400 focus:bg-white transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">内容</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="详细描述你的想法、遇到的问题或建议…"
              rows={6}
              className="w-full px-3 py-2.5 rounded-lg border border-gray-200 bg-gray-50 text-sm text-gray-900 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-brand-300 focus:border-brand-400 focus:bg-white transition-colors resize-none"
            />
          </div>

          <div className="flex justify-end pt-1">
            <button
              onClick={handleSend}
              disabled={!canSend}
              className="inline-flex items-center gap-2 px-6 py-2.5 bg-amber-600 text-white text-sm font-medium rounded-full hover:bg-amber-700 active:scale-95 transition-all shadow-md shadow-amber-500/25 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {sending ? <Loader size={14} className="animate-spin" /> : <Send size={14} />}
              {sending ? "发送中..." : "发送反馈"}
            </button>
          </div>
          <p className="text-[11px] text-gray-400 text-right -mt-2 pointer-events-none">
            反馈将直接推送给开发者，请填写邮箱便于回复
          </p>
        </div>
      </div>
    </div>
  );
}

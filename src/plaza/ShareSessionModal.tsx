// EasyWork - 分享到面经广场：提交前的预览与编辑（参考答案不上传，提交后人工审核）
import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { X, Share2, Loader, Check, ShieldCheck } from "lucide-react";
import type { CSSProperties } from "react";
import type { QuestionSession } from "../types";
import { showToast } from "../components/Toast";
import { STAGE_OPTIONS } from "../schedule/ScheduleForm";
import { STAGE_LABELS } from "../minutes/history/HistoryDetail";
import { DIFF_LABEL, coverHue, coverInitial, coverTitle } from "../questions/meta";

export default function ShareSessionModal({ session, alreadyShared, onClose, onShared }: {
  session: QuestionSession;
  alreadyShared: boolean;
  onClose: () => void;
  onShared: (recordId: string, sharedAt: string) => void;
}) {
  // 未归类的场次没有会议名可用，标题留空让用户自己起
  const [title, setTitle] = useState(session.meeting_id ? coverTitle(session) : "");
  const [company, setCompany] = useState(session.company ?? "");
  const [position, setPosition] = useState(session.position ?? "");
  const [stage, setStage] = useState(session.stage ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  // 历史数据里可能有 hr/one/two/three 之外的阶段值，下拉里也要能显示
  const stageOptions = [...STAGE_OPTIONS];
  if (stage && !stageOptions.some((s) => s.value === stage)) {
    stageOptions.unshift({ value: stage, label: STAGE_LABELS[stage]?.label ?? stage });
  }

  const submit = async () => {
    const t = title.trim();
    if (!t) {
      showToast("先给这份面经起个标题", "error");
      return;
    }
    setSubmitting(true);
    try {
      const now = new Date();
      const p = (n: number) => String(n).padStart(2, "0");
      const sharedAt = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}:${p(now.getMinutes())}`;
      const recordId = await invoke<string>("plaza_share_session", {
        title: t,
        company: company.trim(),
        position: position.trim(),
        stage: stageOptions.find((s) => s.value === stage)?.label ?? "",
        questions: session.questions.map((q) => ({
          category: q.category,
          difficulty: q.difficulty,
          question: q.question,
        })),
        shared_at: sharedAt,
      });
      setDone(true);
      onShared(recordId, sharedAt);
    } catch (e) {
      console.error(e);
      showToast("提交失败，请稍后再试", "error");
    }
    setSubmitting(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 backdrop-blur-sm">
      <div
        className="bg-white rounded-2xl shadow-2xl w-[600px] max-w-[calc(100vw-48px)] max-h-[calc(100vh-80px)] overflow-y-auto p-5"
        style={{ animation: "dsh-pop .2s ease" }}
      >
        <style>{`@keyframes dsh-pop { from { transform: translateY(12px) scale(.97); opacity: 0 } to { transform: none; opacity: 1 } }`}</style>

        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
            <Share2 size={16} className="text-violet-500" />
            分享到面经广场
          </h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>

        {done ? (
          <div className="py-8 flex flex-col items-center text-center">
            <div className="w-14 h-14 rounded-full bg-emerald-50 flex items-center justify-center mb-3">
              <Check size={26} className="text-emerald-500" />
            </div>
            <p className="text-sm font-semibold text-gray-800">已提交，等待审核</p>
            <p className="text-xs text-gray-400 mt-1.5 leading-relaxed">
              审核通过后，这份面经会出现在面经广场
              <br />
              其他人可以浏览和收藏
            </p>
            <button
              onClick={onClose}
              className="mt-5 px-6 py-2 text-xs font-semibold text-white bg-violet-600 rounded-lg hover:bg-violet-700 transition-colors"
            >
              完成
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-start gap-2 text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mb-4 leading-relaxed">
              <ShieldCheck size={13} className="mt-0.5 flex-shrink-0" />
              <span>
                提交后会先进入人工审核，通过后才出现在广场；参考答案不会被分享。
                {alreadyShared && (
                  <span className="block mt-0.5 text-amber-600">这张卡之前提交过，重复提交会在审核队列里出现两条记录。</span>
                )}
              </span>
            </div>

            <div className="flex items-center gap-3 mb-4">
              <div className="qb-cover qb-cover-sm" style={{ "--qc-h": coverHue(session) } as CSSProperties}>
                <span className="qb-cover-initial">{coverInitial(session)}</span>
              </div>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="给它起个标题，例如：某半导体公司 · 算法工程师 · 一面"
                className="flex-1 min-w-0 px-3 py-2 rounded-lg border border-gray-200 text-sm font-medium text-gray-800 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-violet-300"
              />
            </div>

            <div className="grid grid-cols-3 gap-3 mb-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">公司</label>
                <input
                  type="text"
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  placeholder="可匿名，如：某大厂"
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">岗位</label>
                <input
                  type="text"
                  value={position}
                  onChange={(e) => setPosition(e.target.value)}
                  placeholder="如：后端开发"
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">轮次</label>
                <select
                  value={stage}
                  onChange={(e) => setStage(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet-300"
                >
                  <option value="">未填写</option>
                  {stageOptions.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-gray-500">将分享以下 {session.questions.length} 道题</label>
              <span className="text-[10px] text-gray-300">参考答案不上传</span>
            </div>
            <div className="rounded-xl border border-gray-100 bg-gray-50/60 max-h-52 overflow-y-auto divide-y divide-gray-100">
              {session.questions.map((q) => (
                <div key={q.id} className="px-3.5 py-2.5">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 border border-violet-200">
                      {q.category}
                    </span>
                    {DIFF_LABEL[q.difficulty] && (
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${DIFF_LABEL[q.difficulty].cls}`}>
                        {DIFF_LABEL[q.difficulty].label}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-700 leading-relaxed">{q.question}</p>
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={onClose}
                className="px-4 py-2 text-xs font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              >
                取消
              </button>
              <button
                onClick={submit}
                disabled={submitting}
                className="px-4 py-2 text-xs font-semibold text-white bg-violet-600 rounded-lg hover:bg-violet-700 disabled:opacity-40 transition-colors flex items-center gap-1.5"
              >
                {submitting ? <Loader size={13} className="animate-spin" /> : <Share2 size={13} />}
                提交审核
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

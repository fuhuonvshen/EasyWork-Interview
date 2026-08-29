// EasyWork - 我的题库：查看 AI 从面试中提取的面试官问题（按分类筛选 / 删除 / 一键面试回答演练）
import { useState, useEffect, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ArrowLeft, BookOpen, Loader, Trash2, Sparkles, Bot } from "lucide-react";
import type { InterviewQuestion } from "../types";
import { showToast } from "../components/Toast";

const DIFF_LABEL: Record<string, { label: string; cls: string }> = {
  easy: { label: "简单", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  medium: { label: "中等", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  hard: { label: "困难", cls: "bg-rose-50 text-rose-700 border-rose-200" },
};

export default function QuestionBankView({ onBack, onAsk }: {
  onBack: () => void;
  onAsk?: (question: string) => void;
}) {
  const [questions, setQuestions] = useState<InterviewQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState<string>("全部");

  const load = useCallback(() => {
    setLoading(true);
    invoke<InterviewQuestion[]>("interview_question_list", { category: category === "全部" ? null : category, limit: 300 })
      .then(setQuestions)
      .catch(() => showToast("加载题库失败", "error"))
      .finally(() => setLoading(false));
  }, [category]);

  useEffect(() => { load(); }, [load]);

  const categories = useMemo(() => {
    // 全部题库里出现的分类（仅当当前筛选为"全部"时可用）
    const set = new Set<string>();
    questions.forEach((q) => set.add(q.category));
    return ["全部", ...Array.from(set)];
  }, [questions]);

  const handleDelete = async (id: string) => {
    try {
      await invoke("interview_question_delete", { id });
      load();
      showToast("已删除", "success");
    } catch {
      showToast("删除失败", "error");
    }
  };

  return (
    <div className="h-full flex flex-col bg-white rounded-lg overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-3 flex-shrink-0">
        <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
          <ArrowLeft size={18} />
        </button>
        <div className="flex items-center gap-2">
          <span className="w-8 h-8 rounded-xl bg-violet-50 text-violet-600 flex items-center justify-center">
            <BookOpen size={16} />
          </span>
          <div>
            <h2 className="text-lg font-semibold text-gray-900 leading-tight">我的题库</h2>
            <p className="text-[11px] text-gray-400">AI 复盘时提取的面试官问题 · 共 {questions.length} 题</p>
          </div>
        </div>
        {questions.length === 0 && !loading && (
          <span className="ml-auto flex items-center gap-1 text-[11px] text-gray-400 bg-gray-50 px-3 py-1.5 rounded-full">
            <Sparkles size={12} className="text-violet-500" />
            复盘真实面试后，AI 会自动帮你收集题目
          </span>
        )}
      </div>

      {/* 分类筛选 */}
      <div className="px-6 py-2.5 border-b border-gray-50 flex items-center gap-2 flex-shrink-0 overflow-x-auto">
        {categories.map((c) => (
          <button
            key={c}
            onClick={() => setCategory(c)}
            className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
              category === c ? "bg-violet-600 text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      {/* 题目列表 */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {loading ? (
          <div className="flex items-center justify-center gap-2 text-sm text-gray-400 py-12">
            <Loader size={16} className="animate-spin" /> 加载中...
          </div>
        ) : questions.length === 0 ? (
          <div className="text-center py-14">
            <div className="w-14 h-14 rounded-2xl bg-gray-50 flex items-center justify-center mx-auto mb-4">
              <BookOpen size={26} className="text-gray-300" />
            </div>
            <p className="text-sm text-gray-400">{category === "全部" ? "题库还是空的" : `「${category}」分类下暂无题目`}</p>
            <p className="text-xs text-gray-300 mt-1">去录一场真实面试，AI 复盘时会帮你提取面试官的问题</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {questions.map((q) => (
              <div key={q.id} className="group flex items-start gap-3 px-4 py-3.5 rounded-xl bg-white border border-gray-100 shadow-sm hover:shadow-md hover:border-violet-100 transition-all">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 border border-violet-200">{q.category}</span>
                    {DIFF_LABEL[q.difficulty] && (
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${DIFF_LABEL[q.difficulty].cls}`}>
                        {DIFF_LABEL[q.difficulty].label}
                      </span>
                    )}
                    <span className="text-[10px] text-gray-300">{q.created_at.slice(0, 10)}</span>
                  </div>
                  <p className="text-sm text-gray-800 leading-relaxed">{q.question}</p>
                  {q.expected_answer && (
                    <p className="mt-1.5 text-xs text-gray-400 leading-relaxed line-clamp-2">💡 {q.expected_answer}</p>
                  )}
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {onAsk && (
                    <button
                      onClick={() => onAsk(q.question)}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 transition-colors flex items-center gap-1"
                      title="前往面试助手，让 AI 结合你的简历准备回答"
                    >
                      <Bot size={13} />
                      如何回答
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(q.id)}
                    className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                    title="删除这道题"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

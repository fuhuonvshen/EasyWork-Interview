// EasyWork - 面经广场：别人分享的真实面经（卡片流 + 详情 + 收藏）
import { useState, useEffect, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ArrowLeft, Heart, Loader, RefreshCw, AlertCircle, MessagesSquare, Search, X } from "lucide-react";
import type { CSSProperties } from "react";
import type { PlazaSession } from "../types";
import { showToast } from "../components/Toast";
import { DIFF_LABEL, hueFromString } from "../questions/meta";

// 无公司/标题可依据时的中性色相（与题库「未归类」同色）
const PLAZA_HUE_DEFAULT = 218;

function plazaHue(s: PlazaSession): number {
  const seed = (s.company || s.title || "").trim();
  return seed ? hueFromString(seed) : PLAZA_HUE_DEFAULT;
}

function plazaInitial(s: PlazaSession): string {
  const src = (s.company || s.title || "").trim();
  return src ? Array.from(src)[0] : "面";
}

function plazaTitle(s: PlazaSession): string {
  const t = (s.title || "").trim();
  if (t) return t;
  return [s.company, s.position].filter(Boolean).join(" ") || "未命名面经";
}

// 封面副标题：公司 · 岗位 · 轮次（标题里已出现的就不重复）
function plazaSub(s: PlazaSession): string {
  const title = plazaTitle(s);
  const parts: string[] = [];
  if (s.company && !title.includes(s.company)) parts.push(s.company);
  if (s.position && !title.includes(s.position)) parts.push(s.position);
  if (s.stage && !title.includes(s.stage)) parts.push(s.stage);
  return parts.join(" · ");
}

function PlazaCard({ session, favorited, onOpen, onToggleFav }: {
  session: PlazaSession;
  favorited: boolean;
  onOpen: () => void;
  onToggleFav: () => void;
}) {
  const sub = plazaSub(session);
  const cats = Array.from(new Set(session.questions.map((q) => q.category)));
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onOpen}
        className="w-full text-left rounded-2xl bg-white border border-gray-100 p-2.5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-gray-200/70 hover:border-violet-100 focus:outline-none focus:ring-2 focus:ring-violet-300"
      >
        <div className="qb-cover" style={{ "--qc-h": plazaHue(session) } as CSSProperties}>
          <span className="qb-cover-mark">{plazaInitial(session)}</span>
          <span className="qb-cover-title">{plazaTitle(session)}</span>
          {sub && <span className="qb-cover-sub">{sub}</span>}
        </div>
        <div className="px-1 pt-2.5 pb-1">
          <div className="flex items-center gap-1.5 text-[11px]">
            <span className="text-gray-400">{session.shared_at ? session.shared_at.slice(0, 10) : "日期未知"}</span>
            <span className="text-gray-300">·</span>
            <span className="font-semibold text-violet-600">{session.questions.length} 题</span>
            <span className="ml-auto flex items-center gap-0.5 text-rose-400">
              <Heart size={11} className={favorited ? "fill-current" : ""} />
              {session.favorites}
            </span>
          </div>
          {cats.length > 0 && (
            <div className="mt-1.5 flex items-center gap-1 overflow-hidden">
              {cats.slice(0, 3).map((c) => (
                <span key={c} className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-50 text-violet-700 border border-violet-100 whitespace-nowrap">
                  {c}
                </span>
              ))}
              {cats.length > 3 && <span className="text-[10px] text-gray-400 flex-shrink-0">+{cats.length - 3}</span>}
            </div>
          )}
        </div>
      </button>
      <button
        type="button"
        onClick={onToggleFav}
        title={favorited ? "取消收藏" : "收藏这份面经"}
        className={`absolute top-3.5 right-3.5 w-7 h-7 rounded-full flex items-center justify-center backdrop-blur-sm shadow-sm transition-colors ${
          favorited ? "bg-rose-500/90 text-white hover:bg-rose-600" : "bg-black/25 text-white hover:bg-black/40"
        }`}
      >
        <Heart size={14} className={favorited ? "fill-current" : ""} />
      </button>
    </div>
  );
}

export default function PlazaView({ onBack }: { onBack: () => void }) {
  const [sessions, setSessions] = useState<PlazaSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  // 本地收藏的 record_id 列表（云端只存计数，谁是"我收藏的"只有本机知道）
  const [favorites, setFavorites] = useState<string[]>([]);
  const [favBusy, setFavBusy] = useState<string | null>(null);
  // 搜索（按公司名关键字）与排序（最新 / 最热）
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"latest" | "hot">("latest");

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    invoke<PlazaSession[]>("plaza_list_sessions")
      .then(setSessions)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    invoke<Record<string, string>>("get_settings")
      .then((s) => {
        if (s.plaza_favorites) {
          try {
            const arr = JSON.parse(s.plaza_favorites);
            if (Array.isArray(arr)) setFavorites(arr);
          } catch {}
        }
      })
      .catch(() => {});
  }, []);

  const isFav = (id: string) => favorites.includes(id);

  // 搜索按公司名过滤（数据量小，纯前端做）；热度排序按收藏数，"最新"保持服务端顺序
  const visibleSessions = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q ? sessions.filter((s) => (s.company || "").toLowerCase().includes(q)) : sessions;
    if (sort === "hot") {
      return [...filtered].sort((a, b) => b.favorites - a.favorites || (a.shared_at < b.shared_at ? 1 : -1));
    }
    return filtered;
  }, [sessions, query, sort]);

  // 刷新后选中项还在（按 id 找，不存对象）
  const activeSession = useMemo(
    () => (activeId ? sessions.find((s) => s.record_id === activeId) ?? null : null),
    [sessions, activeId],
  );

  const toggleFavorite = async (s: PlazaSession) => {
    if (favBusy) return;
    const nowFav = isFav(s.record_id);
    setFavBusy(s.record_id);
    // 乐观更新 + 本地记录立即落地（网络失败再回滚）
    const nextFavs = nowFav ? favorites.filter((id) => id !== s.record_id) : [...favorites, s.record_id];
    setFavorites(nextFavs);
    setSessions((prev) =>
      prev.map((x) => (x.record_id === s.record_id ? { ...x, favorites: Math.max(0, x.favorites + (nowFav ? -1 : 1)) } : x)),
    );
    invoke("update_setting", { key: "plaza_favorites", value: JSON.stringify(nextFavs) }).catch(() => {});
    try {
      const count = await invoke<number>("plaza_set_favorite", { record_id: s.record_id, favorited: !nowFav });
      setSessions((prev) => prev.map((x) => (x.record_id === s.record_id ? { ...x, favorites: count } : x)));
    } catch {
      setFavorites(favorites);
      setSessions((prev) => prev.map((x) => (x.record_id === s.record_id ? { ...x, favorites: s.favorites } : x)));
      showToast("操作失败，请稍后再试", "error");
    }
    setFavBusy(null);
  };

  const questionRow = (q: { category: string; difficulty: string; question: string }, i: number) => (
    <div key={i} className="flex items-start gap-3 px-4 py-3.5 rounded-xl bg-white border border-gray-100 shadow-sm">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 border border-violet-200">{q.category}</span>
          {DIFF_LABEL[q.difficulty] && (
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${DIFF_LABEL[q.difficulty].cls}`}>
              {DIFF_LABEL[q.difficulty].label}
            </span>
          )}
        </div>
        <p className="text-sm text-gray-800 leading-relaxed">{q.question}</p>
      </div>
    </div>
  );

  const favDetailButton = activeSession && (
    <button
      onClick={() => toggleFavorite(activeSession)}
      disabled={favBusy === activeSession.record_id}
      className={`ml-1 flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors flex-shrink-0 disabled:opacity-60 ${
        isFav(activeSession.record_id)
          ? "text-rose-600 bg-rose-50 hover:bg-rose-100"
          : "text-white bg-rose-500 hover:bg-rose-600"
      }`}
    >
      <Heart size={14} className={isFav(activeSession.record_id) ? "fill-current" : ""} />
      {isFav(activeSession.record_id) ? "已收藏" : "收藏"} {activeSession.favorites}
    </button>
  );

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 min-h-0 flex gap-2.5 pl-0.5 pr-0.5 pt-3 pb-3">
        <div className="flex-1 min-w-0 bg-white rounded-lg overflow-hidden flex flex-col">
          {activeSession ? (
            <>
              {/* 详情：这份面经的全部题目（只读，无参考答案） */}
              <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-3 flex-shrink-0">
                <button
                  onClick={() => setActiveId(null)}
                  className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                  title="返回广场"
                >
                  <ArrowLeft size={18} />
                </button>
                <div className="qb-cover qb-cover-sm" style={{ "--qc-h": plazaHue(activeSession) } as CSSProperties}>
                  <span className="qb-cover-initial">{plazaInitial(activeSession)}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="text-lg font-semibold text-gray-900 leading-tight truncate">{plazaTitle(activeSession)}</h2>
                  <p className="text-[11px] text-gray-400 truncate">
                    {[
                      plazaSub(activeSession),
                      activeSession.shared_at ? activeSession.shared_at.slice(0, 10) : "",
                      `共 ${activeSession.questions.length} 题`,
                    ].filter(Boolean).join(" · ")}
                  </p>
                </div>
                {favDetailButton}
              </div>
              <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2.5">
                {activeSession.questions.map(questionRow)}
                <p className="text-center text-[11px] text-gray-300 pt-2">来自他人的分享 · 参考答案未公开</p>
              </div>
            </>
          ) : (
            <>
              <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-3 flex-shrink-0">
                <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
                  <ArrowLeft size={18} />
                </button>
                <div className="flex items-center gap-2">
                  <span className="w-8 h-8 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center">
                    <MessagesSquare size={16} />
                  </span>
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900 leading-tight">面经广场</h2>
                    <p className="text-[11px] text-gray-400">
                      {loading ? "加载中..." : error ? "加载失败" : query.trim()
                        ? `搜索「${query.trim()}」· 找到 ${visibleSessions.length} 份`
                        : `大家分享的真实面经 · 共 ${sessions.length} 份`}
                    </p>
                  </div>
                </div>
                <button
                  onClick={load}
                  disabled={loading}
                  className="ml-auto p-2 rounded-lg text-gray-400 hover:text-sky-600 hover:bg-sky-50 transition-colors disabled:opacity-50"
                  title="刷新"
                >
                  <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
                </button>
              </div>

              {/* 搜索 + 排序（广场为空时没有可搜的，省掉这一行） */}
              {!error && sessions.length > 0 && (
                <div className="px-6 py-2.5 border-b border-gray-50 flex items-center gap-2 flex-shrink-0">
                  <div className="relative w-64 max-w-[45%]">
                    <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300 pointer-events-none" />
                    <input
                      type="text"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="搜索公司，如：字节跳动"
                      className="w-full pl-8 pr-8 py-1.5 rounded-full border border-gray-200 text-xs focus:outline-none focus:ring-2 focus:ring-sky-200"
                    />
                    {query && (
                      <button
                        onClick={() => setQuery("")}
                        title="清空搜索"
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-gray-300 hover:text-gray-500"
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>
                  <div className="ml-auto flex items-center gap-1.5">
                    {(["latest", "hot"] as const).map((k) => (
                      <button
                        key={k}
                        onClick={() => setSort(k)}
                        className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                          sort === k ? "bg-sky-500 text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                        }`}
                      >
                        {k === "latest" ? "最新" : "最热"}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex-1 overflow-y-auto px-6 py-5">
                {loading ? (
                  <div className="flex items-center justify-center gap-2 text-sm text-gray-400 py-12">
                    <Loader size={16} className="animate-spin" /> 加载中...
                  </div>
                ) : error ? (
                  <div className="text-center py-14">
                    <div className="w-14 h-14 rounded-2xl bg-red-50 flex items-center justify-center mx-auto mb-4">
                      <AlertCircle size={26} className="text-red-300" />
                    </div>
                    <p className="text-sm text-gray-500">加载失败，检查下网络？</p>
                    <p className="text-xs text-gray-300 mt-1 max-w-[420px] mx-auto truncate">{error}</p>
                    <button
                      onClick={load}
                      className="mt-4 px-4 py-2 text-xs font-semibold text-white bg-sky-500 rounded-lg hover:bg-sky-600 transition-colors"
                    >
                      重试
                    </button>
                  </div>
                ) : sessions.length === 0 ? (
                  <div className="text-center py-14">
                    <div className="w-14 h-14 rounded-2xl bg-gray-50 flex items-center justify-center mx-auto mb-4">
                      <MessagesSquare size={26} className="text-gray-300" />
                    </div>
                    <p className="text-sm text-gray-400">广场还空着</p>
                    <p className="text-xs text-gray-300 mt-1">在「我的题库」里把面经分享出来，审核通过后就会出现在这里</p>
                  </div>
                ) : visibleSessions.length === 0 ? (
                  <div className="text-center py-14">
                    <div className="w-14 h-14 rounded-2xl bg-gray-50 flex items-center justify-center mx-auto mb-4">
                      <Search size={24} className="text-gray-300" />
                    </div>
                    <p className="text-sm text-gray-400">没有找到「{query.trim()}」相关的面经</p>
                    <p className="text-xs text-gray-300 mt-1">搜索的是公司名，换个关键字试试</p>
                  </div>
                ) : (
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                    {visibleSessions.map((s) => (
                      <PlazaCard
                        key={s.record_id}
                        session={s}
                        favorited={isFav(s.record_id)}
                        onOpen={() => setActiveId(s.record_id)}
                        onToggleFav={() => toggleFavorite(s)}
                      />
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

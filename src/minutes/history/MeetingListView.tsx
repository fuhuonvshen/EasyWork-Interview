// EasyWork - Meeting list view (search, filter, paginate, manage, delete)
import { useState, useEffect, useRef, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FileText, ChevronRight, Search, X, Pin, Trash2, Loader2, CalendarDays } from "lucide-react";
import type { MeetingRow } from "../../types";
import { ERRORS, toUserError } from "../../errors";
import ConfirmDialog from "../../components/ConfirmDialog";
import { showToast } from "../../components/Toast";

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;
const DEFAULT_PAGE_SIZE = PAGE_SIZE_OPTIONS[0];

// 日期字段：按钮点击调用原生 showPicker() 弹系统日历，
// 显示层自定义（未选时提示文字，有值时统一 YYYY-MM-DD 格式）
function DateField({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="relative w-32">
      <input
        ref={inputRef}
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className="sr-only"
      />
      <button
        type="button"
        onClick={() => {
          const el = inputRef.current;
          if (!el) return;
          try {
            el.showPicker();
          } catch {
            el.click();
          }
        }}
        className="w-full flex items-center gap-1.5 px-2.5 py-2 rounded-lg border border-gray-200 text-xs bg-gray-50 hover:bg-gray-100 transition-colors"
      >
        {value ? <span className="text-gray-600">{value}</span> : <span className="text-gray-400">{label}</span>}
        <CalendarDays size={13} className="ml-auto text-gray-400 flex-shrink-0" />
      </button>
    </div>
  );
}

export default function MeetingListView({
  onSelectMeeting,
  isBusy,
}: {
  onSelectMeeting: (id: string) => void;
  isBusy: boolean;
}) {
  const [meetings, setMeetings] = useState<MeetingRow[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [totalMeetings, setTotalMeetings] = useState(0);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [deleteTarget, setDeleteTarget] = useState<MeetingRow | null>(null);
  const [showBatchDelete, setShowBatchDelete] = useState(false);
  const [deleteAudio, setDeleteAudio] = useState(false);
  const [batchDeleteAudio, setBatchDeleteAudio] = useState(false);
  const [loading, setLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = () => setRefreshKey((k) => k + 1);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isManageMode, setIsManageMode] = useState(false);
  const selectAllRef = useRef<HTMLInputElement>(null);

  // Debounce search query before fetching
  const [debouncedQuery, setDebouncedQuery] = useState(searchQuery);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchQuery), 300);
    return () => clearTimeout(t);
  }, [searchQuery]);
  // Sync debouncedQuery back when it catches up (e.g. clear button)
  useEffect(() => { if (searchQuery === "") setDebouncedQuery(""); }, [searchQuery]);

  const prevQuery = useRef({ page, debouncedQuery, dateFrom, dateTo });

  useEffect(() => {
    const queryChanged = prevQuery.current.debouncedQuery !== debouncedQuery ||
      prevQuery.current.dateFrom !== dateFrom ||
      prevQuery.current.dateTo !== dateTo;
    prevQuery.current = { page, debouncedQuery, dateFrom, dateTo };

    const effectivePage = queryChanged ? 1 : page;
    if (queryChanged && page !== 1) { setPage(1); return; }

    setLoading(true);
    invoke<{ items: MeetingRow[]; total: number; page: number; page_size: number }>("list_meetings", {
      page: effectivePage, pageSize,
      query: debouncedQuery.trim() || null,
      dateFrom: dateFrom || null,
      dateTo: dateTo || null,
    }).then((res) => { setMeetings(res.items); setTotalMeetings(res.total); })
      .catch((e) => console.warn("加载会议列表失败", e))
      .finally(() => setLoading(false));
  }, [page, pageSize, debouncedQuery, dateFrom, dateTo, refreshKey]);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(totalMeetings / pageSize)), [totalMeetings, pageSize]);
  const isAllSelected = useMemo(() => meetings.length > 0 && meetings.every((m) => selectedIds.has(m.id)), [meetings, selectedIds]);
  const isIndeterminate = useMemo(() => !isAllSelected && meetings.some((m) => selectedIds.has(m.id)), [isAllSelected, meetings]);

  useEffect(() => { if (selectAllRef.current) selectAllRef.current.indeterminate = isIndeterminate; }, [isIndeterminate]);
  useEffect(() => { setSelectedIds(new Set()); setIsManageMode(false); }, [page, searchQuery, dateFrom, dateTo]);

  const handlePin = async (id: string, pinned: boolean) => {
    try { await invoke("toggle_pin_meeting", { id, pinned: !pinned }); refresh(); }
    catch (e) { showToast(toUserError(ERRORS.TOGGLE_PIN, e), "error"); }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await invoke("delete_meeting", { id: deleteTarget.id, deleteAudio: deleteAudio });
      setDeleteTarget(null); setSelectedIds(new Set()); setDeleteAudio(false); refresh();
    }
    catch (e) { showToast(toUserError(ERRORS.DELETE_MEETING, e), "error"); }
  };

  const handleBatchDelete = async () => {
    try {
      await invoke("delete_meetings", { ids: Array.from(selectedIds), deleteAudio: batchDeleteAudio });
      setShowBatchDelete(false); setSelectedIds(new Set()); setIsManageMode(false); setBatchDeleteAudio(false); refresh();
    }
    catch (e) { showToast(toUserError(ERRORS.DELETE_MEETING, e), "error"); }
  };

  const handleToggleSelect = (id: string) => setSelectedIds((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const handleSelectAll = () => { const n = new Set(selectedIds); for (const m of meetings) { if (isAllSelected) n.delete(m.id); else n.add(m.id); } setSelectedIds(n); };

  return (
    <div className="flex-1 flex flex-col overflow-hidden min-w-0">
      {/* Header */}
      <div className="px-8 py-4 bg-white min-w-0">
        <p className="text-xs font-medium text-gray-400 uppercase tracking-wider pointer-events-none">搜索与浏览</p>
        <div className="flex items-center gap-3 mt-1">
          <h2 className="text-2xl font-semibold text-gray-900 flex-shrink-0">会议记录</h2>
          <button onClick={() => { setIsManageMode((v) => !v); setSelectedIds(new Set()); }}
            className={`ml-2 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors flex-shrink-0 ${isManageMode ? "bg-brand-100 text-brand-700" : "text-gray-500 hover:bg-gray-100"}`}>
            管理
          </button>
          <div className="flex-1 relative min-w-0">
            <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} aria-label="搜索会议"
              placeholder="搜索标题或内容..."
              className="w-full pl-9 pr-4 py-2 rounded-lg border border-gray-200 bg-gray-50 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-300 focus:border-brand-400 focus:bg-white transition-colors" />
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            {searchQuery && <button onClick={() => setSearchQuery("")} aria-label="清除搜索" className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-gray-400 hover:text-gray-600"><X size={14} /></button>}
          </div>
          <DateField value={dateFrom} onChange={setDateFrom} label="开始日期" />
          <span className="text-xs text-gray-400 flex-shrink-0">至</span>
          <DateField value={dateTo} onChange={setDateTo} label="结束日期" />
          {(dateFrom || dateTo) && <button onClick={() => { setDateFrom(""); setDateTo(""); }} className="text-xs text-gray-400 hover:text-gray-600 flex-shrink-0">清除</button>}
        </div>
      </div>

      {/* Manage bar */}
      {isManageMode && (
        <div className="flex items-center gap-3 px-8 py-2 bg-gray-50/50">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input type="checkbox" ref={selectAllRef} checked={isAllSelected} onChange={handleSelectAll}
              className="w-4 h-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500" />
            <span className="text-xs font-medium text-gray-500">全选</span>
          </label>
          {selectedIds.size > 0 && (
            <>
              <span className="text-xs text-gray-300">|</span>
              <span className="text-xs font-medium text-brand-600 pointer-events-none">已选择 {selectedIds.size} 项</span>
              <button onClick={() => setShowBatchDelete(true)} disabled={isBusy}
                className="ml-2 px-3 py-1 text-xs font-medium text-white bg-red-500 rounded-md hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                <Trash2 size={12} className="inline mr-1" />删除 {selectedIds.size}
              </button>
            </>
          )}
          <button onClick={() => { setSelectedIds(new Set()); setIsManageMode(false); }}
            className="px-3 py-1 text-xs font-medium text-gray-500 hover:text-gray-700 transition-colors">退出管理</button>
        </div>
      )}

      {/* List */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-8 py-4 min-w-0">
        {loading && meetings.length === 0 && (
          <div className="text-center py-16">
            <div className="w-10 h-10 rounded-2xl bg-gray-100 flex items-center justify-center mx-auto mb-4 animate-spin">
              <Loader2 size={20} className="text-gray-300" />
            </div>
            <p className="text-sm text-gray-400">加载中...</p>
          </div>
        )}
        {!loading && meetings.length === 0 && (
          <div className="text-center py-16">
            <div className="w-14 h-14 rounded-2xl bg-gray-100 flex items-center justify-center mx-auto mb-4">
              <FileText size={26} className="text-gray-300" />
            </div>
            <p className="text-sm text-gray-400 pointer-events-none">{searchQuery ? "未找到匹配的会议" : "暂无会议记录"}</p>
          </div>
        )}
        <div className="space-y-2" role="list">
          {meetings.map((m) => (
            <div key={m.id} role="listitem" className={`flex items-center gap-4 px-5 py-4 rounded-xl bg-white border border-gray-100 shadow-sm transition-all ${isManageMode ? "" : "hover:shadow-md hover:border-brand-200 group"}`}>
              {isManageMode && (
                <input type="checkbox" checked={selectedIds.has(m.id)} onChange={() => handleToggleSelect(m.id)} onClick={(e) => e.stopPropagation()}
                  className="w-4 h-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500 flex-shrink-0" />
              )}
              <button onClick={() => isManageMode ? null : onSelectMeeting(m.id)} onKeyDown={(e) => e.key === "Enter" && !isManageMode && onSelectMeeting(m.id)} className="flex-1 text-left min-w-0" disabled={isManageMode}>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-gray-900 truncate">{m.title}</p>
                  {m.pinned && <span className="text-[10px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded font-medium flex-shrink-0">已置顶</span>}
                </div>
                <div className="flex items-center gap-3 mt-1">
                  <p className="text-xs text-gray-400 flex-shrink-0">{m.created_at.slice(0, 10)}</p>
                  {m.first_line && <p className="text-xs text-gray-400 truncate">{m.first_line}</p>}
                </div>
              </button>
              {!isManageMode && (
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => handlePin(m.id, m.pinned)}
                    className={`p-1.5 rounded-lg transition-colors ${m.pinned ? "text-amber-500 bg-amber-50" : "text-gray-300 hover:text-amber-500 hover:bg-amber-50"}`} aria-label={m.pinned ? "取消置顶" : "置顶"}>
                    <Pin size={14} className={m.pinned ? "fill-current" : ""} />
                  </button>
                  <button onClick={() => setDeleteTarget(m)}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all" aria-label="删除会议">
                    <X size={15} />
                  </button>
                  <ChevronRight size={16} className="text-gray-300" />
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Pagination */}
        {meetings.length > 0 && (
          <div className="flex items-center justify-center gap-1.5 mt-6 pb-2">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} aria-label="上一页"
              className="px-3 py-2 text-sm font-medium text-gray-500 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">上一页</button>
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter((p) => { if (totalPages <= 7) return true; if (p === 1 || p === totalPages) return true; return Math.abs(p - page) <= 1; })
              .reduce<(number | "...")[]>((acc, p, idx, arr) => { if (idx > 0) { const prev = arr[idx - 1]; if (p - prev > 1) acc.push("..."); } acc.push(p); return acc; }, [])
              .map((item, i) => item === "..." ? <span key={`dots-${i}`} className="px-2 text-gray-400 text-sm">...</span>
                : <button key={item} onClick={() => setPage(item)} aria-current={item === page ? "page" : undefined} className={`w-9 h-9 text-sm font-medium rounded-lg transition-colors ${item === page ? "bg-brand-600 text-white" : "text-gray-600 bg-white border border-gray-200 hover:bg-gray-50"}`}>{item}</button>)}
            <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} aria-label="下一页"
              className="px-3 py-2 text-sm font-medium text-gray-500 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">下一页</button>
            <span className="text-xs text-gray-400 ml-3">共 {totalMeetings} 条</span>
            <select value={pageSize} onChange={(e) => setPageSize(parseInt(e.target.value))} aria-label="每页条数"
              className="ml-2 px-2 py-1 text-xs border border-gray-200 rounded-md bg-white text-gray-600 focus:outline-none focus:ring-1 focus:ring-brand-300">
              {PAGE_SIZE_OPTIONS.map((s) => (
                <option key={s} value={s}>{s} 条/页</option>
              ))}
            </select>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        icon={<X size={24} className="text-red-500" />}
        title="删除会议"
        description={`确定要删除此会议吗？此操作不可撤销。\n"${deleteTarget?.title}"`}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      >
        <label className="flex items-center gap-2 cursor-pointer select-none text-left">
          <input type="checkbox" checked={deleteAudio} onChange={(e) => setDeleteAudio(e.target.checked)}
            className="w-4 h-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500" />
          <span className="text-xs text-gray-500">同时删除录音文件（wav，无法恢复）</span>
        </label>
      </ConfirmDialog>

      <ConfirmDialog
        open={showBatchDelete}
        icon={<Trash2 size={24} className="text-red-500" />}
        title="批量删除会议"
        description={`确定要删除选中的 ${selectedIds.size} 个会议吗？此操作不可撤销。`}
        onConfirm={handleBatchDelete}
        onCancel={() => setShowBatchDelete(false)}
      >
        <label className="flex items-center gap-2 cursor-pointer select-none text-left">
          <input type="checkbox" checked={batchDeleteAudio} onChange={(e) => setBatchDeleteAudio(e.target.checked)}
            className="w-4 h-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500" />
          <span className="text-xs text-gray-500">同时删除录音文件（wav，无法恢复）</span>
        </label>
      </ConfirmDialog>
    </div>
  );
}

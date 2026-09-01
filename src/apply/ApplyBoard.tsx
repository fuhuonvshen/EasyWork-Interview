// EasyWork - 投递工作台（替代 iframe 内嵌投递页）
// 两个 tab：
//   公司库 —— 内置 100 家常见公司 + 用户自定义（名称/业务类型/招聘网站），点开即投递
//   投递记录 —— 投递进度管理 + 与 OfferSubmit 扩展双向同步
// 数据链路：Rust 命令读写 apply_records / companies 表；扩展经 Python sidecar
// 本地服务拉取/回写同一张表。
import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ArrowLeft, RefreshCw, Plus, ExternalLink, Rocket, Trash2, Pencil,
  Loader, Puzzle, Copy, Check, X, Building2, Send,
} from "lucide-react";
import { showToast } from "../components/Toast";
import ApplyRecordModal from "./ApplyRecordModal";
import CompanyModal from "./CompanyModal";
import {
  APPLY_STATUS_COLORS, APPLY_STATUS_LABELS,
  type ApplyRecord, type ApplyStatus, type Company,
} from "../types";

const ALL_STATUSES = Object.keys(APPLY_STATUS_LABELS) as ApplyStatus[];

type Tab = "companies" | "records";

export default function ApplyBoard({ onBack }: { onBack: () => void }) {
  const [tab, setTab] = useState<Tab>("companies");

  // 投递记录
  const [records, setRecords] = useState<ApplyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<ApplyStatus | "all">("all");
  const [keyword, setKeyword] = useState("");
  const [recordModal, setRecordModal] = useState<{
    open: boolean;
    initial: ApplyRecord | null;
    prefill: { company: string; url: string; site?: string } | null;
  }>({ open: false, initial: null, prefill: null });

  // 公司库
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companiesLoading, setCompaniesLoading] = useState(true);
  const [companyKeyword, setCompanyKeyword] = useState("");
  const [industryFilter, setIndustryFilter] = useState("all");
  const [companyModal, setCompanyModal] = useState<{ open: boolean; initial: Company | null }>({ open: false, initial: null });

  // 扩展引导状态
  const [ext, setExt] = useState<{ path: string; browser: string } | null>(null);
  const [extLoading, setExtLoading] = useState(true);
  const [extError, setExtError] = useState("");
  const [copied, setCopied] = useState(false);
  const [extDismissed, setExtDismissed] = useState(false);

  const reload = useCallback(async () => {
    try {
      const list = await invoke<ApplyRecord[]>("apply_list_records");
      setRecords(list);
    } catch (e) {
      showToast(`加载投递记录失败: ${e}`, "error");
    } finally {
      setLoading(false);
    }
  }, []);

  const reloadCompanies = useCallback(async () => {
    try {
      const list = await invoke<Company[]>("company_list");
      setCompanies(list);
    } catch (e) {
      showToast(`加载公司列表失败: ${e}`, "error");
    } finally {
      setCompaniesLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
    reloadCompanies();
  }, [reload, reloadCompanies]);

  // 进入页面即准备扩展（幂等：已解压则直接返回路径）
  useEffect(() => {
    (async () => {
      try {
        const info = await invoke<{ path: string; copied: boolean; browser: string }>("prepare_extension");
        setExt({ path: info.path, browser: info.browser });
      } catch (e) {
        setExtError(String(e));
      } finally {
        setExtLoading(false);
      }
    })();
  }, []);

  // ── 投递记录操作 ──

  const saveRecord = async (rec: {
    company: string; position: string; url: string; site: string;
    status: ApplyStatus; notes: string;
  }) => {
    try {
      if (recordModal.initial) {
        await invoke("apply_update_record", {
          id: recordModal.initial.id,
          company: rec.company, position: rec.position, url: rec.url,
          site: rec.site, status: rec.status, notes: rec.notes,
        });
        showToast("已更新", "success");
      } else {
        await invoke("apply_add_record", {
          company: rec.company, position: rec.position, url: rec.url,
          site: rec.site, status: rec.status, notes: rec.notes,
        });
        showToast("已添加", "success");
      }
      setRecordModal({ open: false, initial: null, prefill: null });
      reload();
    } catch (e) {
      showToast(`保存失败: ${e}`, "error");
    }
  };

  const updateStatus = async (rec: ApplyRecord, status: ApplyStatus) => {
    const prev = records;
    setRecords((rs) => rs.map((r) => (r.id === rec.id ? { ...r, status } : r)));
    try {
      await invoke("apply_update_record", { id: rec.id, status });
    } catch (e) {
      setRecords(prev);
      showToast(`更新失败: ${e}`, "error");
    }
  };

  const removeRecord = async (rec: ApplyRecord) => {
    if (!window.confirm(`删除「${rec.company}」的投递记录？`)) return;
    try {
      await invoke("apply_delete_record", { id: rec.id });
      showToast("已删除", "success");
      reload();
    } catch (e) {
      showToast(`删除失败: ${e}`, "error");
    }
  };

  // ── 公司库操作 ──

  const saveCompany = async (c: { name: string; industry: string; url: string }) => {
    try {
      if (companyModal.initial) {
        await invoke("company_update", {
          id: companyModal.initial.id,
          name: c.name, industry: c.industry, url: c.url,
        });
        showToast("已更新", "success");
      } else {
        await invoke("company_add", { name: c.name, industry: c.industry, url: c.url });
        showToast("已添加", "success");
      }
      setCompanyModal({ open: false, initial: null });
      reloadCompanies();
    } catch (e) {
      showToast(`保存失败: ${e}`, "error");
    }
  };

  const removeCompany = async (c: Company) => {
    if (!window.confirm(`删除「${c.name}」？`)) return;
    try {
      await invoke("company_delete", { id: c.id });
      showToast("已删除", "success");
      reloadCompanies();
    } catch (e) {
      showToast(`删除失败: ${e}`, "error");
    }
  };

  // 从公司库发起投递：浏览器打开招聘网站 + 预填投递记录弹窗
  const goApply = async (c: Company) => {
    if (c.url) openUrl(c.url);
    setRecordModal({
      open: true,
      initial: null,
      prefill: { company: c.name, url: c.url, site: deriveSite(c.url) },
    });
  };

  const openUrl = async (url: string) => {
    if (!url) return;
    try {
      await invoke("open_external_url", { url });
    } catch {
      window.open(url, "_blank");
    }
  };

  const copyPath = async () => {
    if (!ext) return;
    try {
      await navigator.clipboard.writeText(ext.path);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      showToast("复制失败，请手动选择复制路径", "error");
    }
  };

  const openBrowserExtensions = async (which: "chrome" | "edge") => {
    try {
      await invoke("open_external_url", { url: which === "chrome" ? "chrome://extensions" : "edge://extensions" });
    } catch {
      showToast("打开浏览器失败，请手动打开浏览器扩展页面", "error");
    }
  };

  const deriveSite = (u: string) => {
    try {
      const h = new URL(u.startsWith("http") ? u : `https://${u}`).hostname;
      return h.startsWith("www.") ? h.slice(4) : h;
    } catch {
      return "";
    }
  };

  // ── 展示计算 ──

  const kw = keyword.trim().toLowerCase();
  const filtered = records.filter((r) => {
    if (filter !== "all" && r.status !== filter) return false;
    if (kw && !(`${r.company} ${r.position}`.toLowerCase().includes(kw))) return false;
    return true;
  });

  const ckw = companyKeyword.trim().toLowerCase();
  const industries = [...new Set(companies.map((c) => c.industry).filter(Boolean))].sort();
  const filteredCompanies = companies.filter((c) => {
    if (industryFilter !== "all" && c.industry !== industryFilter) return false;
    if (ckw && !`${c.name} ${c.industry}`.toLowerCase().includes(ckw)) return false;
    return true;
  });

  const countBy = (s: ApplyStatus) => records.filter((r) => r.status === s).length;
  const chips: Array<{ key: ApplyStatus | "all"; label: string; count: number }> = [
    { key: "all", label: "全部", count: records.length },
    ...ALL_STATUSES.map((s) => ({ key: s, label: APPLY_STATUS_LABELS[s], count: countBy(s) })),
  ];

  const fmtTime = (ms: number) => (ms ? new Date(ms).toLocaleDateString("zh-CN") : "—");

  return (
    <div className="h-full flex flex-col bg-white rounded-lg overflow-hidden">
      {/* 工具栏 */}
      <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-3 flex-shrink-0">
        <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
          <ArrowLeft size={18} />
        </button>
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Rocket size={16} className="text-brand-600 flex-shrink-0" />
          <span className="text-sm font-medium text-gray-700">投递工作台</span>
          <span className="text-[10px] text-gray-400">公司投递 + OfferSubmit 扩展同步</span>
        </div>
        <button
          onClick={() => { setLoading(true); setCompaniesLoading(true); reload(); reloadCompanies(); }}
          className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors" title="刷新"
        >
          <RefreshCw size={15} />
        </button>
        {tab === "records" && (
          <button
            onClick={() => setRecordModal({ open: true, initial: null, prefill: null })}
            className="px-3 py-1.5 text-xs font-medium text-brand-600 bg-brand-50 rounded-lg hover:bg-brand-100 transition-colors flex items-center gap-1"
          >
            <Plus size={13} /> 新增记录
          </button>
        )}
        {tab === "companies" && (
          <button
            onClick={() => setCompanyModal({ open: true, initial: null })}
            className="px-3 py-1.5 text-xs font-medium text-brand-600 bg-brand-50 rounded-lg hover:bg-brand-100 transition-colors flex items-center gap-1"
          >
            <Plus size={13} /> 新增公司
          </button>
        )}
      </div>

      {/* tab 切换 */}
      <div className="px-5 pt-3 flex items-center gap-1 flex-shrink-0">
        {([
          { key: "companies", label: "公司库", icon: Building2 },
          { key: "records", label: "投递记录", icon: Send },
        ] as Array<{ key: Tab; label: string; icon: typeof Building2 }>).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              tab === t.key ? "bg-brand-600 text-white" : "text-gray-500 hover:bg-gray-100"
            }`}
          >
            <t.icon size={13} /> {t.label}
            {t.key === "companies" && (
              <span className={`text-[10px] px-1.5 rounded-full ${tab === t.key ? "bg-white/20" : "bg-gray-100 text-gray-400"}`}>
                {companies.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* 扩展引导卡（一次性，可关闭） */}
      {!extDismissed && (
        <div className="mx-5 mt-3 rounded-xl border border-amber-200 bg-amber-50/80 p-3.5 flex-shrink-0">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center flex-shrink-0">
              <Puzzle size={16} className="text-amber-600" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-xs font-semibold text-gray-800">安装浏览器扩展（一键填充招聘网站）</p>
                {!extLoading && ext && (
                  <span className="px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 bg-emerald-100 rounded-full">已就绪</span>
                )}
              </div>
              {extLoading && <p className="mt-1 text-[11px] text-gray-400">正在准备扩展文件…</p>}
              {extError && <p className="mt-1 text-[11px] text-red-500">{extError}</p>}
              {ext && !extError && (
                <>
                  <div className="mt-2 flex items-center gap-2 flex-wrap">
                    <code className="px-2 py-1 text-[11px] text-gray-600 bg-white border border-amber-200 rounded-md truncate max-w-[420px]">
                      {ext.path}
                    </code>
                    <button onClick={copyPath} className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
                      {copied ? <Check size={11} className="text-emerald-600" /> : <Copy size={11} />}
                      {copied ? "已复制" : "复制路径"}
                    </button>
                  </div>
                  <ol className="mt-2 text-[11px] text-gray-500 space-y-0.5 list-decimal list-inside">
                    <li>点击下方按钮打开浏览器扩展页面</li>
                    <li>开启右上角「开发者模式」</li>
                    <li>点「加载已解压的扩展程序」，选择上面的路径（{ext.browser === "chrome" ? "检测到 Chrome" : ext.browser === "edge" ? "检测到 Edge" : "浏览器"}）</li>
                  </ol>
                  <div className="mt-2 flex gap-2">
                    <button onClick={() => openBrowserExtensions("chrome")} className="px-2.5 py-1 text-[10px] font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700 transition-colors">
                      打开 Chrome 扩展页
                    </button>
                    <button onClick={() => openBrowserExtensions("edge")} className="px-2.5 py-1 text-[10px] font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
                      打开 Edge 扩展页
                    </button>
                  </div>
                </>
              )}
            </div>
            <button
              onClick={() => setExtDismissed(true)}
              className="p-1 rounded text-gray-300 hover:text-gray-500 transition-colors flex-shrink-0"
              title="关闭（扩展已装好时可关掉）"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {tab === "companies" && (
        <div className="flex-1 min-h-0 flex flex-col">
          {/* 搜索 + 行业筛选 */}
          <div className="px-5 pt-3 flex items-center gap-2 flex-wrap flex-shrink-0">
            <button
              onClick={() => setIndustryFilter("all")}
              className={`px-3 py-1 rounded-full text-[11px] font-medium transition-colors ${
                industryFilter === "all" ? "bg-brand-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              全部 {companies.length}
            </button>
            {industries.map((ind) => (
              <button
                key={ind}
                onClick={() => setIndustryFilter(ind)}
                className={`px-3 py-1 rounded-full text-[11px] font-medium transition-colors ${
                  industryFilter === ind ? "bg-brand-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {ind} {companies.filter((c) => c.industry === ind).length}
              </button>
            ))}
            <input
              value={companyKeyword}
              onChange={(e) => setCompanyKeyword(e.target.value)}
              placeholder="搜索公司"
              className="ml-auto w-40 px-3 py-1.5 text-xs text-gray-700 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-300 placeholder-gray-300"
            />
          </div>

          {/* 公司卡片网格 */}
          <div className="flex-1 min-h-0 overflow-y-auto px-5 py-3">
            {companiesLoading && (
              <div className="flex items-center justify-center py-10 text-gray-400 text-sm gap-2">
                <Loader size={14} className="animate-spin" /> 加载中…
              </div>
            )}
            {!companiesLoading && filteredCompanies.length === 0 && (
              <div className="flex flex-col items-center justify-center py-14 gap-2 text-center px-8">
                <Building2 size={28} className="text-gray-300" />
                <p className="text-sm font-medium text-gray-700">
                  {companies.length === 0 ? "公司库还是空的" : "没有符合条件的公司"}
                </p>
                <p className="text-xs text-gray-400 max-w-sm">
                  {companies.length === 0
                    ? "点击右上角「新增公司」录入名称、业务类型和招聘网站；内置了 100 家常见公司可先删除不需要的。"
                    : "试试调整筛选或搜索关键词"}
                </p>
              </div>
            )}
            <div className="grid grid-cols-2 xl:grid-cols-3 gap-2.5">
              {filteredCompanies.map((c) => (
                <div key={c.id} className="group rounded-xl border border-gray-100 bg-white p-3.5 shadow-sm hover:border-brand-100 hover:shadow transition-all">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold text-gray-800 truncate">{c.name}</p>
                    <span className="flex items-center gap-1 flex-shrink-0">
                      {c.builtin && <span className="px-1.5 py-0.5 text-[9px] text-gray-400 bg-gray-100 rounded">内置</span>}
                      <button
                        onClick={() => removeCompany(c)}
                        className="p-1 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100"
                        title="删除公司"
                      >
                        <Trash2 size={12} />
                      </button>
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                    {c.industry && (
                      <span className="px-1.5 py-0.5 text-[10px] bg-brand-50 text-brand-600 rounded">{c.industry}</span>
                    )}
                    {c.url ? (
                      <button
                        onClick={() => openUrl(c.url)}
                        className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-brand-600 hover:underline truncate max-w-[200px]"
                        title={c.url}
                      >
                        <ExternalLink size={10} /> {c.url.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                      </button>
                    ) : (
                      <span className="text-[10px] text-gray-300">未填网址</span>
                    )}
                  </div>
                  <div className="mt-2.5 flex items-center gap-1.5">
                    <button
                      onClick={() => goApply(c)}
                      className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-[11px] font-semibold text-white bg-brand-600 rounded-lg hover:bg-brand-700 transition-colors"
                      title="浏览器打开招聘网站并新建投递记录"
                    >
                      <Send size={11} /> 去投递
                    </button>
                    <button
                      onClick={() => setCompanyModal({ open: true, initial: c })}
                      className="p-1.5 rounded-lg text-gray-300 hover:text-brand-600 hover:bg-brand-50 transition-colors"
                      title="编辑公司"
                    >
                      <Pencil size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === "records" && (
        <>
          {/* 状态统计 + 筛选 */}
          <div className="px-5 pt-3 flex items-center gap-2 flex-wrap flex-shrink-0">
            {chips.map((c) => (
              <button
                key={c.key}
                onClick={() => setFilter(c.key)}
                className={`px-3 py-1 rounded-full text-[11px] font-medium transition-colors ${
                  filter === c.key
                    ? "bg-brand-600 text-white"
                    : c.key === "all"
                      ? "bg-gray-100 text-gray-600 hover:bg-gray-200"
                      : `${APPLY_STATUS_COLORS[c.key as ApplyStatus]} hover:opacity-80`
                }`}
              >
                {c.label} {c.count}
              </button>
            ))}
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索公司 / 岗位"
              className="ml-auto w-44 px-3 py-1.5 text-xs text-gray-700 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-300 placeholder-gray-300"
            />
          </div>

          {/* 记录列表 */}
          <div className="flex-1 min-h-0 overflow-y-auto px-5 py-3 space-y-2">
            {loading && (
              <div className="flex items-center justify-center py-10 text-gray-400 text-sm gap-2">
                <Loader size={14} className="animate-spin" /> 加载中…
              </div>
            )}
            {!loading && filtered.length === 0 && (
              <div className="flex flex-col items-center justify-center py-14 gap-3 text-center px-8">
                <div className="w-14 h-14 rounded-2xl bg-brand-50 flex items-center justify-center">
                  <Rocket size={26} className="text-brand-400" />
                </div>
                <p className="text-sm font-medium text-gray-700">
                  {records.length === 0 ? "还没有投递记录" : "没有符合条件的记录"}
                </p>
                <p className="text-xs text-gray-400 max-w-sm">
                  {records.length === 0
                    ? "去「公司库」选一家公司点「去投递」，或点击右上角「新增记录」；在浏览器投递后 OfferSubmit 扩展会自动回写状态。"
                    : "试试调整筛选条件或搜索关键词"}
                </p>
              </div>
            )}
            {filtered.map((rec) => (
              <div key={rec.id} className="group rounded-xl border border-gray-100 bg-white p-3.5 shadow-sm hover:border-brand-100 hover:shadow transition-all">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-gray-800 truncate">{rec.company}</span>
                      {rec.position && (
                        <span className="text-xs text-gray-400 truncate">{rec.position}</span>
                      )}
                    </div>
                    <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                      {rec.site && (
                        <span className="px-1.5 py-0.5 text-[10px] bg-gray-100 text-gray-500 rounded">
                          {rec.site}
                        </span>
                      )}
                      {rec.url ? (
                        <button
                          onClick={() => openUrl(rec.url)}
                          className="flex items-center gap-1 text-[11px] text-brand-600 hover:text-brand-700 hover:underline max-w-[320px] truncate"
                          title={rec.url}
                        >
                          <ExternalLink size={11} /> {rec.url.replace(/^https?:\/\//, "")}
                        </button>
                      ) : (
                        <span className="text-[11px] text-gray-300">未填网址</span>
                      )}
                      <span className="text-[11px] text-gray-300">投递于 {fmtTime(rec.applied_at)}</span>
                    </div>
                    {rec.notes && <p className="mt-1.5 text-[11px] text-gray-400 line-clamp-2">{rec.notes}</p>}
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <select
                      value={rec.status}
                      onChange={(e) => updateStatus(rec, e.target.value as ApplyStatus)}
                      className={`px-2 py-1 text-[11px] font-medium rounded-lg border-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-amber-300 ${APPLY_STATUS_COLORS[rec.status]}`}
                    >
                      {ALL_STATUSES.map((s) => (
                        <option key={s} value={s}>{APPLY_STATUS_LABELS[s]}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => setRecordModal({ open: true, initial: rec, prefill: null })}
                      className="p-1.5 rounded-lg text-gray-300 hover:text-brand-600 hover:bg-brand-50 transition-colors opacity-0 group-hover:opacity-100"
                      title="编辑"
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      onClick={() => removeRecord(rec)}
                      className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100"
                      title="删除"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* 底部提示 */}
          <p className="px-5 py-2 text-[11px] text-gray-400 border-t border-gray-50 flex-shrink-0">
            安装 OfferSubmit 扩展后，在扩展「投递记录」页点『从 EasyWork 同步』即可拉取简历模板并双向同步投递状态 · 点击网址用浏览器打开招聘网站投递
          </p>
        </>
      )}

      {recordModal.open && (
        <ApplyRecordModal
          initial={recordModal.initial}
          prefill={recordModal.prefill}
          onSave={saveRecord}
          onClose={() => setRecordModal({ open: false, initial: null, prefill: null })}
        />
      )}
      {companyModal.open && (
        <CompanyModal
          initial={companyModal.initial}
          onSave={saveCompany}
          onClose={() => setCompanyModal({ open: false, initial: null })}
        />
      )}
    </div>
  );
}

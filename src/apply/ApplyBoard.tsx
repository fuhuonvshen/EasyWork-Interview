// EasyWork - 投递工作台（替代 iframe 内嵌投递页）
// 两个 tab：公司库（飞书共享表格只读镜像，以在线表格为准） / 投递记录（进度管理 + 扩展双向同步）
import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ArrowLeft, RefreshCw, Plus, Rocket, Trash2, Pencil,
  Loader, Puzzle, Copy, Check, X, Send, Link2,
} from "lucide-react";
import { showToast } from "../components/Toast";
import FtueTour from "../components/FtueTour";
import ApplyRecordModal from "./ApplyRecordModal";
import CompanyModal from "./CompanyModal";
import {
  APPLY_STATUS_COLORS, APPLY_STATUS_LABELS,
  type ApplyRecord, type ApplyStatus, type Company,
} from "../types";

const ALL_STATUSES = Object.keys(APPLY_STATUS_LABELS) as ApplyStatus[];

type Tab = "companies" | "records";

/** 网址显示：仅 hostname（保持紧凑） */
function urlDisplay(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.slice(0, 30);
  }
}

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

  // 公司库（云端共享，仅可新增）
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companiesLoading, setCompaniesLoading] = useState(true);
  const [companyKeyword, setCompanyKeyword] = useState("");
  const [industryFilter, setIndustryFilter] = useState("all");
  const [companyModal, setCompanyModal] = useState<{ open: boolean }>({ open: false });
  const [feishuSyncing, setFeishuSyncing] = useState(false);

  // 扩展引导状态
  const [ext, setExt] = useState<{ path: string; browser: string } | null>(null);
  const [extLoading, setExtLoading] = useState(true);
  const [extError, setExtError] = useState("");
  const [copied, setCopied] = useState(false);
  const [extDismissed, setExtDismissed] = useState(false);
  const [dismissModal, setDismissModal] = useState(false);
  const [neverAsk, setNeverAsk] = useState(false);

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

  // 进入页面：读取"不再提示扩展安装"设置；未关闭则准备扩展（幂等）
  useEffect(() => {
    (async () => {
      try {
        const settings = await invoke<Record<string, string>>("get_settings");
        if (settings["apply_ext_guide_dismissed"] === "1") {
          setExtDismissed(true);
          setExtLoading(false);
          return;
        }
        const info = await invoke<{ path: string; copied: boolean; browser: string }>("prepare_extension");
        setExt({ path: info.path, browser: info.browser });
      } catch (e) {
        setExtError(String(e));
      } finally {
        setExtLoading(false);
      }
    })();
  }, []);

  // 确认关闭引导卡（可选"下次不再提示"并持久化）
  const confirmDismiss = async () => {
    if (neverAsk) {
      try {
        await invoke("update_setting", { key: "apply_ext_guide_dismissed", value: "1" });
      } catch {
        /* 设置保存失败不阻塞关闭 */
      }
    }
    setDismissModal(false);
    setExtDismissed(true);
  };

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

  // ── 公司库（云端共享：仅可新增，AI 校验后同步到共享库）──

  const saveCompany = async (c: { name: string; industry: string; url: string }) => {
    // 一次性后台校验（上下文仅含本条数据，不留历史）；LLM 不可用/异常时降级直接添加
    try {
      const r = await invoke<{ valid: boolean; reason: string }>("validate_company", {
        name: c.name, industry: c.industry, url: c.url,
      });
      if (!r.valid) {
        throw new Error(r.reason || "公司信息可能不准确，请修改后重试");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.startsWith("公司信息可能不准确")) throw e;
      // 其他（LLM 不可用/返回异常）：跳过校验
    }
    try {
      await invoke("company_add_shared", { name: c.name, industry: c.industry, url: c.url });
      showToast("已添加，同步后各设备可见", "success");
      setCompanyModal({ open: false });
      reloadCompanies();
    } catch (e) {
      throw new Error(`添加失败: ${e}`);
    }
  };

  const syncFeishu = async () => {
    setFeishuSyncing(true);
    try {
      const r = await invoke<{ count: number }>("feishu_sync_companies");
      showToast(`已同步，公司库共 ${r.count} 家`, "success");
      reloadCompanies();
    } catch (e) {
      showToast(`同步失败: ${e}`, "error");
    }
    setFeishuSyncing(false);
  };

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

  const deriveSite = (u: string) => {
    try {
      const h = new URL(u.startsWith("http") ? u : `https://${u}`).hostname;
      return h.startsWith("www.") ? h.slice(4) : h;
    } catch {
      return "";
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
      await invoke("open_extensions_page", { browser: which });
    } catch {
      showToast("打开浏览器失败，请手动打开浏览器扩展页面", "error");
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

  /** 网址单元格：可点击，仅显示 hostname；微信文章链接不显示（数据保留） */
  const UrlCell = ({ url }: { url: string }) => {
    if (!url) return <span className="text-gray-300">—</span>;
    if (url.includes("mp.weixin.qq.com")) return <span className="text-gray-300">—</span>;
    return (
      <button
        onClick={() => openUrl(url)}
        className="flex items-center gap-1.5 text-[11px] text-gray-500 hover:text-teal-600 hover:underline transition-colors max-w-[220px]"
        title={url}
      >
        <Link2 size={11} className="flex-shrink-0" />
        <span className="truncate">{urlDisplay(url)}</span>
      </button>
    );
  };

  return (
    <div className="h-full flex flex-col bg-white rounded-lg overflow-hidden">
      {/* 工具栏 */}
      <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-3 flex-shrink-0">
        <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
          <ArrowLeft size={18} />
        </button>
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Rocket size={16} className="text-teal-600 flex-shrink-0" />
          <span className="text-sm font-medium text-gray-700 flex-shrink-0">投递工作台</span>
          <div className="flex-1 min-w-0 overflow-hidden">
            <span className="block whitespace-nowrap animate-marquee text-[11px] text-teal-500/80">
              若未找到目标公司，可点击右侧“新增公司”手动补充，添加的招聘信息将同步至云端共享库，帮助大家都能找到心仪的offer。
            </span>
          </div>
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
            className="px-3 py-1.5 text-xs font-medium text-teal-600 bg-teal-50 rounded-lg hover:bg-teal-100 transition-colors flex items-center gap-1"
          >
            <Plus size={13} /> 新增记录
          </button>
        )}
        {tab === "companies" && (
          <>
            <button
              onClick={syncFeishu}
              disabled={feishuSyncing}
              data-ftue="apply-sync"
              className="px-3 py-1.5 text-xs font-medium text-teal-600 bg-teal-50 rounded-lg hover:bg-teal-100 transition-colors flex items-center gap-1 disabled:opacity-50"
              title="拉取最新的共享公司数据"
            >
              {feishuSyncing ? <Loader size={13} className="animate-spin" /> : <RefreshCw size={13} />}
              {feishuSyncing ? "同步中..." : "同步"}
            </button>
            <button
              onClick={() => setCompanyModal({ open: true })}
              data-ftue="apply-add"
              className="px-3 py-1.5 text-xs font-medium text-teal-600 bg-teal-50 rounded-lg hover:bg-teal-100 transition-colors flex items-center gap-1"
            >
              <Plus size={13} /> 新增公司
            </button>
          </>
        )}
      </div>

      {/* tab 切换 */}
      <div className="px-5 pt-3 flex items-center gap-1 flex-shrink-0">
        {([
          { key: "companies", label: "公司库" },
          { key: "records", label: "投递记录" },
        ] as Array<{ key: Tab; label: string }>).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              tab === t.key ? "bg-teal-600 text-white" : "text-gray-500 hover:bg-gray-100"
            }`}
          >
            {t.label}
            {t.key === "companies" && (
              <span className={`ml-1 text-[10px] px-1.5 rounded-full ${tab === t.key ? "bg-white/20" : "bg-gray-100 text-gray-400"}`}>
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
                    <li>点「加载已解压的扩展程序」，选择上面的路径</li>
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
              onClick={() => { setNeverAsk(false); setDismissModal(true); }}
              className="p-1 rounded text-gray-300 hover:text-gray-500 transition-colors flex-shrink-0"
              title="关闭提示"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* ── 公司库 ── */}
      {tab === "companies" && (
        <div className="flex-1 min-h-0 flex flex-col px-5 pt-3 pb-2">
          {/* 搜索 + 行业筛选 */}
          <div className="flex items-center gap-2 flex-wrap pb-2 flex-shrink-0">
            <button
              onClick={() => setIndustryFilter("all")}
              className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
                industryFilter === "all" ? "bg-teal-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              全部 {companies.length}
            </button>
            {industries.map((ind) => (
              <button
                key={ind}
                onClick={() => setIndustryFilter(ind)}
                className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
                  industryFilter === ind ? "bg-teal-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
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

          {/* 公司表格 */}
          <div className="flex-1 min-h-0 overflow-auto rounded-xl border border-gray-100">
            {companiesLoading ? (
              <div className="flex items-center justify-center py-10 text-gray-400 text-sm gap-2">
                <Loader size={14} className="animate-spin" /> 加载中…
              </div>
            ) : filteredCompanies.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-14 gap-2 text-center px-8">
                <p className="text-sm font-medium text-gray-700">{companies.length === 0 ? "公司库还是空的" : "没有符合条件的公司"}</p>
                <p className="text-xs text-gray-400">
                  {companies.length === 0 ? "点击右上角「新增公司」录入名称、业务类型和招聘网站" : "试试调整筛选或搜索关键词"}
                </p>
              </div>
            ) : (
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-gray-50/95 backdrop-blur z-10">
                  <tr className="text-[11px] text-gray-400">
                    <th className="px-4 py-2.5 font-medium w-[28%]">公司名称</th>
                    <th className="px-4 py-2.5 font-medium w-[16%]">业务类型</th>
                    <th className="px-4 py-2.5 font-medium">招聘网址</th>
                    <th className="px-4 py-2.5 font-medium text-right w-[24%]">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filteredCompanies.map((c) => (
                    <tr key={c.id} className="group hover:bg-gray-50/60 transition-colors">
                      <td className="px-4 py-2.5">
                        <span className="flex items-center gap-1.5">
                          <span className="font-semibold text-gray-800">{c.name}</span>
                          {c.builtin && <span className="text-[9px] text-gray-300">内置</span>}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        {c.industry ? (
                          <span className="px-1.5 py-0.5 text-[10px] bg-teal-50 text-teal-600 rounded">{c.industry}</span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5"><UrlCell url={c.url} /></td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => goApply(c)}
                            className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-white bg-teal-600 rounded-lg hover:bg-teal-700 transition-colors"
                            title="浏览器打开招聘链接并新建投递记录"
                          >
                            <Send size={11} /> 去投递
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ── 投递记录 ── */}
      <FtueTour
        storageKey="apply_guide_done"
        steps={[
          { target: '[data-ftue="apply-add"]', title: "云端共享公司库", desc: "找不到的公司点「新增公司」：AI 会校验公司名、行业与招聘网址是否准确，通过后同步给所有使用者。" },
          { target: '[data-ftue="apply-sync"]', title: "一键同步", desc: "点「同步」拉取最新的共享公司数据；「去投递」打开招聘网站并记录投递进度。" },
        ]}
      />

      {tab === "records" && (
        <div className="flex-1 min-h-0 flex flex-col px-5 pt-3 pb-2">
          {/* 状态筛选 */}
          <div className="flex items-center gap-2 flex-wrap pb-2 flex-shrink-0">
            {chips.map((c) => (
              <button
                key={c.key}
                onClick={() => setFilter(c.key)}
                className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
                  filter === c.key
                    ? "bg-teal-600 text-white"
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

          {/* 投递记录表格 */}
          <div className="flex-1 min-h-0 overflow-auto rounded-xl border border-gray-100">
            {loading ? (
              <div className="flex items-center justify-center py-10 text-gray-400 text-sm gap-2">
                <Loader size={14} className="animate-spin" /> 加载中…
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-14 gap-2 text-center px-8">
                <p className="text-sm font-medium text-gray-700">{records.length === 0 ? "还没有投递记录" : "没有符合条件的记录"}</p>
                <p className="text-xs text-gray-400">
                  {records.length === 0
                    ? "去「公司库」选一家公司点「去投递」，或点击右上角「新增记录」；浏览器投递后扩展会自动回写状态。"
                    : "试试调整筛选条件或搜索关键词"}
                </p>
              </div>
            ) : (
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-gray-50/95 backdrop-blur z-10">
                  <tr className="text-[11px] text-gray-400">
                    <th className="px-4 py-2.5 font-medium w-[26%]">公司 / 岗位</th>
                    <th className="px-4 py-2.5 font-medium">招聘网址</th>
                    <th className="px-4 py-2.5 font-medium w-[12%]">投递时间</th>
                    <th className="px-4 py-2.5 font-medium w-[13%]">状态</th>
                    <th className="px-4 py-2.5 font-medium text-right w-[13%]">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filtered.map((rec) => (
                    <tr key={rec.id} className="group hover:bg-gray-50/60 transition-colors">
                      <td className="px-4 py-2.5">
                        <span className="flex flex-col min-w-0">
                          <span className="font-semibold text-gray-800 truncate">{rec.company}</span>
                          {rec.position && <span className="text-[11px] text-gray-400 truncate">{rec.position}</span>}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="flex flex-col min-w-0 gap-1">
                          {rec.site && <span className="text-[10px] text-gray-300 w-fit">{rec.site}</span>}
                          <UrlCell url={rec.url} />
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-gray-500">{fmtTime(rec.applied_at)}</td>
                      <td className="px-4 py-2.5">
                        <select
                          value={rec.status}
                          onChange={(e) => updateStatus(rec, e.target.value as ApplyStatus)}
                          className={`px-2 py-1 text-[11px] font-medium rounded-lg border-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-amber-300 ${APPLY_STATUS_COLORS[rec.status]}`}
                        >
                          {ALL_STATUSES.map((s) => (
                            <option key={s} value={s}>{APPLY_STATUS_LABELS[s]}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => setRecordModal({ open: true, initial: rec, prefill: null })}
                            className="p-1.5 rounded-lg text-gray-300 hover:text-teal-600 hover:bg-teal-50 transition-colors opacity-0 group-hover:opacity-100"
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
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* 底部提示 */}
          <p className="pt-2 text-[11px] text-gray-400 flex-shrink-0">
            安装 OfferSubmit 扩展后，在扩展「投递记录」页点『从 EasyWork 同步』即可拉取简历模板并双向同步投递状态
          </p>
        </div>
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
          onSave={saveCompany}
          onClose={() => setCompanyModal({ open: false })}
        />
      )}

      {/* 关闭扩展引导确认弹窗 */}
      {dismissModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-2xl shadow-2xl p-6 mx-4 max-w-sm w-full animate-in zoom-in">
            <h2 className="text-base font-bold text-gray-900 mb-2">关闭扩展安装提示？</h2>
            <p className="text-xs text-gray-500 leading-relaxed mb-4">
              未安装扩展时，浏览器打开招聘网站后将无法一键自动填充表单，需要手动填写。
            </p>
            <label className="flex items-center gap-2 mb-5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={neverAsk}
                onChange={(e) => setNeverAsk(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 text-teal-600 focus:ring-teal-500"
              />
              <span className="text-xs text-gray-700">下次不再提示扩展安装</span>
            </label>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setDismissModal(false)}
                className="px-4 py-2 text-xs font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              >
                取消
              </button>
              <button
                onClick={confirmDismiss}
                className="px-4 py-2 text-xs font-semibold text-white bg-teal-600 rounded-lg hover:bg-teal-700 transition-colors"
              >
                关闭提示
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

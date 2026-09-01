// EasyWork - Today View (recording + transcript + minutes + 面试题目提取)
import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Mic, MicOff, Loader, Sparkles, X, FileAudio, BookOpen, Check } from "lucide-react";
import Markdown from "../../components/Markdown";
import Select from "../../components/Select";
import { ERRORS, toUserError } from "../../errors";
import ConfirmDialog from "../../components/ConfirmDialog";
import { showToast } from "../../components/Toast";
import type { AudioDevice, InterviewQuestion } from "../../types";

export default function TodayView({
  prefillTitle,
  scheduleId,
  onMeetingCreated,
  onRecordingChange,
  onGeneratingChange,
}: {
  prefillTitle: string;
  scheduleId: string | null;
  onMeetingCreated: () => void;
  onRecordingChange: (recording: boolean) => void;
  onGeneratingChange: (generating: boolean) => void;
}) {
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [selectedDevice, setSelectedDevice] = useState("");
  const [meetingLabel, setMeetingLabel] = useState(prefillTitle || "");
  const [recording, setRecording] = useState(false);

  useEffect(() => {
    if (prefillTitle) setMeetingLabel(prefillTitle);
  }, [prefillTitle]);

  const [generating, setGenerating] = useState(false);
  const [minutes, setMinutes] = useState<string | null>(null);
  const [currentMeetingId, setCurrentMeetingId] = useState<string | null>(null);
  const [showMinutes, setShowMinutes] = useState(false);
  const [carouselPage, setCarouselPage] = useState(0);
  // ── 面试题目提取：纪要弹窗中勾选入题库 ──
  const [questions, setQuestions] = useState<InterviewQuestion[]>([]);
  const [selectedQ, setSelectedQ] = useState<Set<string>>(new Set());
  const [addingQ, setAddingQ] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [liveTranscripts, setLiveTranscripts] = useState<{ speaker: string; text: string }[]>([]);
  const [showStopConfirm, setShowStopConfirm] = useState(false);
  const [meetingType, setMeetingType] = useState("其他");
  // ── 面试语义（Phase 1）：默认面试模式，可切换回会议模式 ──
  const [isInterview, setIsInterview] = useState(true);
  const [company, setCompany] = useState("");
  const [position, setPosition] = useState("");
  const [stage, setStage] = useState("one");
  const [elapsed, setElapsed] = useState(0);
  const dragStartXRef = useRef(0);
  const dragStartYRef = useRef(0);

  // 录制计时
  useEffect(() => {
    if (!recording) return;
    setElapsed(0);
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [recording]);

  const formatElapsed = (total: number) => {
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const mm = String(m).padStart(2, "0");
    const ss = String(s).padStart(2, "0");
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  };

  const handleDragStart = (clientX: number, clientY?: number) => {
    dragStartXRef.current = clientX;
    dragStartYRef.current = clientY ?? 0;
  };
  const handleDragEnd = (clientX: number, clientY?: number) => {
    const dx = clientX - dragStartXRef.current;
    const dy = (clientY ?? 0) - dragStartYRef.current;
    const pageCount = questions.length > 0 ? 3 : 2;
    // Only flip pages on a clearly horizontal swipe — vertical scrolling
    // must never trigger a page change.
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
      setCarouselPage((p) => Math.max(0, Math.min(pageCount - 1, dx > 0 ? p - 1 : p + 1)));
    }
  };

  const speakerColors = [
    { bg: "#E6EE9C", text: "#5A5F2E" }, { bg: "#FFECB3", text: "#5C4B00" },
    { bg: "#FFCDD2", text: "#7F2020" }, { bg: "#CE93D8", text: "#4A1A52" },
    { bg: "#FFAB91", text: "#7F3A1A" }, { bg: "#9E9E9E", text: "#1A1A1A" },
    { bg: "#9575CD", text: "#2E1A52" }, { bg: "#7986CB", text: "#1A2E52" },
    { bg: "#BBDEFB", text: "#1A3A5C" }, { bg: "#B2EBF2", text: "#1A4A4A" },
    { bg: "#80CBC4", text: "#1A3A36" }, { bg: "#A5D6A7", text: "#1A3A1A" },
    { bg: "#90A4AE", text: "#1A2A30" },
  ];
  const getSpeakerStyle = (speaker: string) => {
    if (speaker === "我") return { bg: "#DBEAFE", text: "#1D4ED8" };
    if (speaker === "发言人") return { bg: "#F3F4F6", text: "#4B5563" };
    const n = parseInt(speaker.replace("参会者_", ""), 10);
    if (isNaN(n)) return { bg: "#F3F4F6", text: "#4B5563" };
    return speakerColors[(n - 1) % speakerColors.length];
  };

  const loadDevices = useCallback(() => {
    invoke<AudioDevice[]>("list_devices")
      .then((list) => {
        setDevices((prev) => {
          const prevJson = JSON.stringify(prev);
          const nextJson = JSON.stringify(list);
          if (prevJson === nextJson) return prev;
          return list;
        });
        const def = list.find((d) => d.is_default);
        if (def) setSelectedDevice((prev) => prev || def.name);
        else if (list.length > 0) setSelectedDevice((prev) => prev || list[0].name);
      })
      .catch((e) => setError(toUserError(ERRORS.LIST_DEVICES, e)));
  }, []);

  useEffect(() => {
    loadDevices();
    const interval = setInterval(loadDevices, 10000);
    return () => clearInterval(interval);
  }, [loadDevices]);

  useEffect(() => {
    if (!recording) return;
    setLiveTranscripts([]);

    const poll = async () => {
      try {
        const chunks = await invoke<{ speaker: string; text: string }[]>("get_transcript_chunks");
        if (chunks.length > 0) {
          setLiveTranscripts((prev) => [...prev, ...chunks]);
        }
      } catch {}
    };

    poll();
    const interval = setInterval(poll, 1000);
    return () => clearInterval(interval);
  }, [recording]);

  const startRecording = useCallback(async () => {
    if (!selectedDevice) return;
    setError(null);
    setMinutes(null);
    try {
      await invoke("start_capture", {
        deviceName: selectedDevice,
        label: meetingLabel || "未命名会议",
      });
      setRecording(true);
      onRecordingChange(true);

      if ("Notification" in window && Notification.permission === "default") {
        Notification.requestPermission();
      }
      if ("Notification" in window && Notification.permission === "granted") {
        new Notification("EasyWork", { body: "录制已开始" });
      }
    } catch (e) {
      setError(toUserError(ERRORS.START_RECORDING, e));
    }
  }, [selectedDevice, meetingLabel, onRecordingChange]);

  const importAudio = useCallback(async () => {
    setError(null);
    setMinutes(null);
    try {
      const path = await invoke<string | null>("pick_audio_file");
      if (!path) return;

      setGenerating(true);
      onGeneratingChange(true);

      const raw = await invoke<string>("generate_minutes", {
        wavPath: path,
        meetingTitle: meetingLabel || (isInterview ? "导入的面试" : "导入的会议"),
        liveText: null,
        liveTranscriptJson: null,
        scheduleId: null,
        meetingType: meetingType,
        isInterview: isInterview,
        company: isInterview ? (company || null) : null,
        position: isInterview ? (position || null) : null,
        stage: isInterview ? (stage || null) : null,
      });
      let result: { meetingId: string; content: string; questions?: InterviewQuestion[] };
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed?.meetingId === "string" && typeof parsed?.content === "string") {
          result = parsed;
        } else {
          throw new Error(ERRORS.PARSE_MINUTES);
        }
      } catch (parseErr) {
        throw new Error(ERRORS.PARSE_MINUTES);
      }
      setCurrentMeetingId(result.meetingId);
      setMinutes(result.content);
      // 面试题目：默认全选
      const qs = Array.isArray(result.questions) ? (result.questions as InterviewQuestion[]) : [];
      setQuestions(qs);
      setSelectedQ(new Set(qs.map((q) => q.id)));
      setShowMinutes(true);
      setCarouselPage(0);
      setGenerating(false);
      onGeneratingChange(false);
      onMeetingCreated();
    } catch (e) {
      setError(toUserError(ERRORS.GENERATE_MINUTES, e));
      setGenerating(false);
      onGeneratingChange(false);
    }
  }, [meetingLabel, onMeetingCreated, onGeneratingChange, meetingType, isInterview, company, position, stage]);

  const handleStopClick = useCallback(() => {
    setShowStopConfirm(true);
  }, []);

  const stopRecording = useCallback(async () => {
    setShowStopConfirm(false);
    try {
      const liveText = liveTranscripts
        .map((item) => `[${item.speaker}] ${item.text}`)
        .join("\n");

      const path = await invoke<string>("stop_capture");
      setRecording(false);
      onRecordingChange(false);
      setGenerating(true);
      onGeneratingChange(true);

      const raw = await invoke<string>("generate_minutes", {
        wavPath: path,
        meetingTitle: meetingLabel || (isInterview ? "未命名面试" : "未命名会议"),
        liveText: liveText || null,
        liveTranscriptJson: JSON.stringify(liveTranscripts) || null,
        scheduleId: scheduleId || null,
        meetingType: meetingType,
        isInterview: isInterview,
        company: isInterview ? (company || null) : null,
        position: isInterview ? (position || null) : null,
        stage: isInterview ? (stage || null) : null,
      });
      let result: { meetingId: string; content: string; questions?: InterviewQuestion[] };
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed?.meetingId === "string" && typeof parsed?.content === "string") {
          result = parsed;
        } else {
          throw new Error(ERRORS.PARSE_MINUTES);
        }
      } catch (parseErr) {
        throw new Error(ERRORS.PARSE_MINUTES);
      }
      setCurrentMeetingId(result.meetingId);
      setMinutes(result.content);
      // 面试题目：默认全选
      const qs = Array.isArray(result.questions) ? (result.questions as InterviewQuestion[]) : [];
      setQuestions(qs);
      setSelectedQ(new Set(qs.map((q) => q.id)));
      setShowMinutes(true);
      setCarouselPage(0);
      setGenerating(false);
      onGeneratingChange(false);
      onMeetingCreated();

      if ("Notification" in window && Notification.permission === "granted") {
        new Notification("EasyWork", { body: isInterview ? "面试复盘已生成，点击查看" : "会议纪要已生成，点击查看" });
      }
    } catch (e) {
      setError(toUserError(ERRORS.GENERATE_MINUTES, e));
      setRecording(false);
      onRecordingChange(false);
      setGenerating(false);
      onGeneratingChange(false);
    }
  }, [meetingLabel, scheduleId, onMeetingCreated, onRecordingChange, onGeneratingChange, liveTranscripts, meetingType, isInterview, company, position, stage]);

  // 勾选的题目加入题库（in_bank = 1）
  const handleAddToBank = async () => {
    if (selectedQ.size === 0 || addingQ) return;
    setAddingQ(true);
    try {
      await invoke("add_questions_to_bank", { ids: Array.from(selectedQ) });
      setQuestions((prev) => prev.map((q) => (selectedQ.has(q.id) ? { ...q, in_bank: true } : q)));
      const count = selectedQ.size;
      setSelectedQ(new Set());
      showToast(`已加入题库 ${count} 道题`, "success");
    } catch {
      showToast("加入题库失败", "error");
    }
    setAddingQ(false);
  };

  const handleToggleQ = (id: string, checked: boolean) => {
    setSelectedQ((prev) => {
      const n = new Set(prev);
      if (checked) n.add(id);
      else n.delete(id);
      return n;
    });
  };

  // ── Recording mode: full-screen transcript view ──
  if (recording || generating) {
    return (
      <div className="h-full flex flex-col">
        <header className="px-6 py-3 bg-white flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <span className="relative flex w-2.5 h-2.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-red-400 animate-ping opacity-75" />
              <span className="relative inline-flex w-2.5 h-2.5 rounded-full bg-red-500" />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-gray-900">{meetingLabel || (isInterview ? "面试录音中" : "会议录音中")}</h2>
              <p className="text-[11px] text-gray-400 pointer-events-none">
                {generating ? "正在生成纪要..." : `${formatElapsed(elapsed)} · ${liveTranscripts.length} 条转写`}
              </p>
            </div>
          </div>
          {recording && (
            <button
              onClick={handleStopClick}
              className="flex items-center gap-2 px-5 py-2 bg-red-500 text-white text-sm font-medium rounded-full hover:bg-red-600 active:scale-95 transition-all"
            >
              <MicOff size={16} />停止
            </button>
          )}
          {generating && (
            <div className="flex items-center gap-2 text-sm text-brand-600">
              <Loader size={16} className="animate-spin" />
              生成纪要中...
            </div>
          )}
        </header>

        <main className="flex-1 overflow-y-auto px-8 py-6">
          {error && (
            <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-100 text-sm text-red-700">
              {error}
              <button className="ml-2 underline hover:no-underline" onClick={() => setError(null)}>关闭</button>
            </div>
          )}

          {generating && liveTranscripts.length === 0 && (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <Loader size={32} className="animate-spin text-brand-400 mx-auto mb-4" />
                <p className="text-sm text-gray-500 pointer-events-none">AI 正在分析会议内容...</p>
              </div>
            </div>
          )}

          {liveTranscripts.length === 0 && recording && (
            <div className="flex items-center justify-center h-full">
              <p className="text-sm text-gray-400 pointer-events-none">正在聆听...</p>
            </div>
          )}

          <div className="max-w-3xl mx-auto space-y-3">
            {liveTranscripts.map((item, i) => {
              const s = getSpeakerStyle(item.speaker);
              return (
                <div key={i} className="flex gap-3 text-sm group">
                  <span
                    className="flex-shrink-0 text-xs px-2 py-1 rounded font-medium h-fit"
                    style={{ backgroundColor: s.bg, color: s.text }}
                  >
                    {item.speaker}
                  </span>
                  <p className="text-gray-700 leading-relaxed pt-0.5">{item.text}</p>
                </div>
              );
            })}
          </div>
        </main>

        <ConfirmDialog
          open={showStopConfirm}
          title="结束录制"
          description="确定要结束录制吗？结束后将自动生成会议纪要。"
          cancelLabel="继续录制"
          confirmLabel="结束录制"
          confirmVariant="danger"
          onConfirm={stopRecording}
          onCancel={() => setShowStopConfirm(false)}
        />
      </div>
    );
  }

  // ── Setup mode: configuration before recording ──
  return (
    <>
      <div className="relative h-full flex flex-col">
        {/* 标题：悬浮在顶部不占文档流，主体才能在整个区域真正居中 */}
        <header className="absolute top-0 left-0 right-0 px-8 pt-4 z-10 pointer-events-none">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">
            {new Date().toLocaleDateString("zh-CN", {
              year: "numeric", month: "long", day: "numeric", weekday: "long",
            })}
          </p>
          <h2 className="text-2xl font-semibold text-gray-900 mt-1">面试记录</h2>
        </header>
        <div className="flex-1 flex items-center justify-center px-8 py-8">
          <div className="w-full max-w-md space-y-6">
          {error && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-100 text-sm text-red-700">
              {error}
              <button className="ml-2 underline hover:no-underline" onClick={() => setError(null)}>关闭</button>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">音频输出设备</label>
            <Select
              value={selectedDevice}
              options={devices.map((d) => ({ value: d.name, label: `${d.name}${d.is_default ? " (默认)" : ""}` }))}
              onChange={setSelectedDevice}
              placeholder="正在加载设备..."
              disabled={devices.length === 0}
            />
          </div>

          {/* 模式切换：面试记录（默认）/ 会议记录 */}
          <div className="flex rounded-xl bg-gray-100 p-1">
            <button
              onClick={() => setIsInterview(true)}
              className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-colors ${isInterview ? "bg-white text-brand-700 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
            >
              🎯 面试记录
            </button>
            <button
              onClick={() => setIsInterview(false)}
              className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-colors ${!isInterview ? "bg-white text-brand-700 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
            >
              📋 会议记录
            </button>
          </div>

          {isInterview ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">公司</label>
                  <input
                    type="text"
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                    placeholder="例如：XX科技"
                    className="w-full px-3 py-2.5 rounded-lg border border-gray-200 bg-gray-50 text-sm text-gray-900 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-brand-300 focus:border-brand-400 focus:bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">岗位</label>
                  <input
                    type="text"
                    value={position}
                    onChange={(e) => setPosition(e.target.value)}
                    placeholder="例如：前端工程师"
                    className="w-full px-3 py-2.5 rounded-lg border border-gray-200 bg-gray-50 text-sm text-gray-900 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-brand-300 focus:border-brand-400 focus:bg-white"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">面试阶段</label>
                <Select
                  value={stage}
                  options={[
                    { value: "hr", label: "HR面" },
                    { value: "one", label: "一面" },
                    { value: "two", label: "二面" },
                    { value: "three", label: "三面" },
                  ]}
                  onChange={setStage}
                />
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">会议名称</label>
                <input
                  type="text"
                  value={meetingLabel}
                  onChange={(e) => setMeetingLabel(e.target.value)}
                  placeholder="例如：周例会"
                  className="w-full px-3 py-2.5 rounded-lg border border-gray-200 bg-gray-50 text-sm text-gray-900 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-brand-300 focus:border-brand-400 focus:bg-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">会议类型</label>
                <Select
                  value={meetingType}
                  options={[
                    { value: "其他", label: "通用" },
                    { value: "周会", label: "周会" },
                    { value: "培训", label: "培训" },
                    { value: "项目评审", label: "项目评审" },
                  ]}
                  onChange={setMeetingType}
                />
              </div>
            </>
          )}

          {isInterview && (
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">记录名称（可留空自动生成）</label>
              <input
                type="text"
                value={meetingLabel}
                onChange={(e) => setMeetingLabel(e.target.value)}
                placeholder={`${company || "公司"}-${position || "岗位"}-面试`}
                className="w-full px-3 py-2.5 rounded-lg border border-gray-200 bg-gray-50 text-sm text-gray-900 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-brand-300 focus:border-brand-400 focus:bg-white"
              />
              <p className="mt-2 text-[11px] text-gray-400 leading-relaxed">
                ⚠️ 录制真实面试前请征得对方同意。系统仅在本机处理音频与转写，数据不出设备。
              </p>
            </div>
          )}

          <button
            onClick={startRecording}
            disabled={!selectedDevice}
            className="w-full inline-flex items-center justify-center gap-2 px-6 py-3 bg-brand-600 text-white text-sm font-medium rounded-full hover:bg-brand-700 active:scale-95 transition-all shadow-lg shadow-brand-500/30 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Mic size={16} />开始录制
          </button>

          <div className="relative">
            <div className="absolute inset-x-10 inset-y-0 flex items-center">
              <div className="w-full border-t border-gray-200" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-white px-2 text-gray-400">或</span>
            </div>
          </div>

          <button
            onClick={importAudio}
            disabled={generating}
            className="w-full inline-flex items-center justify-center gap-2 px-6 py-3 bg-white text-gray-600 text-sm font-medium rounded-full border-2 border-dashed border-gray-300 hover:border-brand-400 hover:text-brand-600 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <FileAudio size={16} />导入已有音频
          </button>
          </div>
        </div>
      </div>

      {/* Minutes result modal — carousel: summary / transcript */}
      {showMinutes && minutes && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[85vh] mx-4 flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <Sparkles size={18} className="text-brand-500" />
                <h2 className="text-lg font-semibold text-gray-900">{meetingLabel || "会议纪要"}</h2>
              </div>
              <button
                onClick={() => setShowMinutes(false)}
                className="p-1 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Carousel pages */}
            <div className="flex-1 overflow-hidden relative select-none min-h-0"
              onMouseDown={(e) => handleDragStart(e.clientX, e.clientY)}
              onMouseUp={(e) => handleDragEnd(e.clientX, e.clientY)}
              onTouchStart={(e) => handleDragStart(e.touches[0].clientX, e.touches[0].clientY)}
              onTouchEnd={(e) => handleDragEnd(e.changedTouches[0].clientX, e.changedTouches[0].clientY)}
            >
              <div
                className="flex h-full transition-transform duration-300 ease-in-out"
                style={{ transform: `translateX(-${carouselPage * 100}%)` }}
              >
                {/* Page 1: Summary */}
                <div className="min-w-full h-full min-h-0 overflow-y-auto px-6 py-4">
                  <Markdown content={minutes} />
                </div>

                {/* Page 2: Transcript with speaker labels */}
                <div className="min-w-full h-full min-h-0 overflow-y-auto px-6 py-4">
                  {liveTranscripts.length === 0 ? (
                    <p className="text-sm text-gray-400 pointer-events-none">无转写记录</p>
                  ) : (
                    <div className="space-y-3">
                      {liveTranscripts.map((item, i) => {
                        const s = getSpeakerStyle(item.speaker);
                        return (
                          <div key={i} className="flex gap-3 items-start">
                            <span
                              className="shrink-0 inline-flex items-center justify-center rounded-full text-xs font-medium h-6 min-w-[64px] px-3"
                              style={{ backgroundColor: s.bg, color: s.text }}
                            >
                              {item.speaker}
                            </span>
                            <span className="text-sm text-gray-700 leading-6">{item.text}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Page 3: 面试题目（勾选 → 加入题库） */}
                {questions.length > 0 && (
                  <div className="min-w-full h-full min-h-0 overflow-y-auto px-6 py-4">
                    <div className="flex items-center justify-between mb-3 gap-3">
                      <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">
                        <BookOpen size={15} className="text-brand-500" />
                        本次面试题目
                        <span className="text-xs text-gray-400 font-normal">已选 {selectedQ.size}/{questions.length}</span>
                      </h3>
                      <button
                        onClick={handleAddToBank}
                        disabled={selectedQ.size === 0 || addingQ}
                        className="px-4 py-2 text-xs font-semibold text-white bg-brand-600 rounded-lg hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1 flex-shrink-0"
                      >
                        <Check size={13} />
                        {addingQ ? "加入中..." : `加入题库 (${selectedQ.size})`}
                      </button>
                    </div>
                    <div className="space-y-2">
                      {questions.map((q, i) => (
                        <label
                          key={q.id}
                          className="flex items-start gap-3 px-4 py-3 rounded-xl bg-white border border-gray-100 shadow-sm hover:border-brand-200 cursor-pointer transition-colors"
                        >
                          <input
                            type="checkbox"
                            checked={selectedQ.has(q.id)}
                            onChange={(e) => handleToggleQ(q.id, e.target.checked)}
                            className="mt-0.5 w-4 h-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500 flex-shrink-0"
                          />
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-brand-50 text-brand-700 border border-brand-100">{q.category}</span>
                              <span className="text-[10px] text-gray-300">#{i + 1}</span>
                            </div>
                            <p className="text-sm text-gray-800 leading-relaxed">{q.question}</p>
                            {q.expected_answer && (
                              <p className="mt-1 text-xs text-gray-400 leading-relaxed">💡 {q.expected_answer}</p>
                            )}
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Carousel dots */}
            <div className="flex items-center justify-center gap-2 px-6 py-3 border-t border-gray-100">
              {(["面试复盘", "转写记录", "面试题目"] as const).slice(0, questions.length > 0 ? 3 : 2).map((label, i) => (
                <button
                  key={label}
                  onClick={() => setCarouselPage(i)}
                  className={`h-2 rounded-full transition-all duration-300 ${
                    carouselPage === i ? "w-6 bg-brand-500" : "w-2 bg-gray-300 hover:bg-gray-400"
                  }`}
                  aria-label={label}
                />
              ))}
              <span className="ml-2 text-xs text-gray-400">
                {(["面试复盘", "转写记录", "面试题目"] as const)[carouselPage]}
              </span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

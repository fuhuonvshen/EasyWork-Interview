// EasyWork - History Detail (view/edit meeting minutes + title + transcript)
import { useState, useEffect, useRef } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { ArrowLeft, Loader, Pencil, Check, X, MessageSquareText, PlayCircle, Trash2 } from "lucide-react";
import Markdown from "../../components/Markdown";
import ExportDropdown from "../../components/ExportDropdown";
import ConfirmDialog from "../../components/ConfirmDialog";
import { ERRORS, toUserError } from "../../errors";
import { showToast } from "../../components/Toast";

interface MeetingDetail {
  id: string;
  title: string;
  content: string;
  wav_path?: string;
}

interface TranscriptChunk {
  speaker: string;
  text: string;
  start?: number;
}

interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

function formatTime(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

export default function HistoryDetail({ meetingId, onBack }: { meetingId: string; onBack: () => void }) {
  const [detail, setDetail] = useState<MeetingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [editingTitle, setEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showTranscript, setShowTranscript] = useState(false);
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
  const [transcriptChunks, setTranscriptChunks] = useState<TranscriptChunk[]>([]);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [audioSrc, setAudioSrc] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState<number | null>(null);
  const [confirmDeleteAudio, setConfirmDeleteAudio] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    setLoading(true);
    setEditing(false);
    setEditingTitle(false);
    invoke<MeetingDetail>("get_meeting", { meetingId })
      .then((d) => {
        setDetail(d);
        setEditContent(d.content);
        setEditTitle(d.title);
        // Prepare a browser-playable (16-bit PCM) copy of the recording
        if (d.wav_path) {
          invoke<string>("prepare_playback_audio", { wavPath: d.wav_path })
            .then((path) => setAudioSrc(convertFileSrc(path)))
            .catch(() => setAudioSrc(null));
        }
      })
      .catch(() => setDetail({ id: meetingId, title: ERRORS.LOAD_MINUTES, content: "" }))
      .finally(() => setLoading(false));
  }, [meetingId]);

  // Highlight the transcript line matching the current playback position
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => {
      const t = audio.currentTime;
      let idx = -1;
      for (let i = 0; i < transcriptChunks.length; i++) {
        const start = transcriptChunks[i].start;
        if (start !== undefined && t >= start) idx = i;
        else if (start !== undefined) break;
      }
      setCurrentIndex(idx);
    };
    audio.addEventListener("timeupdate", onTime);
    return () => audio.removeEventListener("timeupdate", onTime);
  }, [transcriptChunks, audioSrc]);

  const seekTo = (start: number | undefined) => {
    const audio = audioRef.current;
    if (start === undefined || !audio) return;
    audio.currentTime = start;
    audio.play().catch(() => {});
  };

  const handleDeleteAudio = async () => {
    try {
      await invoke("delete_meeting_audio", { meetingId });
      setConfirmDeleteAudio(false);
      setAudioSrc(null);
      showToast("音频已删除", "success");
    } catch (e) {
      showToast(toUserError(ERRORS.DELETE_MEETING, e), "error");
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await invoke("update_meeting_minutes", { meetingId, content: editContent });
      setDetail((prev) => prev ? { ...prev, content: editContent } : prev);
      setEditing(false);
    } catch (e) {
      setSaveError(toUserError(ERRORS.SAVE_MINUTES, e));
    }
    setSaving(false);
  };

  const loadTranscript = async () => {
    setTranscriptLoading(true);
    setShowTranscript(true);
    try {
      const res = await invoke<{ chunks: TranscriptChunk[]; segments: TranscriptSegment[] }>("get_meeting_transcript", { meetingId });
      // Prefer live speaker chunks (they carry start times); fall back to
      // final-transcription segments for older meetings without speaker data.
      // Chunks arrive in transcription-completion order (two audio streams
      // transcribe in parallel), so sort by start time for chronological view.
      const sortByStart = (a: TranscriptChunk, b: TranscriptChunk) => {
        if (a.start !== undefined && b.start !== undefined) return a.start - b.start;
        if (a.start !== undefined) return -1;
        if (b.start !== undefined) return 1;
        return 0;
      };
      if (res.chunks.length > 0) {
        setTranscriptChunks([...res.chunks].sort(sortByStart));
      } else {
        setTranscriptChunks(
          res.segments.map((s) => ({ speaker: "", text: s.text, start: s.start }))
        );
      }
    } catch {
      setTranscriptChunks([]);
    }
    setTranscriptLoading(false);
  };

  const handleSaveTitle = async () => {
    const trimmed = editTitle.trim();
    if (!trimmed || !detail) return;
    try {
      await invoke("update_meeting_title", { meetingId, title: trimmed });
      setDetail({ ...detail, title: trimmed });
      setEditingTitle(false);
    } catch (e) {
      setSaveError(toUserError(ERRORS.SAVE_MINUTES, e));
    }
  };

  return (
    <>
      <header className="px-8 py-4 bg-white flex items-center justify-between">
        <div className="flex items-center gap-4 min-w-0">
          <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors flex-shrink-0">
            <ArrowLeft size={18} />
          </button>
          <div className="min-w-0">
            {editingTitle ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="text-xl font-semibold text-gray-900 bg-gray-50 border border-gray-300 rounded-lg px-3 py-1 outline-none focus:ring-2 focus:ring-brand-300 w-full max-w-md"
                  autoFocus
                  onKeyDown={(e) => { if (e.key === "Enter") handleSaveTitle(); if (e.key === "Escape") { setEditingTitle(false); setEditTitle(detail?.title || ""); } }}
                />
                <button onClick={handleSaveTitle} className="p-1.5 rounded-lg hover:bg-green-50 text-green-600 transition-colors">
                  <Check size={16} />
                </button>
                <button onClick={() => { setEditingTitle(false); setEditTitle(detail?.title || ""); }} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors">
                  <X size={16} />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 group">
                <h2 className="text-xl font-semibold text-gray-900 truncate">{detail?.title || "会议纪要"}</h2>
                {!loading && detail && (
                  <button
                    onClick={() => { setEditingTitle(true); setEditTitle(detail.title); }}
                    className="p-1 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-all"
                    title="重命名"
                  >
                    <Pencil size={14} />
                  </button>
                )}
              </div>
            )}
            {!editingTitle && (
              <p className="text-sm text-gray-400 mt-0.5">AI 生成的会议摘要</p>
            )}
          </div>
        </div>
        {!loading && detail && !editing && (
          <div className="flex items-center gap-2">
            <ExportDropdown content={detail.content} />
            <button
              onClick={loadTranscript}
              className="px-4 py-2 text-sm font-medium text-brand-600 bg-brand-50 rounded-lg hover:bg-brand-100 transition-colors flex items-center gap-1.5"
            >
              <MessageSquareText size={16} />
              查看转写
            </button>
            <button
              onClick={() => setEditing(true)}
              className="px-4 py-2 text-sm font-medium text-brand-600 bg-brand-50 rounded-lg hover:bg-brand-100 transition-colors"
            >
              编辑纪要
            </button>
          </div>
        )}
        {editing && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setEditing(false); setEditContent(detail?.content || ""); }}
              className="px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 text-sm font-medium text-white bg-brand-600 rounded-lg hover:bg-brand-700 disabled:opacity-50 transition-colors"
            >
              {saving ? "保存中..." : "保存"}
            </button>
          </div>
        )}
      </header>

      {saveError && (
        <div className="mx-8 mt-4 p-3 rounded-lg bg-red-50 border border-red-100 text-sm text-red-700 flex items-center justify-between">
          <span>{saveError}</span>
          <button onClick={() => setSaveError(null)} className="underline hover:no-underline text-red-500 ml-2">关闭</button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-8 py-6">
        {loading && (
          <div className="flex items-center gap-3 text-sm text-gray-400">
            <Loader size={16} className="animate-spin" />
            加载中...
          </div>
        )}
        {!loading && !editing && detail && (
          detail.content ? <Markdown content={detail.content} />
            : <p className="text-sm text-gray-400 text-center pt-16">会议内容为空</p>
        )}
        {!loading && !editing && !detail && (
          <p className="text-sm text-gray-400 text-center pt-16">会议内容为空</p>
        )}
        {!loading && editing && (
          <textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            className="w-full h-full min-h-[400px] text-sm text-gray-700 leading-relaxed resize-none border border-gray-200 rounded-lg p-4 outline-none focus:ring-2 focus:ring-brand-300 font-sans"
          />
        )}
      </div>

      {/* Transcript popup */}
      {showTranscript && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[80vh] mx-4 flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <MessageSquareText size={18} className="text-brand-500" />
                <h2 className="text-lg font-semibold text-gray-900">转写记录</h2>
              </div>
              <button
                onClick={() => setShowTranscript(false)}
                className="p-1 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            {audioSrc && (
              <div className="px-6 pt-4 pb-1 border-b border-gray-50">
                <audio ref={audioRef} src={audioSrc} controls className="w-full" />
                <div className="flex items-center justify-between mt-1.5">
                  <p className="text-xs text-gray-400 flex items-center gap-1">
                    <PlayCircle size={12} />
                    点击句子可跳转到对应音频位置
                  </p>
                  <button
                    onClick={() => setConfirmDeleteAudio(true)}
                    className="flex items-center gap-1 text-xs text-gray-400 hover:text-red-500 transition-colors"
                  >
                    <Trash2 size={12} />
                    删除音频
                  </button>
                </div>
              </div>
            )}
            <div className="flex-1 overflow-y-auto px-6 py-4">
              {transcriptLoading ? (
                <div className="flex items-center gap-2 text-sm text-gray-400 py-8 justify-center">
                  <Loader size={16} className="animate-spin" />
                  加载中...
                </div>
              ) : transcriptChunks.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-8 pointer-events-none">该会议没有说话人转写记录</p>
              ) : (
                <div className="space-y-2">
                  {transcriptChunks.map((item, i) => {
                    const s = getSpeakerStyle(item.speaker);
                    const clickable = item.start !== undefined && !!audioSrc;
                    const active = clickable && currentIndex === i;
                    return (
                      <button
                        key={i}
                        onClick={() => seekTo(item.start)}
                        disabled={!clickable}
                        className={`w-full text-left flex gap-3 items-start rounded-lg px-2 py-1.5 transition-colors ${
                          active ? "bg-brand-50 ring-1 ring-brand-200" : clickable ? "hover:bg-gray-50 cursor-pointer" : "cursor-default"
                        }`}
                      >
                        {item.speaker && (
                          <span
                            className="shrink-0 inline-flex items-center justify-center rounded-full text-xs font-medium h-6 min-w-[64px] px-3 mt-0.5"
                            style={{ backgroundColor: s.bg, color: s.text }}
                          >
                            {item.speaker}
                          </span>
                        )}
                        <span className="text-xs text-gray-400 font-mono mt-1 shrink-0 w-10 text-right">
                          {clickable ? formatTime(item.start!) : ""}
                        </span>
                        <span className="text-sm text-gray-700 leading-6">{item.text}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmDeleteAudio}
        icon={<Trash2 size={24} className="text-red-500" />}
        title="删除音频"
        description="确定要删除这条会议的录音文件吗？删除后无法恢复，转写文本仍会保留。"
        onConfirm={handleDeleteAudio}
        onCancel={() => setConfirmDeleteAudio(false)}
      />
    </>
  );
}
// EasyWork - Minutes App (sidebar + main content area)
import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import TodayView from "./recording/TodayView";
import HistoryDetail from "./history/HistoryDetail";
import ScheduleView from "../schedule";
import MinutesSidebar from "./components/MinutesSidebar";
import MeetingListView from "./history/MeetingListView";
import ReportList from "./reports/ReportList";
import ReportViewModal from "./reports/ReportViewModal";
import MeetingModelCheck from "./components/MeetingModelCheck";
import type { MinutesTab, ReportItem } from "../types";

export default function MinutesApp({
  prefillTitle,
  scheduleId,
  initialTab,
  onBack,
  onNavigateRecording,
}: {
  prefillTitle: string;
  scheduleId: string | null;
  initialTab: MinutesTab;
  onBack: () => void;
  onNavigateRecording: (title: string, scheduleId?: string) => void;
}) {
  const [tab, setTab] = useState<MinutesTab>(initialTab);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const isBusy = isRecording || isGenerating;

  const [savedReports, setSavedReports] = useState<ReportItem[]>([]);
  const [viewingReport, setViewingReport] = useState<string | null>(null);
  const [historySubTab, setHistorySubTab] = useState<"meetings" | "week" | "month">("meetings");

  useEffect(() => { setTab(initialTab); }, [initialTab]);

  const loadReports = useCallback(() => {
    invoke<ReportItem[]>("list_reports")
      .then(setSavedReports)
      .catch((e) => console.warn("加载报告列表失败", e));
  }, []);

  useEffect(() => { loadReports(); }, [loadReports]);

  const handleDeleteReport = async (id: string) => {
    try { await invoke("delete_report", { id }); loadReports(); }
    catch (e) { console.error("删除报告失败:", e); }
  };

  return (
    <MeetingModelCheck>
    <div className="flex h-full gap-2.5">
      <MinutesSidebar
        tab={tab}
        onTabChange={(key) => { setTab(key); setSelectedId(null); }}
        historySubTab={historySubTab}
        onHistorySubTabChange={setHistorySubTab}
        isBusy={isBusy}
        onBack={onBack}
      />

      <main className="flex-1 flex flex-col min-w-0 overflow-hidden rounded-lg bg-white">
        {tab === "today" && (
          <TodayView
            prefillTitle={prefillTitle}
            scheduleId={scheduleId}
            onMeetingCreated={() => {}}
            onRecordingChange={setIsRecording}
            onGeneratingChange={setIsGenerating}
          />
        )}
        {tab === "history" && selectedId && (
          <HistoryDetail meetingId={selectedId} onBack={() => setSelectedId(null)} />
        )}
        {tab === "history" && !selectedId && historySubTab === "meetings" && (
          <MeetingListView
            onSelectMeeting={setSelectedId}
            isBusy={isBusy}
          />
        )}
        {tab === "history" && !selectedId && historySubTab !== "meetings" && (
          <div className="flex-1 flex flex-col overflow-hidden min-w-0">
            <div className="px-8 py-4 bg-white">
              <p className="text-xs font-medium text-gray-400 uppercase tracking-wider pointer-events-none">工作报告</p>
              <h2 className="text-2xl font-semibold text-gray-900 mt-1 flex items-center min-h-[38px]">
                {historySubTab === "week" ? "周报" : "月报"}
              </h2>
            </div>
            <ReportList
              reports={savedReports}
              periodType={historySubTab}
              onView={setViewingReport}
              onDelete={handleDeleteReport}
            />
          </div>
        )}
        {tab === "schedule" && (
          <ScheduleView
            onNavigateRecording={onNavigateRecording}
            onViewMinutes={(id) => { setTab("history"); setSelectedId(id); }}
            onReportsChanged={loadReports}
          />
        )}
      </main>

      {viewingReport && (
        <ReportViewModal
          content={viewingReport}
          onClose={() => setViewingReport(null)}
        />
      )}
    </div>
    </MeetingModelCheck>
  );
}

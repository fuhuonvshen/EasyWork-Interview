// EasyWork - Schedule state management hook
import { useState, useEffect, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { showToast } from "../components/Toast";
import { ERRORS, toUserError } from "../errors";
import type { ScheduledMeeting } from "../types";

export function useSchedule(onReportsChanged: () => void) {
  const [scheduled, setScheduled] = useState<ScheduledMeeting[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [report, setReport] = useState<string | null>(null);
  const [loadingReport, setLoadingReport] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ScheduledMeeting | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingMeeting, setEditingMeeting] = useState<ScheduledMeeting | null>(null);
  const [viewYear, setViewYear] = useState(new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(new Date().getMonth());

  const load = useCallback(() => {
    invoke<ScheduledMeeting[]>("list_scheduled_meetings")
      .then(setScheduled)
      .catch((e: unknown) => showToast(toUserError(ERRORS.LOAD_SCHEDULE, e), "error"));
  }, []);

  useEffect(() => { load(); }, [load]);

  const generateReport = async (period: "week" | "month") => {
    setLoadingReport(true);
    setReport(null);
    try {
      const result = await invoke<string>("generate_report", { period });
      setReport(result);
    } catch (e: unknown) {
      setReport(toUserError(ERRORS.GENERATE_REPORT, e));
    }
    setLoadingReport(false);
    onReportsChanged();
  };

  const confirmDelete = async (id: string) => {
    try {
      await invoke("delete_scheduled_meeting", { id });
      setDeleteTarget(null);
      load();
    } catch (e: unknown) {
      showToast(toUserError(ERRORS.DELETE_SCHEDULE, e), "error");
    }
  };

  const handleFormSubmit = async (data: {
    title: string;
    zoomUrl: string;
    date: string;
    time: string;
  }) => {
    const { title, zoomUrl, date, time } = data;
    if (!title || !date || !time) return;
    const startTime = `${date}T${time}:00`;

    if (editingMeeting) {
      try {
        await invoke("update_scheduled_meeting", {
          id: editingMeeting.id,
          title,
          zoomUrl,
          startTime,
          endTime: "",
        });
        setShowForm(false);
        setEditingMeeting(null);
        load();
      } catch (e: unknown) {
        showToast(toUserError(ERRORS.UPDATE_SCHEDULE, e), "error");
      }
    } else {
      try {
        await invoke<string>("add_scheduled_meeting", {
          title, zoomUrl, startTime, endTime: "",
        });
      } catch (e: unknown) {
        showToast(toUserError(ERRORS.CREATE_SCHEDULE, e), "error");
        return;
      }

      setShowForm(false);
      load();
    }
  };

  const handleEdit = (m: ScheduledMeeting) => {
    setEditingMeeting(m);
    setShowForm(true);
  };

  const openNewForm = () => {
    setEditingMeeting(null);
    setShowForm(true);
  };

  const prevMonth = () => {
    if (viewMonth === 0) { setViewYear(viewYear - 1); setViewMonth(11); }
    else setViewMonth(viewMonth - 1);
  };

  const nextMonth = () => {
    if (viewMonth === 11) { setViewYear(viewYear + 1); setViewMonth(0); }
    else setViewMonth(viewMonth + 1);
  };

  const dateMeetings = useMemo(
    () => selectedDate
      ? scheduled.filter((m) => m.start_time.slice(0, 10) === selectedDate)
      : [],
    [selectedDate, scheduled],
  );

  return {
    scheduled,
    selectedDate,
    report,
    loadingReport,
    deleteTarget,
    showForm,
    editingMeeting,
    viewYear,
    viewMonth,
    dateMeetings,
    load,
    generateReport,
    confirmDelete,
    handleFormSubmit,
    handleEdit,
    openNewForm,
    setDeleteTarget,
    setSelectedDate,
    setShowForm,
    setEditingMeeting,
    setReport,
    prevMonth,
    nextMonth,
  };
}

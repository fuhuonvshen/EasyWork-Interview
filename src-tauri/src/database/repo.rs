// EasyWork - 数据库操作
// 建表 + 增删查改。通过 sqlx 操作 SQLite。

use anyhow::{Context, Result};
use sqlx::sqlite::SqlitePool;
use std::collections::HashMap;

use super::models::{Meeting, MeetingSummary, Minutes, ScheduledMeeting, Transcript};

/// Escape SQLite LIKE wildcards so user input is matched literally.
/// `%` → `\%`, `_` → `\_`, and the escape char itself `\` → `\\`.
fn escape_like(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

/// Create tables if they don't exist.
pub async fn init_db(pool: &SqlitePool) -> Result<()> {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS meetings (
            id          TEXT PRIMARY KEY,
            title       TEXT NOT NULL,
            created_at  TEXT NOT NULL,
            duration_secs INTEGER NOT NULL DEFAULT 0,
            wav_path    TEXT NOT NULL DEFAULT '',
            schedule_id TEXT,
            pinned      INTEGER NOT NULL DEFAULT 0
        )",
    )
    .execute(pool)
    .await
    .context("创建 meetings 表失败")?;
    // Index for date-range queries used in pagination and report generation
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_meetings_created_at ON meetings(created_at)")
        .execute(pool).await.ok();

    // Migration: add schedule_id to existing tables
    sqlx::query("ALTER TABLE meetings ADD COLUMN schedule_id TEXT")
        .execute(pool)
        .await
        .ok(); // ignore error if column already exists
    sqlx::query("ALTER TABLE meetings ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0")
        .execute(pool)
        .await
        .ok();

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS transcripts (
            id          TEXT PRIMARY KEY,
            meeting_id  TEXT NOT NULL,
            content     TEXT NOT NULL DEFAULT '',
            created_at  TEXT NOT NULL,
            FOREIGN KEY (meeting_id) REFERENCES meetings(id)
        )",
    )
    .execute(pool)
    .await
    .context("创建 transcripts 表失败")?;
    // Migration: add live_transcript column (JSON array of speaker-labeled chunks)
    sqlx::query("ALTER TABLE transcripts ADD COLUMN live_transcript TEXT")
        .execute(pool)
        .await
        .ok();
    // Migration: add segments column (JSON array of {start, end, text} for click-to-seek)
    sqlx::query("ALTER TABLE transcripts ADD COLUMN segments TEXT")
        .execute(pool)
        .await
        .ok();

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS minutes (
            id          TEXT PRIMARY KEY,
            meeting_id  TEXT NOT NULL,
            content     TEXT NOT NULL DEFAULT '',
            created_at  TEXT NOT NULL,
            FOREIGN KEY (meeting_id) REFERENCES meetings(id)
        )",
    )
    .execute(pool)
    .await
    .context("创建 minutes 表失败")?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS scheduled_meetings (
            id          TEXT PRIMARY KEY,
            title       TEXT NOT NULL,
            zoom_url    TEXT NOT NULL DEFAULT '',
            start_time  TEXT NOT NULL,
            end_time    TEXT NOT NULL DEFAULT '',
            created_at  TEXT NOT NULL
        )",
    )
    .execute(pool)
    .await
    .context("创建 scheduled_meetings 表失败")?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS reports (
            id          TEXT PRIMARY KEY,
            period_type TEXT NOT NULL,
            period_label TEXT NOT NULL,
            content     TEXT NOT NULL DEFAULT '',
            created_at  TEXT NOT NULL
        )",
    )
    .execute(pool)
    .await
    .context("创建 reports 表失败")?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS agent_conversations (
            id          TEXT PRIMARY KEY,
            title       TEXT NOT NULL DEFAULT '',
            summary     TEXT NOT NULL DEFAULT '',
            created_at  TEXT NOT NULL
        )",
    )
    .execute(pool)
    .await
    .context("创建 agent_conversations 表失败")?;
    // Add summary column for databases created before the migration
    let _ = sqlx::query(
        "ALTER TABLE agent_conversations ADD COLUMN summary TEXT NOT NULL DEFAULT ''",
    )
    .execute(pool)
    .await;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS agent_messages (
            id              TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL,
            role            TEXT NOT NULL,
            content         TEXT NOT NULL DEFAULT '',
            tool_calls      TEXT,
            created_at      TEXT NOT NULL,
            FOREIGN KEY (conversation_id) REFERENCES agent_conversations(id)
        )",
    )
    .execute(pool)
    .await
    .context("创建 agent_messages 表失败")?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS settings (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL DEFAULT ''
        )",
    )
    .execute(pool)
    .await
    .context("创建 settings 表失败")?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS agent_todos (
            id          TEXT PRIMARY KEY,
            title       TEXT NOT NULL,
            status      TEXT NOT NULL DEFAULT 'pending',
            priority    TEXT NOT NULL DEFAULT 'medium',
            deadline    TEXT,
            source      TEXT NOT NULL DEFAULT 'chat',
            created_at  TEXT NOT NULL,
            schedule_id TEXT
        )",
    )
    .execute(pool)
    .await
    .context("创建 agent_todos 表失败")?;

    Ok(())
}

// ── Meeting CRUD ───────────────────────────────────────────────

pub async fn insert_meeting(pool: &SqlitePool, m: &Meeting) -> Result<()> {
    sqlx::query(
        "INSERT INTO meetings (id, title, created_at, duration_secs, wav_path, schedule_id, pinned)
         VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&m.id)
    .bind(&m.title)
    .bind(&m.created_at)
    .bind(m.duration_secs)
    .bind(&m.wav_path)
    .bind(&m.schedule_id)
    .bind(m.pinned as i32)
    .execute(pool)
    .await
    .context("插入 meeting 失败")?;
    Ok(())
}

pub async fn update_meeting_duration(
    pool: &SqlitePool,
    meeting_id: &str,
    duration_secs: i64,
    wav_path: &str,
) -> Result<()> {
    sqlx::query("UPDATE meetings SET duration_secs = ?, wav_path = ? WHERE id = ?")
        .bind(duration_secs)
        .bind(wav_path)
        .bind(meeting_id)
        .execute(pool)
        .await
        .context("更新 meeting 时长失败")?;
    Ok(())
}

pub async fn list_meetings(pool: &SqlitePool) -> Result<Vec<MeetingSummary>> {
    let rows = sqlx::query_as::<_, MeetingSummary>(
        "SELECT
            m.id,
            m.title,
            m.created_at,
            CASE WHEN min.id IS NOT NULL THEN 1 ELSE 0 END AS has_minutes,
            SUBSTR(min.content, 1, 200) AS first_line
         FROM meetings m
         LEFT JOIN minutes min ON min.meeting_id = m.id
         ORDER BY m.created_at DESC",
    )
    .fetch_all(pool)
    .await
    .context("查询会议列表失败")?;
    Ok(rows)
}

pub async fn list_meetings_paginated(
    pool: &SqlitePool,
    page: i64,
    page_size: i64,
    date_from: Option<&str>,
    date_to: Option<&str>,
) -> Result<(Vec<MeetingSummary>, i64)> {
    let offset = (page - 1) * page_size;
    let (total, rows) = if let (Some(from), Some(to)) = (date_from, date_to) {
        let total: (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM meetings WHERE date(created_at) >= date(?) AND date(created_at) <= date(?)"
        )
        .bind(from).bind(to)
        .fetch_one(pool).await
        .context("计数会议失败")?;
        let rows = sqlx::query_as::<_, MeetingSummary>(
            "SELECT m.id, m.title, m.created_at, m.pinned,
                    CASE WHEN min.id IS NOT NULL THEN 1 ELSE 0 END AS has_minutes,
                    SUBSTR(min.content, 1, 200) AS first_line
             FROM meetings m
             LEFT JOIN minutes min ON min.meeting_id = m.id
             WHERE date(m.created_at) >= date(?) AND date(m.created_at) <= date(?)
             ORDER BY m.pinned DESC, m.created_at DESC
             LIMIT ? OFFSET ?",
        )
        .bind(from).bind(to)
        .bind(page_size).bind(offset)
        .fetch_all(pool).await
        .context("查询会议列表失败")?;
        (total, rows)
    } else {
        let total: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM meetings")
            .fetch_one(pool).await
            .context("计数会议失败")?;
        let rows = sqlx::query_as::<_, MeetingSummary>(
            "SELECT m.id, m.title, m.created_at, m.pinned,
                    CASE WHEN min.id IS NOT NULL THEN 1 ELSE 0 END AS has_minutes,
                    SUBSTR(min.content, 1, 200) AS first_line
             FROM meetings m
             LEFT JOIN minutes min ON min.meeting_id = m.id
             ORDER BY m.pinned DESC, m.created_at DESC
             LIMIT ? OFFSET ?",
        )
        .bind(page_size).bind(offset)
        .fetch_all(pool).await
        .context("查询会议列表失败")?;
        (total, rows)
    };
    Ok((rows, total.0))
}

pub async fn search_meetings(pool: &SqlitePool, query: &str) -> Result<Vec<MeetingSummary>> {
    let pattern = format!("%{}%", escape_like(query));
    let rows = sqlx::query_as::<_, MeetingSummary>(
        "SELECT
            m.id,
            m.title,
            m.created_at,
            CASE WHEN min.id IS NOT NULL THEN 1 ELSE 0 END AS has_minutes,
            SUBSTR(min.content, 1, 200) AS first_line
         FROM meetings m
         LEFT JOIN minutes min ON min.meeting_id = m.id
         WHERE m.title LIKE ? ESCAPE '\\' OR min.content LIKE ? ESCAPE '\\'
         ORDER BY m.created_at DESC",
    )
    .bind(&pattern)
    .bind(&pattern)
    .fetch_all(pool)
    .await
    .context("搜索会议失败")?;
    Ok(rows)
}

pub async fn search_meetings_paginated(
    pool: &SqlitePool,
    query: &str,
    page: i64,
    page_size: i64,
    date_from: Option<&str>,
    date_to: Option<&str>,
) -> Result<(Vec<MeetingSummary>, i64)> {
    let pattern = format!("%{}%", escape_like(query));
    let offset = (page - 1) * page_size;
    if let (Some(from), Some(to)) = (date_from, date_to) {
        let total: (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM meetings m
             LEFT JOIN minutes min ON min.meeting_id = m.id
             WHERE (m.title LIKE ? ESCAPE '\\' OR min.content LIKE ? ESCAPE '\\')
               AND date(m.created_at) >= date(?) AND date(m.created_at) <= date(?)",
        )
        .bind(&pattern).bind(&pattern).bind(from).bind(to)
        .fetch_one(pool).await
        .context("计数搜索结果失败")?;
        let rows = sqlx::query_as::<_, MeetingSummary>(
            "SELECT m.id, m.title, m.created_at, m.pinned,
                    CASE WHEN min.id IS NOT NULL THEN 1 ELSE 0 END AS has_minutes,
                    SUBSTR(min.content, 1, 200) AS first_line
             FROM meetings m
             LEFT JOIN minutes min ON min.meeting_id = m.id
             WHERE (m.title LIKE ? ESCAPE '\\' OR min.content LIKE ? ESCAPE '\\')
               AND date(m.created_at) >= date(?) AND date(m.created_at) <= date(?)
             ORDER BY m.pinned DESC, m.created_at DESC
             LIMIT ? OFFSET ?",
        )
        .bind(&pattern).bind(&pattern).bind(from).bind(to)
        .bind(page_size).bind(offset)
        .fetch_all(pool).await
        .context("搜索会议失败")?;
        Ok((rows, total.0))
    } else {
        let total: (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM meetings m
             LEFT JOIN minutes min ON min.meeting_id = m.id
             WHERE m.title LIKE ? ESCAPE '\\' OR min.content LIKE ? ESCAPE '\\'",
        )
        .bind(&pattern).bind(&pattern)
        .fetch_one(pool).await
        .context("计数搜索结果失败")?;
        let rows = sqlx::query_as::<_, MeetingSummary>(
            "SELECT m.id, m.title, m.created_at, m.pinned,
                    CASE WHEN min.id IS NOT NULL THEN 1 ELSE 0 END AS has_minutes,
                    SUBSTR(min.content, 1, 200) AS first_line
             FROM meetings m
             LEFT JOIN minutes min ON min.meeting_id = m.id
             WHERE m.title LIKE ? ESCAPE '\\' OR min.content LIKE ? ESCAPE '\\'
             ORDER BY m.pinned DESC, m.created_at DESC
             LIMIT ? OFFSET ?",
        )
        .bind(&pattern).bind(&pattern)
        .bind(page_size).bind(offset)
        .fetch_all(pool).await
        .context("搜索会议失败")?;
        Ok((rows, total.0))
    }
}

pub async fn get_meeting(pool: &SqlitePool, id: &str) -> Result<Meeting> {
    sqlx::query_as::<_, Meeting>("SELECT * FROM meetings WHERE id = ?")
        .bind(id)
        .fetch_one(pool)
        .await
        .with_context(|| format!("未找到会议: {}", id))
}

/// Find a meeting by its linked schedule ID.
pub async fn find_meeting_by_schedule_id(pool: &SqlitePool, schedule_id: &str) -> Result<Option<String>> {
    let row: Option<(String,)> = sqlx::query_as(
        "SELECT id FROM meetings WHERE schedule_id = ? ORDER BY created_at DESC LIMIT 1",
    )
    .bind(schedule_id)
    .fetch_optional(pool)
    .await
    .context("按schedule_id查找会议失败")?;
    Ok(row.map(|r| r.0))
}

/// Remove a meeting's audio files (recording + browser-playable copy) if present.
/// Single-file deletes only — never touches directories.
fn remove_meeting_audio_files(wav_path: &str) {
    let wav = std::path::Path::new(wav_path);
    let _ = std::fs::remove_file(wav);
    if let Some(stem) = wav.file_stem().and_then(|s| s.to_str()) {
        let playback = wav.with_file_name(format!("{}_playback.wav", stem));
        let _ = std::fs::remove_file(&playback);
    }
}

pub async fn delete_meeting(pool: &SqlitePool, id: &str, delete_audio: bool) -> Result<()> {
    let wav: Option<(String,)> = sqlx::query_as("SELECT wav_path FROM meetings WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await
        .context("查询会议音频路径失败")?;

    // Delete child rows first
    sqlx::query("DELETE FROM transcripts WHERE meeting_id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    sqlx::query("DELETE FROM minutes WHERE meeting_id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    sqlx::query("DELETE FROM meetings WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await
        .context("删除 meeting 失败")?;

    if delete_audio {
        if let Some((w,)) = wav {
            if !w.is_empty() {
                remove_meeting_audio_files(&w);
            }
        }
    }
    Ok(())
}

pub async fn delete_meetings(pool: &SqlitePool, ids: &[String], delete_audio: bool) -> Result<()> {
    if ids.is_empty() {
        return Ok(());
    }
    let wavs: Vec<String> = if delete_audio {
        let mut paths = Vec::new();
        for id in ids {
            if let Some((w,)) = sqlx::query_as::<_, (String,)>(
                "SELECT wav_path FROM meetings WHERE id = ?",
            )
            .bind(id)
            .fetch_optional(pool)
            .await?
            {
                if !w.is_empty() {
                    paths.push(w);
                }
            }
        }
        paths
    } else {
        Vec::new()
    };

    let mut tx = pool.begin().await.context("开始事务失败")?;
    for id in ids {
        sqlx::query("DELETE FROM transcripts WHERE meeting_id = ?")
            .bind(id)
            .execute(&mut *tx)
            .await
            .context("批量删除 transcripts 失败")?;
        sqlx::query("DELETE FROM minutes WHERE meeting_id = ?")
            .bind(id)
            .execute(&mut *tx)
            .await
            .context("批量删除 minutes 失败")?;
        sqlx::query("DELETE FROM meetings WHERE id = ?")
            .bind(id)
            .execute(&mut *tx)
            .await
            .context("批量删除 meeting 失败")?;
    }
    tx.commit().await.context("提交事务失败")?;

    for w in &wavs {
        remove_meeting_audio_files(w);
    }
    Ok(())
}

/// Delete a meeting's audio files without deleting the meeting record.
/// Returns whether any file was actually removed. Clears wav_path in DB.
pub async fn delete_meeting_audio(pool: &SqlitePool, meeting_id: &str) -> Result<bool> {
    let wav: Option<(String,)> = sqlx::query_as("SELECT wav_path FROM meetings WHERE id = ?")
        .bind(meeting_id)
        .fetch_optional(pool)
        .await
        .context("查询会议音频路径失败")?;

    match wav {
        Some((w,)) if !w.is_empty() => {
            let existed = std::path::Path::new(&w).exists();
            remove_meeting_audio_files(&w);
            sqlx::query("UPDATE meetings SET wav_path = '' WHERE id = ?")
                .bind(meeting_id)
                .execute(pool)
                .await
                .context("清除会议音频路径失败")?;
            Ok(existed)
        }
        _ => Ok(false),
    }
}

// ── Settings ─────────────────────────────────────────────────

pub async fn get_setting(pool: &SqlitePool, key: &str) -> Result<Option<String>> {
    let row: Option<(String,)> =
        sqlx::query_as("SELECT value FROM settings WHERE key = ?")
            .bind(key)
            .fetch_optional(pool)
            .await?;
    Ok(row.map(|r| r.0))
}

pub async fn get_all_settings(pool: &SqlitePool) -> Result<HashMap<String, String>> {
    let rows: Vec<(String, String)> =
        sqlx::query_as("SELECT key, value FROM settings")
            .fetch_all(pool)
            .await?;
    Ok(rows.into_iter().collect())
}

pub async fn update_setting(pool: &SqlitePool, key: &str, value: &str) -> Result<()> {
    sqlx::query("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
        .bind(key)
        .bind(value)
        .execute(pool)
        .await?;
    Ok(())
}

// ── Transcript ─────────────────────────────────────────────────

pub async fn insert_transcript(pool: &SqlitePool, t: &Transcript) -> Result<()> {
    sqlx::query(
        "INSERT INTO transcripts (id, meeting_id, content, created_at, live_transcript, segments)
         VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(&t.id)
    .bind(&t.meeting_id)
    .bind(&t.content)
    .bind(&t.created_at)
    .bind(&t.live_transcript)
    .bind(&t.segments)
    .execute(pool)
    .await
    .context("插入 transcript 失败")?;
    Ok(())
}

pub async fn get_transcript(pool: &SqlitePool, meeting_id: &str) -> Result<Option<Transcript>> {
    let row = sqlx::query_as::<_, Transcript>(
        "SELECT * FROM transcripts WHERE meeting_id = ?",
    )
    .bind(meeting_id)
    .fetch_optional(pool)
    .await
    .context("查询 transcript 失败")?;
    Ok(row)
}

// ── Minutes ────────────────────────────────────────────────────

pub async fn insert_minutes(pool: &SqlitePool, m: &Minutes) -> Result<()> {
    sqlx::query(
        "INSERT INTO minutes (id, meeting_id, content, created_at)
         VALUES (?, ?, ?, ?)",
    )
    .bind(&m.id)
    .bind(&m.meeting_id)
    .bind(&m.content)
    .bind(&m.created_at)
    .execute(pool)
    .await
    .context("插入 minutes 失败")?;
    Ok(())
}

pub async fn get_minutes(pool: &SqlitePool, meeting_id: &str) -> Result<Option<Minutes>> {
    let row = sqlx::query_as::<_, Minutes>(
        "SELECT * FROM minutes WHERE meeting_id = ?",
    )
    .bind(meeting_id)
    .fetch_optional(pool)
    .await
    .context("查询 minutes 失败")?;
    Ok(row)
}

pub async fn update_minutes(pool: &SqlitePool, meeting_id: &str, content: &str) -> Result<()> {
    sqlx::query("UPDATE minutes SET content = ? WHERE meeting_id = ?")
        .bind(content)
        .bind(meeting_id)
        .execute(pool)
        .await
        .context("更新 minutes 失败")?;
    Ok(())
}

pub async fn get_meeting_detail(pool: &SqlitePool, meeting_id: &str) -> Result<Option<super::models::MeetingDetail>> {
    let row: Option<(String, String, Option<String>, String)> = sqlx::query_as(
        "SELECT m.title, m.id, min.content, m.wav_path FROM meetings m \
         LEFT JOIN minutes min ON min.meeting_id = m.id \
         WHERE m.id = ?"
    )
    .bind(meeting_id)
    .fetch_optional(pool)
    .await
    .context("查询会议失败")?;
    Ok(row.map(|(title, id, content, wav_path)| super::models::MeetingDetail {
        id,
        title,
        content: content.unwrap_or_default(),
        wav_path,
    }))
}

pub async fn update_meeting_title(pool: &SqlitePool, meeting_id: &str, title: &str) -> Result<()> {
    sqlx::query("UPDATE meetings SET title = ? WHERE id = ?")
        .bind(title)
        .bind(meeting_id)
        .execute(pool)
        .await
        .context("更新会议标题失败")?;
    Ok(())
}

/// Get meetings with minutes within a date range (for weekly/monthly reports).
pub async fn list_meetings_in_range(
    pool: &SqlitePool,
    since: &str,
    until: &str,
) -> Result<Vec<(String, String, String)>> {
    let rows = sqlx::query_as::<_, (String, String, String)>(
        "SELECT m.title, m.created_at, COALESCE(min.content, '') as content
         FROM meetings m
         LEFT JOIN minutes min ON min.meeting_id = m.id
         WHERE m.created_at >= ? AND m.created_at < ?
         ORDER BY m.created_at ASC",
    )
    .bind(since)
    .bind(until)
    .fetch_all(pool)
    .await
    .context("查询时间范围会议失败")?;
    Ok(rows)
}

// ── Scheduled Meetings ─────────────────────────────────────────

pub async fn insert_scheduled_meeting(pool: &SqlitePool, m: &ScheduledMeeting) -> Result<()> {
    sqlx::query(
        "INSERT INTO scheduled_meetings (id, title, zoom_url, start_time, end_time, created_at)
         VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(&m.id)
    .bind(&m.title)
    .bind(&m.zoom_url)
    .bind(&m.start_time)
    .bind(&m.end_time)
    .bind(&m.created_at)
    .execute(pool)
    .await
    .context("插入 scheduled_meeting 失败")?;

    // Create a linked todo so the user gets a reminder
    let todo_id = uuid::Uuid::new_v4().to_string();
    let deadline = m.start_time[..10].to_string();
    sqlx::query(
        "INSERT INTO agent_todos (id, title, status, priority, deadline, source, created_at, schedule_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&todo_id)
    .bind(&m.title)
    .bind("pending")
    .bind("medium")
    .bind(&deadline)
    .bind("meeting")
    .bind(&m.created_at)
    .bind(&m.id)
    .execute(pool)
    .await
    .context("插入日程关联的待办失败")?;

    Ok(())
}

pub async fn list_scheduled_meetings(pool: &SqlitePool) -> Result<Vec<ScheduledMeeting>> {
    let rows = sqlx::query_as::<_, ScheduledMeeting>(
        "SELECT * FROM scheduled_meetings ORDER BY start_time ASC",
    )
    .fetch_all(pool)
    .await
    .context("查询 scheduled_meetings 失败")?;
    Ok(rows)
}

pub async fn update_scheduled_meeting(pool: &SqlitePool, m: &ScheduledMeeting) -> Result<()> {
    sqlx::query(
        "UPDATE scheduled_meetings SET title = ?, zoom_url = ?, start_time = ?, end_time = ? WHERE id = ?",
    )
    .bind(&m.title)
    .bind(&m.zoom_url)
    .bind(&m.start_time)
    .bind(&m.end_time)
    .bind(&m.id)
    .execute(pool)
    .await
    .context("更新 scheduled_meeting 失败")?;

    // Sync linked todo title and deadline when the schedule changes
    let deadline = m.start_time[..10].to_string();
    sqlx::query(
        "UPDATE agent_todos SET title = ?, deadline = ? WHERE schedule_id = ?",
    )
    .bind(&m.title)
    .bind(&deadline)
    .bind(&m.id)
    .execute(pool)
    .await
    .context("更新日程关联的待办失败")?;

    Ok(())
}

pub async fn delete_scheduled_meeting(pool: &SqlitePool, id: &str) -> Result<()> {
    // Delete linked todo first (schedule_id FK), then the schedule itself
    sqlx::query("DELETE FROM agent_todos WHERE schedule_id = ?")
        .bind(id)
        .execute(pool)
        .await
        .context("删除日程关联的待办失败")?;
    sqlx::query("DELETE FROM scheduled_meetings WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await
        .context("删除 scheduled_meeting 失败")?;
    Ok(())
}

// ── Reports ──────────────────────────────────────────────────────

use super::models::Report;

pub async fn save_report(pool: &SqlitePool, r: &Report) -> Result<()> {
    sqlx::query(
        "INSERT OR REPLACE INTO reports (id, period_type, period_label, content, created_at)
         VALUES (?, ?, ?, ?, ?)",
    )
    .bind(&r.id)
    .bind(&r.period_type)
    .bind(&r.period_label)
    .bind(&r.content)
    .bind(&r.created_at)
    .execute(pool)
    .await
    .context("保存报告失败")?;
    Ok(())
}

pub async fn list_reports(pool: &SqlitePool) -> Result<Vec<Report>> {
    sqlx::query_as::<_, Report>(
        "SELECT * FROM reports ORDER BY created_at DESC LIMIT 50",
    )
    .fetch_all(pool)
    .await
    .context("查询报告列表失败")
}

pub async fn delete_report(pool: &SqlitePool, id: &str) -> Result<()> {
    sqlx::query("DELETE FROM reports WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await
        .context("删除报告失败")?;
    Ok(())
}

// ── Agent Conversations ──────────────────────────────────────────

use super::models::{AgentConversation, AgentConversationSummary, AgentMessage};

pub async fn agent_create_conversation(pool: &SqlitePool, conv: &AgentConversation) -> Result<()> {
    sqlx::query(
        "INSERT INTO agent_conversations (id, title, summary, created_at) VALUES (?, ?, ?, ?)"
    )
        .bind(&conv.id)
        .bind(&conv.title)
        .bind(&conv.summary)
        .bind(&conv.created_at)
        .execute(pool)
        .await
        .context("创建对话失败")?;
    Ok(())
}

pub async fn agent_list_conversations(pool: &SqlitePool) -> Result<Vec<AgentConversationSummary>> {
    sqlx::query_as::<_, AgentConversationSummary>(
        "SELECT ac.id, ac.title, ac.created_at,
                (SELECT SUBSTR(am.content, 1, 100) FROM agent_messages am
                 WHERE am.conversation_id = ac.id AND am.role = 'user'
                 ORDER BY am.created_at DESC LIMIT 1) AS last_message
         FROM agent_conversations ac
         ORDER BY ac.created_at DESC"
    )
    .fetch_all(pool)
    .await
    .context("查询对话列表失败")
}

pub async fn agent_delete_conversation(pool: &SqlitePool, id: &str) -> Result<()> {
    sqlx::query("DELETE FROM agent_messages WHERE conversation_id = ?")
        .bind(id).execute(pool).await?;
    sqlx::query("DELETE FROM agent_conversations WHERE id = ?")
        .bind(id).execute(pool).await
        .context("删除对话失败")?;
    Ok(())
}

pub async fn agent_rename_conversation(pool: &SqlitePool, id: &str, title: &str) -> Result<()> {
    sqlx::query("UPDATE agent_conversations SET title = ? WHERE id = ?")
        .bind(title).bind(id).execute(pool).await
        .context("重命名对话失败")?;
    Ok(())
}

pub async fn agent_insert_message(pool: &SqlitePool, msg: &AgentMessage) -> Result<()> {
    sqlx::query(
        "INSERT INTO agent_messages (id, conversation_id, role, content, tool_calls, created_at)
         VALUES (?, ?, ?, ?, ?, ?)"
    )
    .bind(&msg.id).bind(&msg.conversation_id).bind(&msg.role)
    .bind(&msg.content).bind(&msg.tool_calls).bind(&msg.created_at)
    .execute(pool).await
    .context("插入消息失败")?;
    Ok(())
}

pub async fn agent_get_messages(pool: &SqlitePool, conversation_id: &str) -> Result<Vec<AgentMessage>> {
    sqlx::query_as::<_, AgentMessage>(
        "SELECT * FROM agent_messages WHERE conversation_id = ? ORDER BY created_at ASC"
    )
    .bind(conversation_id)
    .fetch_all(pool).await
    .context("查询消息失败")
}

pub async fn agent_auto_title(pool: &SqlitePool, conversation_id: &str) -> Result<()> {
    let first: Option<(String,)> = sqlx::query_as(
        "SELECT content FROM agent_messages WHERE conversation_id = ? AND role = 'user' ORDER BY created_at ASC LIMIT 1"
    )
    .bind(conversation_id)
    .fetch_optional(pool).await?;
    if let Some((content,)) = first {
        // Truncate at the first sentence-ending punctuation or at 30 chars
        let max_len = 30;
        let title = if content.len() <= max_len {
            content
        } else {
            let boundary = content[..max_len]
                .rfind(|c| c == '。' || c == '！' || c == '？' || c == '.' || c == '!' || c == '?')
                .map(|pos| pos + 1) // include the punctuation
                .filter(|&pos| pos > 5) // only if it's not a tiny fragment
                .unwrap_or_else(|| {
                    // No sentence boundary found — cut at word boundary
                    content[..max_len]
                        .rfind(|c: char| c.is_whitespace())
                        .map(|pos| pos)
                        .unwrap_or(max_len)
                });
            content[..boundary].to_string()
        };
        sqlx::query("UPDATE agent_conversations SET title = ? WHERE id = ?")
            .bind(&title).bind(conversation_id).execute(pool).await?;
    }
    Ok(())
}

/// Update the summary for a conversation (short-term memory compression result).
pub async fn agent_update_summary(pool: &SqlitePool, conversation_id: &str, summary: &str) -> Result<()> {
    sqlx::query("UPDATE agent_conversations SET summary = ? WHERE id = ?")
        .bind(summary)
        .bind(conversation_id)
        .execute(pool)
        .await
        .context("更新对话摘要失败")?;
    Ok(())
}

/// Get the stored summary for a conversation.
pub async fn agent_get_summary(pool: &SqlitePool, conversation_id: &str) -> Result<Option<String>> {
    let row: Option<(String,)> = sqlx::query_as(
        "SELECT summary FROM agent_conversations WHERE id = ?"
    )
    .bind(conversation_id)
    .fetch_optional(pool)
    .await?;
    Ok(row.and_then(|(s,)| {
        if s.is_empty() { None } else { Some(s) }
    }))
}

// ── Todo CRUD ──────────────────────────────────────────────────────

use super::models::TodoItem;

pub async fn todo_create(pool: &SqlitePool, t: &TodoItem) -> Result<()> {
    let result = sqlx::query(
        "INSERT INTO agent_todos (id, title, status, priority, deadline, source, created_at, schedule_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(&t.id).bind(&t.title).bind(&t.status)
    .bind(&t.priority).bind(&t.deadline).bind(&t.source)
    .bind(&t.created_at).bind(&t.schedule_id)
    .execute(pool).await;

    match result {
        Ok(_) => Ok(()),
        Err(sqlx::Error::Database(ref e)) if e.message().contains("no such table") => {
            // Table missing (e.g. old database), create it and retry
            sqlx::query(
                "CREATE TABLE IF NOT EXISTS agent_todos (
                    id          TEXT PRIMARY KEY,
                    title       TEXT NOT NULL,
                    status      TEXT NOT NULL DEFAULT 'pending',
                    priority    TEXT NOT NULL DEFAULT 'medium',
                    deadline    TEXT,
                    source      TEXT NOT NULL DEFAULT 'chat',
                    created_at  TEXT NOT NULL,
                    schedule_id TEXT
                )",
            )
            .execute(pool)
            .await
            .context("创建 agent_todos 表失败")?;

            sqlx::query(
                "INSERT INTO agent_todos (id, title, status, priority, deadline, source, created_at, schedule_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
            )
            .bind(&t.id).bind(&t.title).bind(&t.status)
            .bind(&t.priority).bind(&t.deadline).bind(&t.source)
            .bind(&t.created_at).bind(&t.schedule_id)
            .execute(pool).await
            .context("创建待办失败")?;
            Ok(())
        }
        Err(e) => Err(e).context("创建待办失败"),
    }
}

pub async fn todo_list(pool: &SqlitePool) -> Result<Vec<TodoItem>> {
    sqlx::query_as::<_, TodoItem>(
        "SELECT * FROM agent_todos ORDER BY
             CASE status WHEN 'pending' THEN 0 ELSE 1 END,
             CASE WHEN deadline IS NULL THEN 1 ELSE 0 END,
             deadline ASC,
             created_at DESC"
    )
    .fetch_all(pool).await
    .context("查询待办列表失败")
}

pub async fn todo_update_status(pool: &SqlitePool, id: &str, status: &str) -> Result<()> {
    sqlx::query("UPDATE agent_todos SET status = ? WHERE id = ?")
        .bind(status).bind(id).execute(pool).await
        .context("更新待办状态失败")?;
    Ok(())
}

pub async fn todo_delete(pool: &SqlitePool, id: &str) -> Result<()> {
    // If this todo is linked to a schedule, also delete the schedule
    let schedule_id: Option<String> = sqlx::query_scalar(
        "SELECT schedule_id FROM agent_todos WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
    .context("查询待办关联失败")?
    .flatten();

    if let Some(ref sid) = schedule_id {
        sqlx::query("DELETE FROM scheduled_meetings WHERE id = ?")
            .bind(sid)
            .execute(pool)
            .await
            .context("删除关联日程失败")?;
    }

    sqlx::query("DELETE FROM agent_todos WHERE id = ?")
        .bind(id).execute(pool).await
        .context("删除待办失败")?;
    Ok(())
}

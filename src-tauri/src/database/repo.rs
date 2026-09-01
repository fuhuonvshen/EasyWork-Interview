// EasyWork - 数据库操作
// 建表 + 增删查改。通过 sqlx 操作 SQLite。

use anyhow::{Context, Result};
use sqlx::sqlite::SqlitePool;
use sqlx::Row;
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

    // ── 面试语义迁移（Phase 1：EasyWork → 面试助手）──
    // kind: "meeting"(存量/会议) | "interview"(面试记录)
    sqlx::query("ALTER TABLE meetings ADD COLUMN kind TEXT NOT NULL DEFAULT 'meeting'")
        .execute(pool).await.ok();
    sqlx::query("ALTER TABLE meetings ADD COLUMN company TEXT")
        .execute(pool).await.ok();
    sqlx::query("ALTER TABLE meetings ADD COLUMN position TEXT")
        .execute(pool).await.ok();
    // stage: "phone" | "online" | "onsite" | "mock" | "offer"
    sqlx::query("ALTER TABLE meetings ADD COLUMN stage TEXT")
        .execute(pool).await.ok();
    sqlx::query("ALTER TABLE meetings ADD COLUMN score INTEGER")
        .execute(pool).await.ok();
    // 日程阶段: "apply" | "phone" | "online" | "onsite" | "offer"
    sqlx::query("ALTER TABLE scheduled_meetings ADD COLUMN stage TEXT NOT NULL DEFAULT 'apply'")
        .execute(pool).await.ok();
    // 对话角色: "general" | "review" | "resume"；ref_id 关联面试/简历
    sqlx::query("ALTER TABLE agent_conversations ADD COLUMN type TEXT NOT NULL DEFAULT 'general'")
        .execute(pool).await.ok();
    sqlx::query("ALTER TABLE agent_conversations ADD COLUMN ref_id TEXT")
        .execute(pool).await.ok();

    // 面试题库（AI 从面试转写中提取面试官问题，供复习）
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS interview_questions (
            id               TEXT PRIMARY KEY,
            category         TEXT NOT NULL,
            difficulty       TEXT NOT NULL DEFAULT 'medium',
            question         TEXT NOT NULL,
            expected_answer  TEXT,
            created_at       TEXT NOT NULL
        )",
    )
    .execute(pool)
    .await
    .context("创建 interview_questions 表失败")?;

    // 面试评估（AI 结构化输出）
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS interview_assessments (
            id           TEXT PRIMARY KEY,
            interview_id TEXT NOT NULL,
            dimensions   TEXT NOT NULL DEFAULT '{}',
            score        INTEGER,
            summary      TEXT,
            created_at   TEXT NOT NULL,
            FOREIGN KEY (interview_id) REFERENCES meetings(id)
        )",
    )
    .execute(pool)
    .await
    .context("创建 interview_assessments 表失败")?;

    // 我的简历（全局资产，最新一条为当前简历）
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS resumes (
            id          TEXT PRIMARY KEY,
            file_name   TEXT NOT NULL DEFAULT '',
            content     TEXT NOT NULL,
            created_at  TEXT NOT NULL,
            fields      TEXT
        )",
    )
    .execute(pool)
    .await
    .context("创建 resumes 表失败")?;
    // Migration: add fields column (AI 提取的结构化字段 JSON)
    sqlx::query("ALTER TABLE resumes ADD COLUMN fields TEXT")
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
    // 日程阶段 + 公司/岗位（AI 从会议通知提取）
    sqlx::query("ALTER TABLE scheduled_meetings ADD COLUMN stage TEXT NOT NULL DEFAULT 'one'")
        .execute(pool).await.ok();
    sqlx::query("ALTER TABLE scheduled_meetings ADD COLUMN company TEXT NOT NULL DEFAULT ''")
        .execute(pool).await.ok();
    sqlx::query("ALTER TABLE scheduled_meetings ADD COLUMN position TEXT NOT NULL DEFAULT ''")
        .execute(pool).await.ok();
    sqlx::query("ALTER TABLE scheduled_meetings ADD COLUMN notes TEXT NOT NULL DEFAULT ''")
        .execute(pool).await.ok();

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

    // 投递记录（与 OfferSubmit 扩展双向同步；updated_at 为新者胜合并依据）
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS apply_records (
            id         TEXT PRIMARY KEY,
            company    TEXT NOT NULL,
            position   TEXT NOT NULL DEFAULT '',
            url        TEXT NOT NULL DEFAULT '',
            site       TEXT NOT NULL DEFAULT '',
            status     TEXT NOT NULL DEFAULT 'pending',
            notes      TEXT NOT NULL DEFAULT '',
            applied_at INTEGER NOT NULL DEFAULT 0,
            updated_at INTEGER NOT NULL DEFAULT 0
        )",
    )
    .execute(pool)
    .await
    .context("创建 apply_records 表失败")?;
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_apply_records_updated_at ON apply_records(updated_at)")
        .execute(pool)
        .await
        .ok();

    // 删除墓碑（防对端旧数据复活）
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS sync_tombstones (
            id         TEXT PRIMARY KEY,
            deleted_at INTEGER NOT NULL
        )",
    )
    .execute(pool)
    .await
    .context("创建 sync_tombstones 表失败")?;

    // 公司库（投递工作台：名称/业务类型/招聘网站，内置清单 + 用户自定义）
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS companies (
            id         TEXT PRIMARY KEY,
            name       TEXT NOT NULL,
            industry   TEXT NOT NULL DEFAULT '',
            url        TEXT NOT NULL DEFAULT '',
            builtin    INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
        )",
    )
    .execute(pool)
    .await
    .context("创建 companies 表失败")?;
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_companies_name ON companies(name)")
        .execute(pool)
        .await
        .ok();

    // 首次启动 seed 内置公司清单（seed 版本 v2，仅一次整体替换；
    // 用户删除的内置公司不会重新出现）
    let seeded = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM settings WHERE key = 'companies_seeded_v2'")
        .fetch_one(pool)
        .await
        .unwrap_or(0);
    if seeded == 0 {
        let raw = include_str!("../apply/builtin_companies.json");
        let companies: Vec<serde_json::Value> = serde_json::from_str(raw)
            .context("解析内置公司清单失败")?;
        let mut tx = pool.begin().await.context("开始 seed 公司清单事务失败")?;
        // 旧版内置清单（v1）整体移除，保证 v2 全量替换
        sqlx::query("DELETE FROM companies WHERE builtin = 1")
            .execute(&mut *tx)
            .await
            .context("清理旧内置公司失败")?;
        let now = chrono::Local::now().to_rfc3339();
        for c in &companies {
            let name = c["name"].as_str().unwrap_or("").trim();
            let industry = c["industry"].as_str().unwrap_or("").trim();
            let url = c["url"].as_str().unwrap_or("").trim();
            if name.is_empty() {
                continue;
            }
            sqlx::query("INSERT OR IGNORE INTO companies (id, name, industry, url, builtin, created_at) VALUES (?, ?, ?, ?, 1, ?)")
                .bind(uuid::Uuid::new_v4().to_string())
                .bind(name)
                .bind(industry)
                .bind(url)
                .bind(&now)
                .execute(&mut *tx)
                .await
                .context("seed 公司清单失败")?;
        }
        sqlx::query("INSERT OR REPLACE INTO settings (key, value) VALUES ('companies_seeded_v2', '1')")
            .execute(&mut *tx)
            .await
            .context("标记公司清单 seed 状态失败")?;
        tx.commit().await.context("提交公司清单 seed 失败")?;
        log::info!("已 seed 内置公司清单（{} 家）", companies.len());
    }

    Ok(())
}

// ── Meeting CRUD ───────────────────────────────────────────────

pub async fn insert_meeting(pool: &SqlitePool, m: &Meeting) -> Result<()> {
    sqlx::query(
        "INSERT INTO meetings (id, title, created_at, duration_secs, wav_path, schedule_id, pinned, kind, company, position, stage, score)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&m.id)
    .bind(&m.title)
    .bind(&m.created_at)
    .bind(m.duration_secs)
    .bind(&m.wav_path)
    .bind(&m.schedule_id)
    .bind(m.pinned as i32)
    .bind(&m.kind)
    .bind(&m.company)
    .bind(&m.position)
    .bind(&m.stage)
    .bind(m.score)
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
            SUBSTR(min.content, 1, 200) AS first_line,
            m.pinned,
            m.kind,
            m.company,
            m.position,
            m.stage,
            m.score
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
                    SUBSTR(min.content, 1, 200) AS first_line,
                    m.kind, m.company, m.position, m.stage, m.score
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
                    SUBSTR(min.content, 1, 200) AS first_line,
                    m.kind, m.company, m.position, m.stage, m.score
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
            SUBSTR(min.content, 1, 200) AS first_line,
            m.pinned,
            m.kind,
            m.company,
            m.position,
            m.stage,
            m.score
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
                    SUBSTR(min.content, 1, 200) AS first_line,
                    m.kind, m.company, m.position, m.stage, m.score
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
                    SUBSTR(min.content, 1, 200) AS first_line,
                    m.kind, m.company, m.position, m.stage, m.score
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
    let row: Option<(String, String, Option<String>, String, String, Option<String>, Option<String>, Option<String>, Option<i64>)> = sqlx::query_as(
        "SELECT m.title, m.id, min.content, m.wav_path, m.kind, m.company, m.position, m.stage, m.score FROM meetings m \
         LEFT JOIN minutes min ON min.meeting_id = m.id \
         WHERE m.id = ?"
    )
    .bind(meeting_id)
    .fetch_optional(pool)
    .await
    .context("查询会议失败")?;
    Ok(row.map(|(title, id, content, wav_path, kind, company, position, stage, score)| super::models::MeetingDetail {
        id,
        title,
        content: content.unwrap_or_default(),
        wav_path,
        kind,
        company,
        position,
        stage,
        score,
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
        "INSERT INTO scheduled_meetings (id, title, zoom_url, start_time, end_time, created_at, stage, company, position, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&m.id)
    .bind(&m.title)
    .bind(&m.zoom_url)
    .bind(&m.start_time)
    .bind(&m.end_time)
    .bind(&m.created_at)
    .bind(&m.stage)
    .bind(&m.company)
    .bind(&m.position)
    .bind(&m.notes)
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
        "UPDATE scheduled_meetings SET title = ?, zoom_url = ?, start_time = ?, end_time = ?, stage = ?, company = ?, position = ?, notes = ? WHERE id = ?",
    )
    .bind(&m.title)
    .bind(&m.zoom_url)
    .bind(&m.start_time)
    .bind(&m.end_time)
    .bind(&m.stage)
    .bind(&m.company)
    .bind(&m.position)
    .bind(&m.notes)
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
        "INSERT INTO agent_conversations (id, title, summary, created_at, type, ref_id) VALUES (?, ?, ?, ?, ?, ?)"
    )
        .bind(&conv.id)
        .bind(&conv.title)
        .bind(&conv.summary)
        .bind(&conv.created_at)
        .bind(&conv.kind)
        .bind(&conv.ref_id)
        .execute(pool)
        .await
        .context("创建对话失败")?;
    Ok(())
}

/// 更新对话的角色/关联（创建后设置 type 与 ref_id）
pub async fn agent_update_conversation_meta(
    pool: &SqlitePool,
    id: &str,
    conv_type: &str,
    ref_id: Option<&str>,
) -> Result<()> {
    sqlx::query("UPDATE agent_conversations SET type = ?, ref_id = ? WHERE id = ?")
        .bind(conv_type)
        .bind(ref_id)
        .bind(id)
        .execute(pool)
        .await
        .context("更新对话角色失败")?;
    Ok(())
}

pub async fn agent_list_conversations(pool: &SqlitePool) -> Result<Vec<AgentConversationSummary>> {
    sqlx::query_as::<_, AgentConversationSummary>(
        "SELECT ac.id, ac.title, ac.created_at, ac.type, ac.ref_id,
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

// ── 面试（Interview）相关 ─────────────────────────────────────────

use super::models::{InterviewAssessment, InterviewQuestion};

/// 将一条 meeting 标记为面试记录并写入面试元信息。
/// 传 None 的字段保持不变（不覆盖已有值）。
pub async fn update_meeting_interview_info(
    pool: &SqlitePool,
    meeting_id: &str,
    company: Option<&str>,
    position: Option<&str>,
    stage: Option<&str>,
) -> Result<()> {
    sqlx::query(
        "UPDATE meetings SET kind = 'interview',
             company = COALESCE(?, company),
             position = COALESCE(?, position),
             stage = COALESCE(?, stage)
         WHERE id = ?",
    )
    .bind(company)
    .bind(position)
    .bind(stage)
    .bind(meeting_id)
    .execute(pool)
    .await
    .context("更新面试信息失败")?;
    Ok(())
}

/// 更新面试评分（meetings.score）
pub async fn update_meeting_score(pool: &SqlitePool, meeting_id: &str, score: Option<i64>) -> Result<()> {
    sqlx::query("UPDATE meetings SET score = ? WHERE id = ?")
        .bind(score)
        .bind(meeting_id)
        .execute(pool)
        .await
        .context("更新面试评分失败")?;
    Ok(())
}

/// 保存面试评估（AI 结构化输出），同一面试重复保存时覆盖旧评估
pub async fn save_interview_assessment(pool: &SqlitePool, a: &InterviewAssessment) -> Result<()> {
    sqlx::query(
        "INSERT OR REPLACE INTO interview_assessments (id, interview_id, dimensions, score, summary, created_at)
         VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(&a.id)
    .bind(&a.interview_id)
    .bind(&a.dimensions)
    .bind(a.score)
    .bind(&a.summary)
    .bind(&a.created_at)
    .execute(pool)
    .await
    .context("保存面试评估失败")?;
    Ok(())
}

pub async fn get_interview_assessment(pool: &SqlitePool, interview_id: &str) -> Result<Option<InterviewAssessment>> {
    let row = sqlx::query_as::<_, InterviewAssessment>(
        "SELECT * FROM interview_assessments WHERE interview_id = ? ORDER BY created_at DESC LIMIT 1",
    )
    .bind(interview_id)
    .fetch_optional(pool)
    .await
    .context("查询面试评估失败")?;
    Ok(row)
}

/// 面试题库 CRUD（AI 从面试转写提取的问题）
pub async fn insert_interview_question(pool: &SqlitePool, q: &InterviewQuestion) -> Result<()> {
    sqlx::query(
        "INSERT INTO interview_questions (id, category, difficulty, question, expected_answer, created_at, source_meeting_id, in_bank)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&q.id)
    .bind(&q.category)
    .bind(&q.difficulty)
    .bind(&q.question)
    .bind(&q.expected_answer)
    .bind(&q.created_at)
    .bind(&q.source_meeting_id)
    .bind(q.in_bank as i32)
    .execute(pool)
    .await
    .context("插入面试题失败")?;
    Ok(())
}

pub async fn list_interview_questions(
    pool: &SqlitePool,
    category: Option<&str>,
    limit: i64,
) -> Result<Vec<InterviewQuestion>> {
    let rows = if let Some(cat) = category {
        sqlx::query_as::<_, InterviewQuestion>(
            "SELECT * FROM interview_questions WHERE in_bank = 1 AND category = ? ORDER BY created_at DESC LIMIT ?",
        )
        .bind(cat)
        .bind(limit)
        .fetch_all(pool)
        .await
        .context("查询面试题失败")?
    } else {
        sqlx::query_as::<_, InterviewQuestion>(
            "SELECT * FROM interview_questions WHERE in_bank = 1 ORDER BY created_at DESC LIMIT ?",
        )
        .bind(limit)
        .fetch_all(pool)
        .await
        .context("查询面试题失败")?
    };
    Ok(rows)
}

/// 查询某场面试提取出的所有题目（含未入题库的待确认项）
pub async fn list_meeting_questions(
    pool: &SqlitePool,
    meeting_id: &str,
) -> Result<Vec<InterviewQuestion>> {
    let rows = sqlx::query_as::<_, InterviewQuestion>(
        "SELECT * FROM interview_questions WHERE source_meeting_id = ? ORDER BY created_at ASC",
    )
    .bind(meeting_id)
    .fetch_all(pool)
    .await
    .context("查询面试题目失败")?;
    Ok(rows)
}

/// 将选中的题目加入题库（in_bank = 1）
pub async fn add_questions_to_bank(pool: &SqlitePool, ids: &[String]) -> Result<usize> {
    if ids.is_empty() {
        return Ok(0);
    }
    let mut affected = 0usize;
    for id in ids {
        let r = sqlx::query("UPDATE interview_questions SET in_bank = 1 WHERE id = ?")
            .bind(id)
            .execute(pool)
            .await
            .context("加入题库失败")?;
        affected += r.rows_affected() as usize;
    }
    Ok(affected)
}

pub async fn delete_interview_question(pool: &SqlitePool, id: &str) -> Result<()> {
    sqlx::query("DELETE FROM interview_questions WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await
        .context("删除面试题失败")?;
    Ok(())
}

/// 手动修改题目内容（题库里的题允许用户纠正 AI 提取的内容）
pub async fn update_interview_question(
    pool: &SqlitePool,
    id: &str,
    category: &str,
    difficulty: &str,
    question: &str,
    expected_answer: Option<&str>,
) -> Result<()> {
    sqlx::query(
        "UPDATE interview_questions SET category = ?, difficulty = ?, question = ?, expected_answer = ? WHERE id = ?",
    )
    .bind(category)
    .bind(difficulty)
    .bind(question)
    .bind(expected_answer)
    .bind(id)
    .execute(pool)
    .await
    .context("更新面试题失败")?;
    Ok(())
}

// ── 简历（Resume）────────────────────────────────────────────

use super::models::Resume;

/// 保存一份新简历（追加一行，get_resume 取最新）
pub async fn save_resume(pool: &SqlitePool, file_name: &str, content: &str, fields: Option<&str>) -> Result<String> {
    let id = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO resumes (id, file_name, content, created_at, fields) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(file_name)
    .bind(content)
    .bind(chrono::Local::now().to_rfc3339())
    .bind(fields)
    .execute(pool)
    .await
    .context("保存简历失败")?;
    Ok(id)
}

/// 取最新一份简历
pub async fn get_resume(pool: &SqlitePool) -> Result<Option<Resume>> {
    let row = sqlx::query_as::<_, Resume>(
        "SELECT * FROM resumes ORDER BY created_at DESC LIMIT 1",
    )
    .fetch_optional(pool)
    .await
    .context("查询简历失败")?;
    Ok(row)
}

// ── 投递记录（Apply）────────────────────────────────────────────

use super::models::ApplyRecord;

/// 全部投递记录，按最近更新倒序
pub async fn apply_list_records(pool: &SqlitePool) -> Result<Vec<ApplyRecord>> {
    let rows = sqlx::query_as::<_, ApplyRecord>(
        "SELECT * FROM apply_records ORDER BY updated_at DESC",
    )
    .fetch_all(pool)
    .await
    .context("查询投递记录失败")?;
    Ok(rows)
}

/// 插入一条投递记录
pub async fn apply_insert_record(
    pool: &SqlitePool,
    rec: &ApplyRecord,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO apply_records (id, company, position, url, site, status, notes, applied_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&rec.id)
    .bind(&rec.company)
    .bind(&rec.position)
    .bind(&rec.url)
    .bind(&rec.site)
    .bind(&rec.status)
    .bind(&rec.notes)
    .bind(rec.applied_at)
    .bind(rec.updated_at)
    .execute(pool)
    .await
    .context("插入投递记录失败")?;
    Ok(())
}

/// 更新一条投递记录（传 None 的字段保持不变），并刷新 updated_at
pub async fn apply_update_record(
    pool: &SqlitePool,
    id: &str,
    company: Option<&str>,
    position: Option<&str>,
    url: Option<&str>,
    site: Option<&str>,
    status: Option<&str>,
    notes: Option<&str>,
) -> Result<()> {
    let now = chrono::Local::now().timestamp_millis();
    sqlx::query(
        "UPDATE apply_records SET
             company = COALESCE(?, company),
             position = COALESCE(?, position),
             url = COALESCE(?, url),
             site = COALESCE(?, site),
             status = COALESCE(?, status),
             notes = COALESCE(?, notes),
             updated_at = ?
         WHERE id = ?",
    )
    .bind(company)
    .bind(position)
    .bind(url)
    .bind(site)
    .bind(status)
    .bind(notes)
    .bind(now)
    .bind(id)
    .execute(pool)
    .await
    .context("更新投递记录失败")?;
    Ok(())
}

/// 删除一条投递记录并写入删除墓碑（防止对端同步时旧数据复活）
pub async fn apply_delete_record(pool: &SqlitePool, id: &str) -> Result<()> {
    let now = chrono::Local::now().timestamp_millis();
    sqlx::query("DELETE FROM apply_records WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await
        .context("删除投递记录失败")?;
    sqlx::query("INSERT OR REPLACE INTO sync_tombstones (id, deleted_at) VALUES (?, ?)")
        .bind(id)
        .bind(now)
        .execute(pool)
        .await
        .context("写入删除墓碑失败")?;
    Ok(())
}

/// 同步删除墓碑 id 列表
pub async fn apply_list_tombstones(pool: &SqlitePool) -> Result<Vec<String>> {
    let rows = sqlx::query("SELECT id FROM sync_tombstones")
        .fetch_all(pool)
        .await
        .context("查询删除墓碑失败")?;
    Ok(rows.into_iter().map(|r| r.get::<String, _>("id")).collect())
}

// ── 公司库（Company）────────────────────────────────────────────

use super::models::Company;

/// 全部公司，按名称排序
pub async fn company_list(pool: &SqlitePool) -> Result<Vec<Company>> {
    let rows = sqlx::query_as::<_, Company>(
        "SELECT * FROM companies ORDER BY name COLLATE NOCASE",
    )
    .fetch_all(pool)
    .await
    .context("查询公司列表失败")?;
    Ok(rows)
}

/// 插入一家公司
pub async fn company_insert(pool: &SqlitePool, name: &str, industry: &str, url: &str) -> Result<String> {
    let id = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO companies (id, name, industry, url, builtin, created_at) VALUES (?, ?, ?, ?, 0, ?)",
    )
    .bind(&id)
    .bind(name)
    .bind(industry)
    .bind(url)
    .bind(chrono::Local::now().to_rfc3339())
    .execute(pool)
    .await
    .context("新增公司失败")?;
    Ok(id)
}

/// 更新一家公司（None 字段保持不变）
pub async fn company_update(
    pool: &SqlitePool,
    id: &str,
    name: Option<&str>,
    industry: Option<&str>,
    url: Option<&str>,
) -> Result<()> {
    sqlx::query(
        "UPDATE companies SET
             name = COALESCE(?, name),
             industry = COALESCE(?, industry),
             url = COALESCE(?, url)
         WHERE id = ?",
    )
    .bind(name)
    .bind(industry)
    .bind(url)
    .bind(id)
    .execute(pool)
    .await
    .context("更新公司失败")?;
    Ok(())
}

/// 删除一家公司（含内置清单条目；删除后不重新 seed）
pub async fn company_delete(pool: &SqlitePool, id: &str) -> Result<()> {
    sqlx::query("DELETE FROM companies WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await
        .context("删除公司失败")?;
    Ok(())
}

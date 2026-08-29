"""Async SQLite database layer for agent conversations and messages.

Shares the same easywork.db file as the Rust backend. Uses aiosqlite for
non-blocking access. The Rust backend uses WAL mode, so concurrent
reads from Python are safe.
"""

from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone

import aiosqlite

from ..config import DB_PATH


class Database:
    """Async wrapper around the SQLite database for agent operations."""

    def __init__(self, db_path: str = DB_PATH):
        self.db_path = db_path
        self._conn: aiosqlite.Connection | None = None

    async def connect(self):
        self._conn = await aiosqlite.connect(self.db_path)
        self._conn.row_factory = aiosqlite.Row
        await self._conn.execute("PRAGMA journal_mode=WAL")
        await self._conn.execute("PRAGMA foreign_keys=ON")

        # Create tables if they don't exist (shared DB with Rust backend)
        await self._conn.execute(
            "CREATE TABLE IF NOT EXISTS agent_conversations ("
            "  id TEXT PRIMARY KEY,"
            "  title TEXT NOT NULL DEFAULT '',"
            "  summary TEXT NOT NULL DEFAULT '',"
            "  created_at TEXT NOT NULL"
            ")"
        )
        await self._conn.execute(
            "CREATE TABLE IF NOT EXISTS agent_messages ("
            "  id TEXT PRIMARY KEY,"
            "  conversation_id TEXT NOT NULL,"
            "  role TEXT NOT NULL,"
            "  content TEXT NOT NULL DEFAULT '',"
            "  tool_calls TEXT,"
            "  created_at TEXT NOT NULL,"
            "  FOREIGN KEY (conversation_id) REFERENCES agent_conversations(id)"
            ")"
        )
        # Ensure summary column exists (migration for older databases)
        try:
            await self._conn.execute(
                "ALTER TABLE agent_conversations ADD COLUMN summary TEXT NOT NULL DEFAULT ''"
            )
        except Exception:
            pass  # Column already exists

        # ── 面试语义迁移（与 Rust 侧 repo.rs 对齐）──
        # 对话角色: "general" | "mock" | "review" | "resume"
        try:
            await self._conn.execute(
                "ALTER TABLE agent_conversations ADD COLUMN type TEXT NOT NULL DEFAULT 'general'"
            )
        except Exception:
            pass  # Column already exists
        try:
            await self._conn.execute(
                "ALTER TABLE agent_conversations ADD COLUMN ref_id TEXT"
            )
        except Exception:
            pass  # Column already exists

        # 日程阶段
        try:
            await self._conn.execute(
                "ALTER TABLE scheduled_meetings ADD COLUMN stage TEXT NOT NULL DEFAULT 'apply'"
            )
        except Exception:
            pass  # Column already exists

        # 面试评估表（与 Rust 侧 repo.rs 对齐；Rust 启动时已建，这里防御性兜底）
        await self._conn.execute(
            "CREATE TABLE IF NOT EXISTS interview_assessments ("
            "  id TEXT PRIMARY KEY,"
            "  interview_id TEXT NOT NULL,"
            "  dimensions TEXT NOT NULL DEFAULT '{}',"
            "  score INTEGER,"
            "  summary TEXT,"
            "  created_at TEXT NOT NULL"
            ")"
        )
        # 面试题库表（AI 从面试转写提取的面试官问题）
        await self._conn.execute(
            "CREATE TABLE IF NOT EXISTS interview_questions ("
            "  id TEXT PRIMARY KEY,"
            "  category TEXT NOT NULL,"
            "  difficulty TEXT NOT NULL DEFAULT 'medium',"
            "  question TEXT NOT NULL,"
            "  expected_answer TEXT,"
            "  created_at TEXT NOT NULL"
            ")"
        )
        # 迁移：来源面试 + 是否已入题库（0=待确认，1=已入题库）
        try:
            await self._conn.execute(
                "ALTER TABLE interview_questions ADD COLUMN source_meeting_id TEXT"
            )
        except Exception:
            pass  # Column already exists
        try:
            await self._conn.execute(
                "ALTER TABLE interview_questions ADD COLUMN in_bank INTEGER NOT NULL DEFAULT 0"
            )
        except Exception:
            pass  # Column already exists

        # Ensure schedule_id column for linking todos to schedules
        try:
            await self._conn.execute(
                "ALTER TABLE agent_todos ADD COLUMN schedule_id TEXT"
            )
        except Exception:
            pass  # Column already exists

        await self._conn.execute(
            "CREATE TABLE IF NOT EXISTS settings ("
            "  key   TEXT PRIMARY KEY,"
            "  value TEXT NOT NULL DEFAULT ''"
            ")"
        )

        await self._conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_messages_conv_role_time "
            "ON agent_messages(conversation_id, role, created_at)"
        )
        await self._conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_messages_created_at "
            "ON agent_messages(created_at)"
        )
        await self._conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_conversations_created_at "
            "ON agent_conversations(created_at)"
        )

    async def close(self):
        if self._conn:
            await self._conn.close()
            self._conn = None

    @property
    def conn(self) -> aiosqlite.Connection:
        if self._conn is None:
            raise RuntimeError("Database not connected. Call await db.connect() first.")
        return self._conn

    # ── Conversations ──────────────────────────────────────────

    async def create_conversation(self, conv_type: str = "general",
                                  ref_id: str | None = None) -> str:
        conv_id = uuid.uuid4().hex
        now = datetime.now(timezone.utc).isoformat()
        await self.conn.execute(
            "INSERT INTO agent_conversations (id, title, summary, created_at, type, ref_id) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (conv_id, "", "", now, conv_type, ref_id),
        )
        await self.conn.commit()
        return conv_id

    async def update_conversation_meta(self, conv_id: str, conv_type: str,
                                       ref_id: str | None = None):
        """Set conversation role type and optional ref_id (linked interview/resume)."""
        await self.conn.execute(
            "UPDATE agent_conversations SET type = ?, ref_id = ? WHERE id = ?",
            (conv_type, ref_id, conv_id),
        )
        await self.conn.commit()

    async def get_conversation_meta(self, conv_id: str) -> dict | None:
        """Return {"type": ..., "ref_id": ...} for a conversation, or None."""
        cursor = await self.conn.execute(
            "SELECT type, ref_id FROM agent_conversations WHERE id = ?", (conv_id,)
        )
        row = await cursor.fetchone()
        return dict(row) if row else None

    async def list_conversations(self) -> list[dict]:
        cursor = await self.conn.execute(
            """SELECT ac.id, ac.title, ac.created_at, ac.type, ac.ref_id,
                      (SELECT SUBSTR(am.content, 1, 100) FROM agent_messages am
                       WHERE am.conversation_id = ac.id AND am.role = 'user'
                       ORDER BY am.created_at DESC LIMIT 1) AS last_message
               FROM agent_conversations ac
               ORDER BY ac.created_at DESC"""
        )
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]

    async def delete_conversation(self, conv_id: str):
        await self.conn.execute(
            "DELETE FROM agent_messages WHERE conversation_id = ?", (conv_id,)
        )
        await self.conn.execute(
            "DELETE FROM agent_conversations WHERE id = ?", (conv_id,)
        )
        await self.conn.commit()

    async def rename_conversation(self, conv_id: str, title: str):
        await self.conn.execute(
            "UPDATE agent_conversations SET title = ? WHERE id = ?",
            (title, conv_id),
        )
        await self.conn.commit()

    async def auto_title(self, conv_id: str):
        """Auto-title based on first user message (fallback when LLM not available)."""
        cursor = await self.conn.execute(
            "SELECT content FROM agent_messages WHERE conversation_id = ? AND role = 'user' ORDER BY created_at ASC LIMIT 1",
            (conv_id,),
        )
        row = await cursor.fetchone()
        if row:
            raw = row[0]
            # Strip file upload prefix to get the actual question
            cleaned = re.sub(r'^\[上传了文件:.*?\]\s*\n*', '', raw).strip()
            title = cleaned[:30] if cleaned else raw[:30]
            await self._set_title(conv_id, title)

    async def set_title_by_llm(self, conv_id: str, title: str):
        """Set a LLM-generated title (concise summary)."""
        if title and len(title) > 2:
            # Cap at 40 chars to avoid overly long titles
            await self._set_title(conv_id, title[:40])

    async def _set_title(self, conv_id: str, title: str):
        await self.conn.execute(
            "UPDATE agent_conversations SET title = ? WHERE id = ?",
            (title, conv_id),
        )
        await self.conn.commit()

    # ── Messages ───────────────────────────────────────────────

    async def insert_message(self, msg: dict):
        """Insert a message. Caller should commit() after a batch."""
        await self.conn.execute(
            "INSERT INTO agent_messages (id, conversation_id, role, content, tool_calls, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (
                msg["id"],
                msg["conversation_id"],
                msg["role"],
                msg["content"],
                msg.get("tool_calls"),
                msg["created_at"],
            ),
        )

    async def commit(self):
        """Explicit commit for batch operations."""
        await self.conn.commit()

    async def delete_message(self, msg_id: str):
        """Delete a single message by id."""
        await self.conn.execute(
            "DELETE FROM agent_messages WHERE id = ?", (msg_id,)
        )
        await self.conn.commit()

    async def get_messages(self, conv_id: str) -> list[dict]:
        cursor = await self.conn.execute(
            "SELECT * FROM agent_messages WHERE conversation_id = ? ORDER BY created_at ASC",
            (conv_id,),
        )
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]

    # ── Summary (short-term memory compression) ────────────────

    async def get_summary(self, conv_id: str) -> str | None:
        cursor = await self.conn.execute(
            "SELECT summary FROM agent_conversations WHERE id = ?", (conv_id,)
        )
        row = await cursor.fetchone()
        if row and row[0]:
            return row[0]
        return None

    async def update_summary(self, conv_id: str, summary: str):
        await self.conn.execute(
            "UPDATE agent_conversations SET summary = ? WHERE id = ?",
            (summary, conv_id),
        )
        await self.conn.commit()

    # ── Settings ────────────────────────────────────────────────

    async def get_setting(self, key: str) -> str | None:
        cursor = await self.conn.execute(
            "SELECT value FROM settings WHERE key = ?", (key,)
        )
        row = await cursor.fetchone()
        return row[0] if row else None

    # ── Todos ────────────────────────────────────────────────────

    async def insert_todo(self, title: str, deadline: str | None = None,
                          priority: str = "medium", source: str = "chat",
                          schedule_id: str | None = None) -> str:
        todo_id = uuid.uuid4().hex
        now = datetime.now(timezone.utc).isoformat()
        await self.conn.execute(
            "INSERT INTO agent_todos (id, title, status, priority, deadline, source, created_at, schedule_id) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (todo_id, title, "pending", priority, deadline, source, now, schedule_id),
        )
        await self.conn.commit()
        return todo_id

    async def list_todos(self) -> list[dict]:
        cursor = await self.conn.execute(
            "SELECT * FROM agent_todos ORDER BY "
            "CASE status WHEN 'pending' THEN 0 ELSE 1 END, "
            "CASE WHEN deadline IS NULL THEN 1 ELSE 0 END, "
            "deadline ASC, created_at DESC"
        )
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]

    async def update_todo_status(self, todo_id: str, status: str):
        await self.conn.execute(
            "UPDATE agent_todos SET status = ? WHERE id = ?",
            (status, todo_id),
        )
        await self.conn.commit()

    async def delete_todo(self, todo_id: str):
        await self.conn.execute(
            "DELETE FROM agent_todos WHERE id = ?", (todo_id,)
        )
        await self.conn.commit()

    # ── Schedules (agent-created) ──────────────────────────────────

    async def insert_schedule(self, title: str, start_time: str,
                              end_time: str | None = None,
                              zoom_url: str = "", stage: str = "apply") -> str:
        sched_id = uuid.uuid4().hex
        now = datetime.now(timezone.utc).isoformat()
        end = end_time or ""
        await self.conn.execute(
            "INSERT INTO scheduled_meetings (id, title, zoom_url, start_time, end_time, created_at, stage) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (sched_id, title, zoom_url, start_time, end, now, stage),
        )
        await self.conn.commit()
        return sched_id

    async def delete_schedule(self, sched_id: str):
        """Delete a schedule and its linked todo."""
        await self.conn.execute(
            "DELETE FROM agent_todos WHERE schedule_id = ?", (sched_id,)
        )
        await self.conn.execute(
            "DELETE FROM scheduled_meetings WHERE id = ?", (sched_id,)
        )
        await self.conn.commit()

    async def list_schedules(self) -> list[dict]:
        cursor = await self.conn.execute(
            "SELECT * FROM scheduled_meetings ORDER BY start_time ASC"
        )
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]

    async def update_schedule(self, sched_id: str, title: str,
                              start_time: str, end_time: str = "",
                              zoom_url: str = "", stage: str = "apply") -> None:
        await self.conn.execute(
            "UPDATE scheduled_meetings SET title = ?, zoom_url = ?, start_time = ?, end_time = ?, stage = ? WHERE id = ?",
            (title, zoom_url, start_time, end_time, stage, sched_id),
        )
        # Sync linked todo
        await self.conn.execute(
            "UPDATE agent_todos SET title = ?, deadline = ? WHERE schedule_id = ?",
            (title, start_time[:10], sched_id),
        )
        await self.conn.commit()

    # ── 面试（Interview）数据读取（供 review 复盘 / 工具使用）─────────

    async def get_interview_context(self, interview_id: str) -> dict | None:
        """返回面试的元信息 + 转写 + 纪要，供复盘分析注入上下文。

        Returns:
            {"id", "title", "company", "position", "stage", "score",
             "transcript", "minutes"} 或 None
        """
        cursor = await self.conn.execute(
            "SELECT id, title, created_at, company, position, stage, score "
            "FROM meetings WHERE id = ?", (interview_id,)
        )
        row = await cursor.fetchone()
        if row is None:
            return None
        meta = dict(row)
        # transcript
        cursor = await self.conn.execute(
            "SELECT content FROM transcripts WHERE meeting_id = ?", (interview_id,)
        )
        trow = await cursor.fetchone()
        meta["transcript"] = trow[0] if trow else ""
        # minutes
        cursor = await self.conn.execute(
            "SELECT content FROM minutes WHERE meeting_id = ?", (interview_id,)
        )
        mrow = await cursor.fetchone()
        meta["minutes"] = mrow[0] if mrow else ""
        return meta

    async def save_assessment(self, interview_id: str, dimensions: str,
                              score: int | None, summary: str | None) -> None:
        """保存 AI 面试评估（与 Rust 侧 interview_assessments 表一致）。"""
        assess_id = uuid.uuid4().hex
        now = datetime.now(timezone.utc).isoformat()
        await self.conn.execute(
            "INSERT OR REPLACE INTO interview_assessments "
            "(id, interview_id, dimensions, score, summary, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (assess_id, interview_id, dimensions, score, summary, now),
        )
        if score is not None:
            await self.conn.execute(
                "UPDATE meetings SET score = ? WHERE id = ?", (score, interview_id)
            )
        await self.conn.commit()

    async def list_questions(self, category: str | None = None,
                             limit: int = 50) -> list[dict]:
        if category:
            cursor = await self.conn.execute(
                "SELECT * FROM interview_questions WHERE in_bank = 1 AND category = ? "
                "ORDER BY created_at DESC LIMIT ?", (category, limit)
            )
        else:
            cursor = await self.conn.execute(
                "SELECT * FROM interview_questions WHERE in_bank = 1 "
                "ORDER BY created_at DESC LIMIT ?",
                (limit,),
            )
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]


# Singleton for the FastAPI app
db: Database = Database()

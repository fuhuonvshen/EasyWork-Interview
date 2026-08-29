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

    async def create_conversation(self) -> str:
        conv_id = uuid.uuid4().hex
        now = datetime.now(timezone.utc).isoformat()
        await self.conn.execute(
            "INSERT INTO agent_conversations (id, title, summary, created_at) VALUES (?, ?, ?, ?)",
            (conv_id, "", "", now),
        )
        await self.conn.commit()
        return conv_id

    async def list_conversations(self) -> list[dict]:
        cursor = await self.conn.execute(
            """SELECT ac.id, ac.title, ac.created_at,
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
                              zoom_url: str = "") -> str:
        sched_id = uuid.uuid4().hex
        now = datetime.now(timezone.utc).isoformat()
        end = end_time or ""
        await self.conn.execute(
            "INSERT INTO scheduled_meetings (id, title, zoom_url, start_time, end_time, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (sched_id, title, zoom_url, start_time, end, now),
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
                              zoom_url: str = "") -> None:
        await self.conn.execute(
            "UPDATE scheduled_meetings SET title = ?, zoom_url = ?, start_time = ?, end_time = ? WHERE id = ?",
            (title, zoom_url, start_time, end_time, sched_id),
        )
        # Sync linked todo
        await self.conn.execute(
            "UPDATE agent_todos SET title = ?, deadline = ? WHERE schedule_id = ?",
            (title, start_time[:10], sched_id),
        )
        await self.conn.commit()


# Singleton for the FastAPI app
db: Database = Database()

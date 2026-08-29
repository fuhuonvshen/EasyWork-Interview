"""Todo tool handler — creates, lists, updates, and deletes todos and schedules.
Called directly by the ReAct loop — no code generation needed.
"""

import re

from ...data.database import db


def _validate_date(text: str) -> str | None:
    """Accept only strict YYYY-MM-DD format; rejects relative dates."""
    if not text or not text.strip():
        return None
    m = re.match(r"^\d{4}-\d{2}-\d{2}$", text.strip())
    if m:
        return m.group(0)
    return None


SCHEMA = {
    "type": "function",
    "function": {
        "name": "todo",
        "description": "创建、查看、更新或删除待办事项，以及创建会议日程。当用户说「记一下、提醒我、别忘了、帮我记、安排会议」时调用。",
        "parameters": {
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["create", "list", "update_status", "delete", "create_schedule", "delete_schedule", "update_schedule", "list_schedules"],
                    "description": "操作类型",
                },
                "title": {
                    "type": "string",
                    "description": "待办或会议标题（create/create_schedule 时必填）",
                },
                "deadline": {
                    "type": "string",
                    "description": "截止日期（可选），必须使用 YYYY-MM-DD 格式（如 2026-07-22），不要用'今天''明天'等相对时间",
                },
                "priority": {
                    "type": "string",
                    "enum": ["high", "medium", "low"],
                    "description": "优先级（可选，默认 medium）",
                },
                "id": {
                    "type": "string",
                    "description": "待办ID（update_status/delete 时必填）",
                },
                "status": {
                    "type": "string",
                    "enum": ["pending", "done"],
                    "description": "目标状态（update_status 时可选，默认 done）",
                },
                "start_time": {
                    "type": "string",
                    "description": "会议开始时间（create_schedule 时必填），必须使用 YYYY-MM-DDTHH:MM 格式（如 2026-07-22T15:00），不要用相对时间",
                },
                "end_time": {
                    "type": "string",
                    "description": "会议结束时间（可选），格式 YYYY-MM-DDTHH:MM",
                },
                "zoom_url": {
                    "type": "string",
                    "description": "会议链接（可选）",
                },
            },
            "required": ["action"],
        },
    },
}


async def handle(args: dict) -> str:
    action = args.get("action", "")

    if action == "create":
        title = (args.get("title") or "").strip()
        if not title:
            return "❌ 创建待办失败：缺少标题"
        deadline = args.get("deadline", "")
        if deadline:
            deadline = _validate_date(deadline)
            if deadline is None:
                return f"❌ 截止日期格式错误：'{args['deadline']}' 不是有效日期，请使用 YYYY-MM-DD 格式（如 2026-07-22），不要使用相对时间"
        priority = args.get("priority", "medium")
        await db.insert_todo(title, deadline, priority, source="chat")
        return f"✅ 已创建待办「{title}」（优先级: {priority}）"

    elif action == "list":
        todos = await db.list_todos()
        if not todos:
            return "📋 暂无待办事项"
        lines = ["📋 待办列表："]
        for t in todos:
            mark = "✅" if t["status"] == "done" else "⬜"
            pri = {"high": "🔴高", "medium": "🟡中", "low": "🟢低"}.get(t.get("priority", "medium"), "")
            dl = f" 截止: {t['deadline']}" if t.get("deadline") else ""
            lines.append(f"{mark} [{pri}] {t['title']}{dl}")
        return "\n".join(lines)

    elif action == "update_status":
        todo_id = args.get("id")
        status = args.get("status", "done")
        if not todo_id:
            return "❌ 更新失败：缺少待办ID"
        await db.update_todo_status(todo_id, status)
        return f"✅ 待办状态已更新为「{'已完成' if status == 'done' else '待处理'}」"

    elif action == "delete":
        todo_id = args.get("id")
        if not todo_id:
            return "❌ 删除失败：缺少待办ID"
        await db.delete_todo(todo_id)
        return "✅ 已删除待办"

    elif action == "create_schedule":
        title = (args.get("title") or "").strip()
        start_time = args.get("start_time", "")
        if not title or not start_time:
            return "❌ 创建日程失败：缺少标题或开始时间"
        end_time = args.get("end_time") or ""
        if end_time and end_time < start_time:
            return "❌ 创建日程失败：结束时间早于开始时间"
        zoom_url = args.get("zoom_url", "")
        sched_id = await db.insert_schedule(title, start_time, end_time, zoom_url)
        # Also create a linked todo as reminder
        await db.insert_todo(
            title=title,
            deadline=start_time[:10],
            priority="medium",
            source="meeting",
            schedule_id=sched_id,
        )
        return f"✅ 已创建日程「{title}」（{start_time}）并添加了待办提醒"

    elif action == "delete_schedule":
        sched_id = args.get("id")
        if not sched_id:
            return "❌ 删除日程失败：缺少日程ID"
        await db.delete_schedule(sched_id)
        return "✅ 已删除日程及关联的待办提醒"

    elif action == "update_schedule":
        sched_id = args.get("id")
        title = (args.get("title") or "").strip()
        start_time = args.get("start_time", "")
        if not sched_id or not title or not start_time:
            return "❌ 修改日程失败：缺少日程ID、标题或开始时间"
        end_time = args.get("end_time", "")
        zoom_url = args.get("zoom_url", "")
        await db.update_schedule(sched_id, title, start_time, end_time, zoom_url)
        return f"✅ 已修改日程「{title}」（{start_time}）及关联的待办提醒"

    elif action == "list_schedules":
        schedules = await db.list_schedules()
        if not schedules:
            return "暂无日程"
        lines = ["日程列表："]
        for s in schedules:
            lines.append(f"- {s['title']}（{s['start_time']}）[ID: {s['id'][:8]}]")
        return "\n".join(lines)

    return f"❌ 未知操作: {action}"

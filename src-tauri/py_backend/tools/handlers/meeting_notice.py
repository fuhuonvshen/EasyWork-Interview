"""meeting_notice tool — parse pasted meeting email/notification and create a schedule.

Dedicated to the "paste meeting email → auto schedule" flow: extracts
company/position/stage/time/link and creates a calendar entry + todo reminder.
"""

from ...data.database import db

STAGE_LABEL = {"hr": "HR面", "one": "一面", "two": "二面", "three": "三面"}

SCHEMA = {
    "type": "function",
    "function": {
        "name": "meeting_notice",
        "description": (
            "解析用户粘贴的会议邮件或会议通知，提取结构化信息（公司/岗位/面试阶段/时间/链接）"
            "并创建日程和待办提醒。当用户发送包含会议时间、公司、岗位等信息的会议通知文本时调用；"
            "普通的待办记录请使用 todo 工具。"
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "company": {
                    "type": "string",
                    "description": "公司名称（如 XX科技）。从通知中提取，无法确定时填空字符串",
                },
                "position": {
                    "type": "string",
                    "description": "岗位名称（如 前端工程师）。从通知中提取，无法确定时填空字符串",
                },
                "stage": {
                    "type": "string",
                    "enum": ["hr", "one", "two", "three"],
                    "description": "面试阶段（可选）：hr=HR面, one=一面, two=二面, three=三面。通知中明确说明轮次时填写",
                },
                "start_time": {
                    "type": "string",
                    "description": "开始时间（必填），必须使用 YYYY-MM-DDTHH:MM 格式（如 2026-07-22T15:00），通知中的「今天/明天」等相对时间需换算为绝对日期",
                },
                "end_time": {
                    "type": "string",
                    "description": "结束时间（可选），格式 YYYY-MM-DDTHH:MM",
                },
                "zoom_url": {
                    "type": "string",
                    "description": "会议链接（可选，腾讯会议/飞书/Teams 等链接）",
                },
                "notes": {
                    "type": "string",
                    "description": "其他要点（可选）：面试官姓名、需准备的材料、会议主题、特别提醒等",
                },
            },
            "required": ["start_time"],
        },
    },
}


async def handle(args: dict) -> str:
    start_time = (args.get("start_time") or "").strip()
    if not start_time:
        return "❌ 创建日程失败：缺少开始时间"

    company = (args.get("company") or "").strip()
    position = (args.get("position") or "").strip()
    stage = (args.get("stage") or "one").strip()
    if stage not in STAGE_LABEL:
        stage = "one"
    end_time = (args.get("end_time") or "").strip()
    if end_time and end_time < start_time:
        return "❌ 创建日程失败：结束时间早于开始时间"
    zoom_url = (args.get("zoom_url") or "").strip()
    notes = (args.get("notes") or "").strip()

    # 标题：公司-岗位-阶段（如 XX科技-前端工程师-一面）
    parts = [p for p in [company, position] if p]
    if stage != "one":
        parts.append(STAGE_LABEL[stage])
    title = "-".join(parts) if parts else "面试会议"

    sched_id = await db.insert_schedule(title, start_time, end_time, zoom_url, stage, company, position, notes)
    # 关联待办提醒
    await db.insert_todo(
        title=title,
        deadline=start_time[:10],
        priority="medium",
        source="meeting",
        schedule_id=sched_id,
    )
    extra = f"（{company}·{position}）" if company or position else ""
    notes_txt = f"；备注：{notes}" if notes else ""
    return f"✅ 已根据会议通知创建日程「{title}」{extra}（{start_time}）并添加待办提醒{notes_txt}"

"""interview_summary tool handler — reads a recorded interview's transcript & minutes.

Lets the agent pull the actual transcript/minutes of a recorded interview
(e.g. for review conversations or cross-interview analysis).
"""

from ...data.database import db


SCHEMA = {
    "type": "function",
    "function": {
        "name": "interview_summary",
        "description": (
            "读取指定面试记录的转写与纪要内容。当用户提到某场已录制的面试"
            "（如\"复盘上周五的面试\"\"看看我在XX公司的面试表现\"）且需要其原始内容时调用。"
            "interview_id 为面试记录的 ID（可在面试历史中查看）。"
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "interview_id": {
                    "type": "string",
                    "description": "面试记录 ID（meetings.id）",
                },
                "include_transcript": {
                    "type": "boolean",
                    "description": "是否返回完整转写（默认 true，内容较长时 LLM 会自动截断）",
                },
            },
            "required": ["interview_id"],
        },
    },
}


async def handle(args: dict) -> str:
    interview_id = (args.get("interview_id") or "").strip()
    if not interview_id:
        return "❌ 读取面试记录失败：缺少 interview_id"

    ctx = await db.get_interview_context(interview_id)
    if ctx is None:
        return f"❌ 未找到面试记录：{interview_id}（可能已被删除）"

    lines = [
        f"📄 面试: {ctx.get('title') or '未命名'}",
        f"公司: {ctx.get('company') or '未知'} | 岗位: {ctx.get('position') or '未知'}"
        + (f" | 阶段: {ctx.get('stage')}" if ctx.get("stage") else ""),
        f"时间: {ctx.get('created_at', '')[:16]}",
    ]
    minutes = (ctx.get("minutes") or "").strip()
    if minutes:
        lines.append(f"\n--- 面试纪要 ---\n{minutes[:3000]}")
    transcript = (ctx.get("transcript") or "").strip()
    if transcript and args.get("include_transcript", True):
        lines.append(f"\n--- 转写内容 ---\n{transcript[:8000]}")
    return "\n".join(lines)

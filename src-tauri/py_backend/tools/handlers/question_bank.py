"""question_bank tool handler — manages the interview question bank.

The bank collects questions the interviewer actually asked (extracted by the
review analyst from real interview transcripts). The agent can list questions
by category (for targeted preparation) and add questions the user confirms.
"""

import uuid
from datetime import datetime, timezone

from ...data.database import db

SCHEMA = {
    "type": "function",
    "function": {
        "name": "question_bank",
        "description": (
            "管理面试题库：按分类列出面试题，或把用户确认过的真实面试问题加入题库。"
            "当用户说\"题库里有什么\"\"出几道XX题\"\"把这道题记下来/加入题库\"时调用。"
            "注意：题库只收录真实面试中出现过的问题（由复盘分析提取或用户确认），不要编造题目。"
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["list", "add"],
                    "description": "操作类型：list 列出题库；add 添加新题",
                },
                "category": {
                    "type": "string",
                    "description": "题目分类（如 算法/数据库/前端/项目/HR 等）",
                },
                "question": {
                    "type": "string",
                    "description": "题目内容（add 时必填）",
                },
                "difficulty": {
                    "type": "string",
                    "enum": ["easy", "medium", "hard"],
                    "description": "难度（可选，默认 medium）",
                },
                "expected_answer": {
                    "type": "string",
                    "description": "参考回答要点（可选）",
                },
            },
            "required": ["action"],
        },
    },
}


async def handle(args: dict) -> str:
    action = args.get("action", "")

    if action == "list":
        category = args.get("category") or None
        questions = await db.list_questions(category=category, limit=50)
        if not questions:
            if category:
                return f"📚 「{category}」分类下暂无题目"
            return "📚 题库为空——复盘真实面试后，AI 会自动提取面试官的问题到题库"
        lines = [f"📚 面试题库（{category or '全部'}，共 {len(questions)} 题）："]
        for q in questions:
            diff = {"easy": "简单", "medium": "中等", "hard": "困难"}.get(q.get("difficulty", "medium"), "")
            lines.append(f"- [{q['category']}/{diff}] {q['question']}")
        return "\n".join(lines)

    elif action == "add":
        question = (args.get("question") or "").strip()
        if not question:
            return "❌ 添加题目失败：缺少 question 内容"
        category = (args.get("category") or "其他").strip()
        difficulty = args.get("difficulty", "medium")
        if difficulty not in ("easy", "medium", "hard"):
            difficulty = "medium"
        expected_answer = (args.get("expected_answer") or "").strip() or None
        now = datetime.now(timezone.utc).isoformat()
        await db.conn.execute(
            "INSERT INTO interview_questions "
            "(id, category, difficulty, question, expected_answer, created_at, source_meeting_id, in_bank) "
            "VALUES (?, ?, ?, ?, ?, ?, NULL, 1)",
            (uuid.uuid4().hex, category, difficulty, question, expected_answer, now),
        )
        await db.conn.commit()
        return f"✅ 已加入题库 [{category}/{difficulty}]：{question}"

    return f"❌ 未知操作: {action}"
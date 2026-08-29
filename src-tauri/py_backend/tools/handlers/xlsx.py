"""Xlsx tool handler — handles common Excel operations directly.
For complex operations (charting, formulas, formatting), the handler
returns instructions for the LLM to generate code — those cases are
too varied for pre-defined parameters.
"""

import json
from pathlib import Path

from ...config import AGENT_INPUT_DIR, AGENT_OUTPUT_DIR
from ..file_preview import read_excel_preview

SCHEMA = {
    "type": "function",
    "function": {
        "name": "xlsx",
        "description": "读取 Excel/CSV 文件内容，查看结构和预览数据。如需创建图表、修改格式、添加公式等复杂操作，请参考此工具返回的操作指南。",
        "parameters": {
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["read", "analyze", "convert_csv"],
                    "description": "操作类型",
                },
                "file_path": {
                    "type": "string",
                    "description": "文件路径",
                },
                "query": {
                    "type": "string",
                    "description": "分析需求描述（analyze 时填写）",
                },
                "output_format": {
                    "type": "string",
                    "enum": ["xlsx", "csv"],
                    "description": "输出格式（convert_csv 时填写）",
                },
            },
            "required": ["action", "file_path"],
        },
    },
}


async def handle(args: dict) -> str:
    action = args.get("action", "")
    file_path = args.get("file_path", "")

    if not file_path:
        return "❌ 缺少文件路径"

    # Resolve file path: check agent_input first, then as-is
    p = Path(file_path)
    if not p.exists():
        p = Path(AGENT_INPUT_DIR) / file_path
    if not p.exists():
        return f"❌ 找不到文件: {file_path}"

    if action == "read":
        preview = read_excel_preview(str(p))
        return f"📊 文件: {p.name}\n\n{preview}"

    elif action == "analyze":
        import pandas as pd
        ext = p.suffix.lower()
        try:
            if ext == ".csv":
                df = pd.read_csv(str(p))
            else:
                df = pd.read_excel(str(p))
        except Exception as e:
            return f"❌ 读取失败: {e}"
        info = [
            f"📊 文件: {p.name}",
            f"行数: {len(df)}, 列数: {len(df.columns)}",
            f"列名: {', '.join(str(c) for c in df.columns)}",
            "",
            "数据预览:",
            df.head(10).to_string(),
        ]
        return "\n".join(info)

    elif action == "convert_csv":
        import pandas as pd
        ext = p.suffix.lower()
        try:
            if ext == ".csv":
                df = pd.read_csv(str(p))
            else:
                df = pd.read_excel(str(p))
            from datetime import date
            today = date.today().strftime("%Y%m%d")
            output = Path(AGENT_OUTPUT_DIR) / f"{p.stem}_{today}.csv"
            df.to_csv(str(output), index=False)
            return f"✅ 已转换: {output}"
        except Exception as e:
            return f"❌ 转换失败: {e}"

    return f"❌ 未知操作: {action}"

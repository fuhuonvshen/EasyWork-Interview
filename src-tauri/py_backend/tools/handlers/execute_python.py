"""Execute Python code via the executor (replaces text-parsed ```python blocks)."""

from ..executor import executor

SCHEMA = {
    "type": "function",
    "function": {
        "name": "execute_python",
        "description": "执行 Python 代码并返回运行结果。用于数据分析、文件处理、图表生成等编程任务。",
        "parameters": {
            "type": "object",
            "properties": {
                "code": {
                    "type": "string",
                    "description": "要执行的 Python 代码",
                },
                "timeout": {
                    "type": "integer",
                    "description": "执行超时时间（秒），默认 60",
                },
            },
            "required": ["code"],
        },
    },
}


async def handle(args: dict) -> str:
    code = (args.get("code") or "").strip()
    if not code:
        return "[错误] 未提供 code 参数，请包含要执行的 Python 代码"
    timeout = args.get("timeout", 60)
    result = await executor.execute(code, timeout=int(timeout))
    return result

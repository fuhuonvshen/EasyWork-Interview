"""Email tool handler — generates .eml files directly.
No code generation needed for standard email operations.
"""

import json
import logging
import string
from pathlib import Path

logger = logging.getLogger("agent.email_handler")


class _SafeFormatter(string.Formatter):
    """Return empty string for missing placeholder keys instead of KeyError."""
    def get_field(self, field_name, args, kwargs):
        try:
            return super().get_field(field_name, args, kwargs)
        except (KeyError, IndexError):
            return "", field_name

from ...config import AGENT_OUTPUT_DIR
from ..email import generate_eml, generate_html_preview, read_recipients

SCHEMA = {
    "type": "function",
    "function": {
        "name": "email",
        "description": "生成 .eml 邮件文件。可以单发或批量生成。生成的 .eml 文件双击即可在 Outlook 中打开。",
        "parameters": {
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["generate_single", "generate_batch", "preview"],
                    "description": "操作类型",
                },
                "to": {
                    "type": "string",
                    "description": "收件人邮箱（generate_single 时必填）",
                },
                "subject": {
                    "type": "string",
                    "description": "邮件主题（generate_single 时必填）",
                },
                "body_html": {
                    "type": "string",
                    "description": "邮件正文 HTML（generate_single 时必填）",
                },
                "cc": {
                    "type": "string",
                    "description": "抄送邮箱（可选）",
                },
                "recipient_file": {
                    "type": "string",
                    "description": "收件人列表文件路径（generate_batch 时必填），需包含 姓名/邮箱 列",
                },
                "body_template": {
                    "type": "string",
                    "description": "邮件正文 HTML 模板，用 {name} {line} 等占位符（generate_batch 时必填）",
                },
                "subject_template": {
                    "type": "string",
                    "description": "邮件主题模板，用 {name} {line} 等占位符（generate_batch 时必填）",
                },
                "from_addr": {
                    "type": "string",
                    "description": "发件人邮箱地址（可选，默认从配置读取）",
                },
            },
            "required": ["action"],
        },
    },
}


async def handle(args: dict) -> str:
    action = args.get("action", "")

    # Resolve sender — prefer arg, then DB setting, then default
    from_addr = args.get("from_addr") or ""
    if not from_addr:
        try:
            from ...data.database import db
            val = await db.get_setting("user_email")
            if val:
                from_addr = val
        except Exception:
            pass

    if action == "generate_single":
        to = args.get("to", "").strip()
        subject = args.get("subject", "").strip()
        body_html = args.get("body_html", "").strip()
        if not to or not subject or not body_html:
            return "❌ 缺少必填参数：to / subject / body_html"
        cc = args.get("cc")
        from datetime import date
        today = date.today().strftime("%Y%m%d")
        safe_name = to.split("@")[0].replace(".", "_")
        output = Path(AGENT_OUTPUT_DIR) / f"email_{safe_name}_{today}.eml"
        generate_eml(to, subject, body_html, cc=cc, output_path=str(output), from_addr=from_addr)
        return f"✅ 已生成邮件: {output}"

    elif action == "generate_batch":
        recipient_file = args.get("recipient_file", "")
        subject_template = args.get("subject_template", "")
        body_template = args.get("body_template", "")
        if not recipient_file or not subject_template or not body_template:
            return "❌ 缺少必填参数：recipient_file / subject_template / body_template"
        recipients = read_recipients(recipient_file)
        if not recipients:
            return "❌ 收件人列表为空"
        from datetime import date
        today = date.today().strftime("%Y%m%d")
        _fmt = _SafeFormatter().format
        generated = []
        preview_rows = []
        for r in recipients:
            email = r.get("email", "")
            if not email:
                logger.warning("[email] Skipping recipient with no email: %s", r.get("姓名", "unknown"))
                continue
            subject = _fmt(subject_template, **r, date=today)
            body = _fmt(body_template, **r, date=today)
            safe_name = r.get("姓名", email.split("@")[0]).replace(" ", "_")
            output = Path(AGENT_OUTPUT_DIR) / f"email_{safe_name}_{today}.eml"
            generate_eml(
                to=email,
                subject=subject,
                body_html=body,
                cc=r.get("CC"),
                output_path=str(output),
                from_addr=from_addr,
            )
            generated.append(output.name)
            body_snippet = body[:120].replace("\n", " ").strip() + ("..." if len(body) > 120 else "")
            preview_rows.append((r.get("姓名", ""), email, subject, body_snippet))

        # Generate a summary preview HTML
        rows_html = "".join(
            f"<tr><td>{name}</td><td>{to}</td><td>{subj}</td><td>{snippet}</td></tr>"
            for name, to, subj, snippet in preview_rows
        )
        preview_html = (
            "<html><meta charset='utf-8'><body>"
            f"<h2>批量邮件生成本 — {today}</h2>"
            f"<p>共生成 {len(generated)} 封</p>"
            "<table border='1' cellpadding='6' style='border-collapse:collapse'>"
            "<tr><th>收件人</th><th>邮箱</th><th>主题</th><th>正文预览</th></tr>"
            f"{rows_html}</table></body></html>"
        )
        preview_path = Path(AGENT_OUTPUT_DIR) / f"email_batch_preview_{today}.html"
        preview_path.write_text(preview_html, encoding="utf-8")

        return (
            f"✅ 已批量生成 {len(generated)} 封邮件。\n"
            f"预览: {preview_path}\n"
            f"文件: {', '.join(generated)}"
        )

    elif action == "preview":
        to = args.get("to", "")
        subject = args.get("subject", "")
        body_html = args.get("body_html", "")
        from datetime import date
        today = date.today().strftime("%Y%m%d")
        output = Path(AGENT_OUTPUT_DIR) / f"preview_{today}.html"
        generate_html_preview(to, subject, body_html, str(output))
        return f"✅ 已生成邮件预览: {output}"

    return f"❌ 未知操作: {action}"

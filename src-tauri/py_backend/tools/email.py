"""Email generation and sending utilities.

Generates .eml draft files (double-click to open in Outlook/OWA),
HTML preview files, and optionally sends via Microsoft Graph API.
"""

from __future__ import annotations

import json
import logging
import os
import re
from datetime import date
from email.mime.base import MIMEBase
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formataddr, formatdate
from pathlib import Path

from ..config import AGENT_OUTPUT_DIR

logger = logging.getLogger("agent.email")


def generate_eml(
    to: str,
    subject: str,
    body_html: str,
    cc: str | None = None,
    reply_to: str | None = None,
    output_path: str | None = None,
    from_addr: str = "user@example.com",
) -> str:
    """Generate a .eml file that can be opened by double-clicking.

    Returns the path to the generated file.
    """
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = formataddr(("", from_addr))
    msg["To"] = to
    msg["Date"] = formatdate(localtime=True)

    if cc:
        msg["CC"] = cc
    if reply_to:
        msg["Reply-To"] = reply_to

    # Plain text fallback
    body_plain = re.sub(r"<[^>]+>", "", body_html)
    body_plain = re.sub(r"\n{3,}", "\n\n", body_plain).strip()
    msg.attach(MIMEText(body_plain, "plain", "utf-8"))

    # HTML version
    msg.attach(MIMEText(body_html, "html", "utf-8"))

    if not output_path:
        today = date.today().strftime("%Y%m%d")
        safe_subject = re.sub(r"[^\w\-_ ]", "", subject)[:60]
        output_path = os.path.join(AGENT_OUTPUT_DIR, f"{safe_subject}_{today}.eml")

    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    with open(output_path, "wb") as f:
        f.write(msg.as_bytes())
    logger.info("Generated .eml: %s", output_path)
    return output_path


def generate_html_preview(to: str, subject: str, body_html: str, output_path: str | None = None) -> str:
    """Generate a standalone HTML file (for copy-paste to web Outlook)."""
    html = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>{subject}</title></head>
<body>
<table cellpadding="0" cellspacing="0" style="width:100%;max-width:640px;margin:0 auto;font-family:'Microsoft YaHei','PingFang SC',sans-serif;">
<tr><td style="padding:8px 0;border-bottom:2px solid #10b981;margin-bottom:16px;">
    <strong style="font-size:18px;">{subject}</strong>
</td></tr>
<tr><td style="padding:8px 0;color:#6b7280;font-size:13px;">
    收件人: {to}
</td></tr>
<tr><td style="padding:12px 0;line-height:1.6;color:#1f2937;">
{body_html}
</td></tr>
<tr><td style="padding:16px 0 8px;border-top:1px solid #e5e7eb;font-size:11px;color:#9ca3af;">
    本邮件由 EasyWork 自动生成
</td></tr>
</table>
</body></html>"""

    if not output_path:
        today = date.today().strftime("%Y%m%d")
        safe_subject = re.sub(r"[^\w\-_ ]", "", subject)[:60]
        output_path = os.path.join(AGENT_OUTPUT_DIR, f"preview_{safe_subject}_{today}.html")

    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(html)
    logger.info("Generated HTML preview: %s", output_path)
    return output_path


def read_recipients(file_path: str) -> list[dict[str, str]]:
    """Read recipient list from Excel/CSV. Expected columns: 姓名, 邮箱."""
    import pandas as pd

    ext = Path(file_path).suffix.lower()
    if ext == ".csv":
        df = None
        for enc in ("utf-8", "gbk", "gb2312", "utf-16"):
            try:
                df = pd.read_csv(file_path, dtype=str, encoding=enc)
                break
            except UnicodeError:
                continue
        if df is None:
            return []
    else:
        df = pd.read_excel(file_path, dtype=str)

    df = df.dropna(subset=["邮箱", "Email"], how="all")
    # Normalize column names
    col_map = {}
    for c in df.columns:
        c_lower = c.lower().strip()
        if c_lower in ("邮箱", "email", "mail"):
            col_map[c] = "邮箱"
        elif c_lower in ("姓名", "name"):
            col_map[c] = "姓名"
        elif c_lower in ("部门", "department", "dept"):
            col_map[c] = "部门"
        elif c_lower in ("产线", "line"):
            col_map[c] = "产线"
        elif c_lower in ("cc",):
            col_map[c] = "CC"
    df = df.rename(columns=col_map)

    if "邮箱" not in df.columns:
        raise ValueError("找不到邮箱列（支持: 邮箱, Email, mail）")

    records: list[dict[str, str]] = []
    for _, row in df.iterrows():
        r: dict[str, str] = {"姓名": "", "邮箱": "", "部门": "", "产线": "", "CC": ""}
        if pd.notna(row.get("姓名")):
            r["姓名"] = str(row["姓名"])
        r["邮箱"] = str(row["邮箱"]).strip()
        if pd.notna(row.get("部门")):
            r["部门"] = str(row["部门"])
        if pd.notna(row.get("产线")):
            r["产线"] = str(row["产线"])
        if pd.notna(row.get("CC")):
            r["CC"] = str(row["CC"])
        records.append(r)

    logger.info("Read %d recipients from %s", len(records), file_path)
    return records


# ── Microsoft Graph API (optional, host-only) ───────────────


def _get_token_path() -> Path:
    return Path.home() / ".easywork" / "graph_token.json"


def graph_is_configured() -> bool:
    """Check if Graph API credentials are available."""
    from ..config import GRAPH_CLIENT_ID, GRAPH_TENANT_ID
    return bool(GRAPH_CLIENT_ID) and bool(GRAPH_TENANT_ID)


def graph_login() -> str | None:
    """Start device login flow. Returns the user code URL to display."""
    import requests

    from ..config import GRAPH_CLIENT_ID, GRAPH_TENANT_ID

    tenant = GRAPH_TENANT_ID or "common"
    url = f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/devicecode"
    resp = requests.post(url, data={
        "client_id": GRAPH_CLIENT_ID,
        "scope": "offline_access Mail.Send",
    })
    data = resp.json()
    if "error" in data:
        logger.error("Graph login failed: %s", data.get("error_description"))
        return None

    # Save device code for polling
    token_path = _get_token_path()
    token_path.parent.mkdir(parents=True, exist_ok=True)
    token_path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")

    logger.info("Graph device login: %s", data.get("message", ""))
    return data.get("verification_uri")


_EMAIL_RE = re.compile(r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$")


def _is_valid_email(addr: str) -> bool:
    """Basic email format validation."""
    return bool(_EMAIL_RE.match(addr.strip()))


def send_via_graph(
    to: str,
    subject: str,
    body_html: str,
    cc: str | None = None,
) -> bool:
    """Send email via Microsoft Graph API using cached token."""
    if not _is_valid_email(to):
        logger.error("Invalid recipient email: %s", to)
        return False

    import requests

    token_path = _get_token_path()
    if not token_path.exists():
        logger.error("Graph token not found. Run graph_login() first.")
        return False

    token_data = json.loads(token_path.read_text(encoding="utf-8"))
    access_token = token_data.get("access_token")

    if not access_token:
        # Try to refresh token
        from .config import GRAPH_CLIENT_ID

        refresh = token_data.get("refresh_token")
        if not refresh:
            logger.error("No refresh token available.")
            return False

        tenant = "common"
        try:
            resp = requests.post(
                f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token",
                data={
                    "client_id": GRAPH_CLIENT_ID,
                    "refresh_token": refresh,
                    "grant_type": "refresh_token",
                    "scope": "offline_access Mail.Send",
                },
                timeout=30,
            )
            data = resp.json()
        except requests.RequestException as e:
            logger.error("Token refresh network error: %s", e)
            return False
        if "access_token" not in data:
            logger.error("Token refresh failed: %s", data.get("error_description"))
            return False
        access_token = data["access_token"]
        # Update cached token
        token_data.update(data)
        token_path.write_text(json.dumps(token_data, ensure_ascii=False), encoding="utf-8")

    # Build email message
    email_msg = {
        "message": {
            "subject": subject,
            "body": {"contentType": "HTML", "content": body_html},
            "toRecipients": [{"emailAddress": {"address": to}}],
        }
    }
    if cc:
        email_msg["message"]["ccRecipients"] = [{"emailAddress": {"address": cc}}]

    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
    }
    try:
        resp = requests.post(
            "https://graph.microsoft.com/v1.0/me/sendMail",
            headers=headers,
            json=email_msg,
            timeout=30,
        )
    except requests.RequestException as e:
        logger.error("Graph send network error: %s", e)
        return False
    if resp.status_code in (200, 202):
        logger.info("Email sent via Graph API: %s", subject)
        return True
    else:
        logger.error("Graph send failed: %s", resp.text)
        return False

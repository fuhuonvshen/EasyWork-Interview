// EasyWork - Email commands (thin HTTP proxies to Python agent server).
//
// 邮箱监控：IMAP 扫描 / 求职邮件待确认队列。逻辑全在 Python sidecar
// （email_sync.py），这里只转发请求并返回结果。

use serde::{Deserialize, Serialize};
use tauri::State;
use crate::state::AgentSidecarState;

/// 待确认的求职邮件摘要（不含正文——正文永不落库）
#[derive(Serialize, Deserialize)]
pub struct EmailPending {
    pub id: String,
    pub account_id: String,
    pub from_addr: String,
    pub subject: String,
    pub received_at: String,
    pub ai_title: String,
    pub ai_deadline: Option<String>,
    pub ai_priority: String,
    pub created_at: String,
}

/// 立即对所有配置账号执行一轮扫描（含未回扫账号的首次 7 天回扫）。
#[tauri::command]
pub async fn email_scan_now(
    sidecar: State<'_, AgentSidecarState>,
) -> Result<serde_json::Value, String> {
    sidecar.0.post("/email/scan", &serde_json::json!({})).await
}

/// 待确认的求职邮件列表（按时间倒序）。
#[tauri::command]
pub async fn email_pending_list(
    sidecar: State<'_, AgentSidecarState>,
) -> Result<Vec<EmailPending>, String> {
    sidecar.0.get("/email/pending").await
}

/// 确认一条待确认邮件 → 写入待办（source=email），title/deadline 为用户改动后的值。
#[tauri::command]
pub async fn email_pending_confirm(
    id: String,
    title: Option<String>,
    deadline: Option<String>,
    sidecar: State<'_, AgentSidecarState>,
) -> Result<(), String> {
    let body = serde_json::json!({
        "id": id,
        "title": title,
        "deadline": deadline,
    });
    let _: serde_json::Value = sidecar.0.post("/email/pending/confirm", &body).await?;
    Ok(())
}

/// 忽略一条待确认邮件（不建待办）。
#[tauri::command]
pub async fn email_pending_ignore(
    id: String,
    sidecar: State<'_, AgentSidecarState>,
) -> Result<(), String> {
    let body = serde_json::json!({ "id": id });
    let _: serde_json::Value = sidecar.0.post("/email/pending/ignore", &body).await?;
    Ok(())
}

/// 邮箱账号连通性测试（LOGIN + SELECT，设置弹窗「测试连接」用）。
#[tauri::command]
pub async fn email_test_account(
    email: String,
    auth_code: String,
    host: Option<String>,
    sidecar: State<'_, AgentSidecarState>,
) -> Result<serde_json::Value, String> {
    let body = serde_json::json!({
        "email": email,
        "auth_code": auth_code,
        "host": host,
    });
    sidecar.0.post("/email/test", &body).await
}

pub mod meeting;
pub mod meeting_link;
pub mod reminder;
pub mod report;
pub mod schedule;

use sqlx::sqlite::SqlitePool;
use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use tauri::Manager;

/// 启动会议提醒轮询（每 30s 检查一次即将开始的会议）。
pub fn spawn_reminder(
    app_handle: tauri::AppHandle,
    db_pool: SqlitePool,
    reminder_state: Arc<Mutex<Option<serde_json::Value>>>,
) {
    tauri::async_runtime::spawn(async move {
        let mut reminded: HashSet<String> = HashSet::new();
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(30)).await;
            let now = chrono::Local::now();
            let now_naive = now.naive_local();
            let in_30s = now_naive + chrono::Duration::seconds(30);

            let meetings = crate::database::repo::list_scheduled_meetings(&db_pool).await;
            let Ok(meetings) = meetings else { continue };

            for m in &meetings {
                let Ok(start) = chrono::NaiveDateTime::parse_from_str(
                    &m.start_time,
                    "%Y-%m-%dT%H:%M:%S",
                ) else { continue };

                if start > now_naive && start <= in_30s && !reminded.contains(&m.id) {
                    reminded.insert(m.id.clone());
                    log::info!("Reminder: {} at {}", m.title, m.start_time);
                    let payload = serde_json::json!({
                        "id": m.id,
                        "title": m.title,
                        "startTime": m.start_time,
                        "zoomUrl": m.zoom_url,
                    });
                    if let Ok(mut guard) = reminder_state.lock() {
                        *guard = Some(payload);
                    }
                    if let Some(window) = app_handle.get_webview_window("main") {
                        let _ = window.set_always_on_top(true);
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            }
        }
    });
}

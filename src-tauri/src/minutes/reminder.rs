// EasyWork - Schedule reminder commands

use tauri::{Manager, State};
use crate::state::ReminderState;

#[tauri::command]
pub fn get_pending_reminder(state: State<'_, ReminderState>) -> Result<Option<serde_json::Value>, String> {
    let mut guard = state.0.lock().map_err(|e| format!("状态锁失败: {}", e))?;
    let reminder = guard.clone();
    *guard = None;
    Ok(reminder)
}

#[tauri::command]
pub fn dismiss_reminder(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_always_on_top(false);
    }
    Ok(())
}

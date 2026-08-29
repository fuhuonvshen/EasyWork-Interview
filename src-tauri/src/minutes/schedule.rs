// EasyWork - Scheduled meeting CRUD commands

use tauri::State;
use crate::database::models::ScheduledMeeting;
use crate::state::DbState;

#[tauri::command]
pub async fn add_scheduled_meeting(
    title: String,
    zoom_url: String,
    start_time: String,
    end_time: String,
    db: State<'_, DbState>,
) -> Result<String, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let id_clone = id.clone();
    let now = chrono::Local::now().to_rfc3339();
    let m = ScheduledMeeting {
        id: id_clone,
        title,
        zoom_url,
        start_time,
        end_time,
        created_at: now,
    };
    crate::database::repo::insert_scheduled_meeting(&db.0, &m)
        .await
        .map_err(|e| format!("添加日程失败: {}", e))?;
    Ok(id)
}

#[tauri::command]
pub async fn list_scheduled_meetings(
    db: State<'_, DbState>,
) -> Result<Vec<ScheduledMeeting>, String> {
    crate::database::repo::list_scheduled_meetings(&db.0)
        .await
        .map_err(|e| format!("查询日程失败: {}", e))
}

#[tauri::command]
pub async fn update_scheduled_meeting(
    id: String,
    title: String,
    zoom_url: String,
    start_time: String,
    end_time: String,
    db: State<'_, DbState>,
) -> Result<(), String> {
    let m = ScheduledMeeting {
        id,
        title,
        zoom_url,
        start_time,
        end_time,
        created_at: String::new(),
    };
    crate::database::repo::update_scheduled_meeting(&db.0, &m)
        .await
        .map_err(|e| format!("更新日程失败: {}", e))
}

#[tauri::command]
pub async fn delete_scheduled_meeting(
    id: String,
    db: State<'_, DbState>,
) -> Result<(), String> {
    crate::database::repo::delete_scheduled_meeting(&db.0, &id)
        .await
        .map_err(|e| format!("删除日程失败: {}", e))
}

#[tauri::command]
pub async fn find_meeting_by_schedule(
    schedule_id: String,
    db: State<'_, DbState>,
) -> Result<Option<String>, String> {
    crate::database::repo::find_meeting_by_schedule_id(&db.0, &schedule_id)
        .await
        .map_err(|e| format!("查询失败: {}", e))
}

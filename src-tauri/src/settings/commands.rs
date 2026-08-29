// EasyWork - Settings commands (get/set settings, folder picker)

use std::collections::HashMap;
use tauri::{Manager, State};
use crate::database;
use crate::state::DbState;
use serde::Serialize;

#[derive(Serialize)]
pub struct DefaultPaths {
    pub root: String,
    pub whisper_models: String,
    pub sensevoice_models: String,
    pub recordings: String,
    pub llm_models: String,
}

#[tauri::command]
pub fn get_default_paths(app: tauri::AppHandle) -> Result<DefaultPaths, String> {
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取应用目录失败: {}", e))?;
    Ok(DefaultPaths {
        root: app_dir.to_string_lossy().to_string(),
        whisper_models: app_dir.join("models").to_string_lossy().to_string(),
        sensevoice_models: app_dir.join("sensevoice_models").to_string_lossy().to_string(),
        recordings: app_dir.join("recordings").to_string_lossy().to_string(),
        llm_models: app_dir.join("llm_models").to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub async fn get_settings(
    db: State<'_, DbState>,
) -> Result<HashMap<String, String>, String> {
    database::repo::get_all_settings(&db.0)
        .await
        .map_err(|e| format!("读取设置失败: {}", e))
}

#[tauri::command]
pub async fn update_setting(
    key: String,
    value: String,
    db: State<'_, DbState>,
) -> Result<(), String> {
    database::repo::update_setting(&db.0, &key, &value)
        .await
        .map_err(|e| format!("保存设置失败: {}", e))
}

#[tauri::command]
pub async fn pick_audio_file(
    app: tauri::AppHandle,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let file = app
        .dialog()
        .file()
        .add_filter("音频文件 (WAV)", &["wav"])
        .set_title("选择录音文件")
        .blocking_pick_file();

    Ok(file.map(|f| f.to_string()))
}

#[tauri::command]
pub async fn select_folder(
    app: tauri::AppHandle,
    default_path: Option<String>,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let mut dialog = app.dialog().file();
    if let Some(ref path) = default_path {
        let p = std::path::Path::new(path);
        if p.exists() {
            dialog = dialog.set_directory(p);
        }
    }

    let result = dialog.blocking_pick_folder();
    Ok(result.map(|f| f.to_string()))
}

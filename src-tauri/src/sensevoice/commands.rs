// EasyWork - SenseVoice model commands

use tauri::State;
use crate::state::SenseVoiceState;

#[tauri::command]
pub fn sv_check_model(
    state: State<'_, SenseVoiceState>,
) -> Result<serde_json::Value, String> {
    let guard = state.0.lock().map_err(|e| format!("状态锁失败: {}", e))?;
    let engine = guard.as_ref().ok_or("SenseVoice 引擎未初始化")?;
    let models = engine.list_models();
    let any_downloaded = models.iter().any(|m| m.downloaded);
    Ok(serde_json::json!({
        "exists": any_downloaded,
        "models": models,
        "modelsDir": engine.models_dir_str(),
    }))
}

#[tauri::command]
pub fn sv_list_models(
    state: State<'_, SenseVoiceState>,
) -> Result<serde_json::Value, String> {
    let guard = state.0.lock().map_err(|e| format!("状态锁失败: {}", e))?;
    let engine = guard.as_ref().ok_or("SenseVoice 引擎未初始化")?;
    let models = engine.list_models();
    Ok(serde_json::json!({
        "models": models,
        "modelsDir": engine.models_dir_str(),
    }))
}

#[tauri::command]
pub fn sv_delete_model(
    filename: String,
    state: State<'_, SenseVoiceState>,
) -> Result<(), String> {
    let guard = state.0.lock().map_err(|e| format!("状态锁失败: {}", e))?;
    let engine = guard.as_ref().ok_or("SenseVoice 引擎未初始化")?;
    engine.delete_model(&filename).map_err(|e| format!("删除失败: {}", e))
}

#[tauri::command]
pub async fn sv_load_model(
    filename: String,
    state: State<'_, SenseVoiceState>,
) -> Result<String, String> {
    let engine = {
        let guard = state.0.lock().map_err(|e| format!("状态锁失败: {}", e))?;
        guard.as_ref().ok_or("SenseVoice 引擎未初始化")?.clone()
    };
    engine.load_model(&filename).await.map_err(|e| format!("加载失败: {}", e))?;
    Ok(format!("SenseVoice 模型 {} 加载成功", filename))
}

#[tauri::command]
pub async fn sv_download_model(
    filename: String,
    state: State<'_, SenseVoiceState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let engine = {
        let guard = state.0.lock().map_err(|e| format!("状态锁失败: {}", e))?;
        guard.as_ref().ok_or("SenseVoice 引擎未初始化")?.clone()
    };
    let engine_clone = engine.clone();
    let name_clone = filename.clone();
    tauri::async_runtime::spawn(async move {
        match engine_clone.download_model(&name_clone, app).await {
            Ok(()) => {
                let _ = engine_clone.load_model(&name_clone).await;
            }
            Err(e) => log::warn!("SenseVoice download failed: {}", e),
        }
    });
    Ok(())
}

#[tauri::command]
pub fn sv_cancel_download(state: State<'_, SenseVoiceState>) -> Result<(), String> {
    let guard = state.0.lock().map_err(|e| format!("状态锁失败: {}", e))?;
    let engine = guard.as_ref().ok_or("SenseVoice 引擎未初始化")?;
    engine.cancel_download();
    Ok(())
}

#[tauri::command]
pub async fn sv_unload_model(
    state: State<'_, SenseVoiceState>,
) -> Result<String, String> {
    let engine = {
        let guard = state.0.lock().map_err(|e| format!("状态锁失败: {}", e))?;
        guard.as_ref().ok_or("SenseVoice 引擎未初始化")?.clone()
    };
    engine.unload_model().await;
    Ok("SenseVoice 模型已卸载".to_string())
}

/// Ensure a SenseVoice model is loaded; auto-load the first found model if none is loaded.
async fn ensure_sv_model(engine: &crate::sensevoice::engine::SenseVoiceEngine) -> Result<(), String> {
    engine.ensure_model_loaded().await
}

#[tauri::command]
pub async fn sv_transcribe(
    audio_data: Vec<f32>,
    state: State<'_, SenseVoiceState>,
) -> Result<String, String> {
    let engine = {
        let guard = state.0.lock().map_err(|e| format!("状态锁失败: {}", e))?;
        guard.as_ref().ok_or("SenseVoice 引擎未初始化")?.clone()
    };
    ensure_sv_model(&engine).await?;
    engine.transcribe(&audio_data).await.map_err(|e| format!("转写失败: {}", e))
}

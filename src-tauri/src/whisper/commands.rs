// EasyWork - Whisper model commands

use tauri::State;
use crate::state::WhisperState;

#[tauri::command]
pub fn whisper_check_model(
    state: State<'_, WhisperState>,
) -> Result<serde_json::Value, String> {
    let guard = state.0.lock().map_err(|e| format!("状态锁失败: {}", e))?;
    let engine = guard.as_ref().ok_or("Whisper 引擎未初始化")?;
    let models = engine.list_models();
    let any_downloaded = models.iter().any(|m| m.downloaded);
    let recommended = models.iter().find(|m| m.is_recommended);
    Ok(serde_json::json!({
        "exists": any_downloaded,
        "recommended": recommended.map(|m| &m.name),
        "models": models,
        "modelsDir": engine.models_dir_str(),
    }))
}

#[tauri::command]
pub fn whisper_list_models(
    state: State<'_, WhisperState>,
) -> Result<serde_json::Value, String> {
    let guard = state.0.lock().map_err(|e| format!("状态锁失败: {}", e))?;
    let engine = guard.as_ref().ok_or("Whisper 引擎未初始化")?;
    let models = engine.list_models();
    Ok(serde_json::json!({
        "models": models,
        "modelsDir": engine.models_dir_str(),
    }))
}

#[tauri::command]
pub fn whisper_delete_model(
    filename: String,
    state: State<'_, WhisperState>,
) -> Result<(), String> {
    let guard = state.0.lock().map_err(|e| format!("状态锁失败: {}", e))?;
    let engine = guard.as_ref().ok_or("Whisper 引擎未初始化")?;
    engine
        .delete_model(&filename)
        .map_err(|e| format!("删除失败: {}", e))
}

#[tauri::command]
pub fn whisper_get_models_dir(
    state: State<'_, WhisperState>,
) -> Result<String, String> {
    let guard = state.0.lock().map_err(|e| format!("状态锁失败: {}", e))?;
    let engine = guard.as_ref().ok_or("Whisper 引擎未初始化")?;
    Ok(engine.models_dir_str())
}

#[tauri::command]
pub async fn whisper_load_model(
    filename: String,
    state: State<'_, WhisperState>,
) -> Result<String, String> {
    let engine = {
        let guard = state.0.lock().map_err(|e| format!("状态锁失败: {}", e))?;
        guard.as_ref().ok_or("Whisper 引擎未初始化")?.clone()
    };
    engine
        .load_model(&filename)
        .await
        .map_err(|e| format!("加载模型失败: {}", e))?;
    Ok(format!("模型 {} 加载成功", filename))
}

#[tauri::command]
pub async fn whisper_download_model(
    filename: String,
    state: State<'_, WhisperState>,
) -> Result<(), String> {
    let engine = {
        let guard = state.0.lock().map_err(|e| format!("状态锁失败: {}", e))?;
        guard.as_ref().ok_or("Whisper 引擎未初始化")?.clone()
    };

    let engine_for_task = engine.clone();
    let filename_for_task = filename.clone();
    tauri::async_runtime::spawn(async move {
        match engine_for_task.download_model(&filename_for_task).await {
            Ok(()) => {
                let _ = engine_for_task.load_model(&filename_for_task).await;
            }
            Err(e) => {
                log::warn!("Download failed: {}", e);
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub fn whisper_download_status(
    state: State<'_, WhisperState>,
) -> Result<serde_json::Value, String> {
    let guard = state.0.lock().map_err(|e| format!("状态锁失败: {}", e))?;
    let engine = guard.as_ref().ok_or("Whisper 引擎未初始化")?;
    Ok(engine.get_download_state())
}

#[tauri::command]
pub fn whisper_cancel_download(state: State<'_, WhisperState>) -> Result<(), String> {
    let guard = state.0.lock().map_err(|e| format!("状态锁失败: {}", e))?;
    let engine = guard.as_ref().ok_or("Whisper 引擎未初始化")?;
    engine.cancel_download();
    Ok(())
}

#[tauri::command]
pub async fn whisper_unload_model(
    state: State<'_, WhisperState>,
) -> Result<String, String> {
    let engine = {
        let guard = state.0.lock().map_err(|e| format!("状态锁失败: {}", e))?;
        guard.as_ref().ok_or("Whisper 引擎未初始化")?.clone()
    };
    engine.unload_model().await;
    Ok("Whisper 模型已卸载".to_string())
}

/// Ensure a Whisper model is loaded; auto-load the first found model if none is loaded.
async fn ensure_whisper_model(engine: &crate::whisper::engine::WhisperEngine) -> Result<(), String> {
    engine.ensure_model_loaded().await
}

#[tauri::command]
pub async fn whisper_transcribe(
    wav_path: String,
    state: State<'_, WhisperState>,
) -> Result<String, String> {
    let mut reader = hound::WavReader::open(&wav_path)
        .map_err(|e| format!("无法打开 WAV 文件: {}", e))?;
    let spec = reader.spec();
    let duration = reader.duration() as usize;
    let samples: Vec<f32> = reader.samples::<f32>().filter_map(|s| s.ok()).collect();
    if samples.is_empty() {
        return Err(format!("WAV 无有效采样 ({} 帧, {:?})", duration, spec.sample_format));
    }
    let audio =
        crate::whisper::engine::convert_audio_for_whisper(&samples, spec.channels, spec.sample_rate);

    let engine = {
        let guard = state.0.lock().map_err(|e| format!("状态锁失败: {}", e))?;
        guard.as_ref().ok_or("Whisper 引擎未初始化")?.clone()
    };
    ensure_whisper_model(&engine).await?;
    engine
        .transcribe(&audio)
        .await
        .map_err(|e| format!("转写失败: {}", e))
}

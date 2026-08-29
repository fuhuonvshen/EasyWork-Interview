// EasyWork - Unified ASR (Automatic Speech Recognition) commands
// 自动选择可用引擎：优先 SenseVoice，回退到 Whisper。

use tauri::State;
use crate::state::{SenseVoiceState, WhisperState};

#[tauri::command]
pub async fn asr_check_model(
    whisper_state: State<'_, WhisperState>,
    sensevoice_state: State<'_, SenseVoiceState>,
) -> Result<serde_json::Value, String> {
    let whisper_models = {
        let guard = whisper_state.0.lock().map_err(|e| format!("状态锁失败: {}", e))?;
        guard.as_ref().map(|e| e.list_models()).unwrap_or_default()
    };
    let sv_models = {
        let guard = sensevoice_state.0.lock().map_err(|e| format!("状态锁失败: {}", e))?;
        guard.as_ref().map(|e| e.list_models()).unwrap_or_default()
    };

    let has_whisper = whisper_models.iter().any(|m| m.downloaded);
    let has_sensevoice = sv_models.iter().any(|m| m.downloaded);

    Ok(serde_json::json!({
        "exists": has_whisper || has_sensevoice,
        "hasWhisper": has_whisper,
        "hasSenseVoice": has_sensevoice,
        "recommended": whisper_models.iter().find(|m| m.is_recommended).map(|m| &m.name),
    }))
}

#[tauri::command]
pub async fn asr_list_models(
    whisper_state: State<'_, WhisperState>,
    sensevoice_state: State<'_, SenseVoiceState>,
) -> Result<serde_json::Value, String> {
    let whisper_models = {
        let guard = whisper_state.0.lock().map_err(|e| format!("状态锁失败: {}", e))?;
        guard.as_ref().map(|e| {
            serde_json::json!({
                "models": e.list_models(),
                "modelsDir": e.models_dir_str(),
            })
        }).unwrap_or_else(|| serde_json::json!({ "models": [], "modelsDir": "" }))
    };
    let sv_models = {
        let guard = sensevoice_state.0.lock().map_err(|e| format!("状态锁失败: {}", e))?;
        guard.as_ref().map(|e| {
            serde_json::json!({
                "models": e.list_models(),
                "modelsDir": e.models_dir_str(),
            })
        }).unwrap_or_else(|| serde_json::json!({ "models": [], "modelsDir": "" }))
    };

    Ok(serde_json::json!({
        "whisper": whisper_models,
        "sensevoice": sv_models,
    }))
}

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

fn error_snippet(text: &str) -> String {
    let trimmed = text.trim();
    let mut out: String = trimmed.chars().take(300).collect();
    if trimmed.chars().count() > 300 {
        out.push('…');
    }
    out
}

/// 在线语言模型连通性测试：用当前表单值发一次最小请求，不保存设置。
#[tauri::command]
pub async fn llm_test_online(
    url: String,
    key: String,
    model: String,
) -> Result<String, String> {
    let url = url.trim();
    let key = key.trim();
    let model = model.trim();
    if url.is_empty() {
        return Err("请填写 API 地址".into());
    }
    if key.is_empty() {
        return Err("请填写 API Key".into());
    }
    if model.is_empty() {
        return Err("请填写模型名称".into());
    }

    // 与真实调用路径保持一致：去掉末尾 /v1 后统一拼 /v1/chat/completions
    let base = url.trim_end_matches('/');
    let base = base.strip_suffix("/v1").unwrap_or(base);
    let endpoint = format!("{}/v1/chat/completions", base.trim_end_matches('/'));

    let body = serde_json::json!({
        "model": model,
        "messages": [{"role": "user", "content": "ping"}],
        "stream": false,
        "max_tokens": 16,
    });
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(5))
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;
    let resp = client
        .post(&endpoint)
        .bearer_auth(key)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("连接在线模型失败: {}", e))?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        let snippet = error_snippet(&text);
        if status.as_u16() == 401 || status.as_u16() == 403 {
            return Err(format!("API Key 无效（HTTP {}）: {}", status.as_u16(), snippet));
        }
        return Err(format!("在线模型返回 HTTP {}: {}", status.as_u16(), snippet));
    }
    let value: serde_json::Value = serde_json::from_str(&text)
        .map_err(|e| format!("在线模型响应不是合法 JSON: {}", e))?;
    if let Some(message) = value["error"]["message"].as_str() {
        return Err(format!("在线模型返回错误: {}", message));
    }
    if value["choices"]
        .as_array()
        .map(|items| items.is_empty())
        .unwrap_or(true)
    {
        return Err(format!(
            "在线模型响应缺少 choices: {}",
            error_snippet(&text)
        ));
    }
    Ok(format!("连接成功（模型 {}）", model))
}

/// 在线语音识别连通性测试：用当前表单值发送一段静音，不保存设置。
#[tauri::command]
pub async fn asr_test_online(
    provider: String,
    url: String,
    model: String,
    key: String,
    app_id: Option<String>,
    secret: Option<String>,
) -> Result<String, String> {
    let missing_hint = if provider.trim() == "xfyun" {
        "请检查 APPID / APIKey / APISecret"
    } else {
        "请检查 API 地址、模型名称和 Key"
    };
    let mut settings = HashMap::new();
    settings.insert("asr_backend".to_string(), "online".to_string());
    settings.insert("asr_online_provider".to_string(), provider);
    settings.insert("asr_online_url".to_string(), url);
    settings.insert("asr_online_model".to_string(), model);
    settings.insert("asr_online_key".to_string(), key);
    settings.insert("asr_online_app_id".to_string(), app_id.unwrap_or_default());
    settings.insert("asr_online_secret".to_string(), secret.unwrap_or_default());

    let config = crate::asr::online::OnlineAsrConfig::from_settings(&settings)
        .ok_or_else(|| format!("在线识别配置不完整，{}", missing_hint))?;
    crate::asr::online::test_connection(&config)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn pick_audio_file(
    app: tauri::AppHandle,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let file = app
        .dialog()
        .file()
        .add_filter("音频文件 (WAV, MP3, M4A, AAC, FLAC, OGG)", &["wav", "mp3", "m4a", "aac", "flac", "ogg"])
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

/// 用系统默认浏览器打开外部 URL（"前往投递"嵌入页的兜底入口）
#[tauri::command]
pub async fn open_external_url(url: String) -> Result<(), String> {
    if url.trim().is_empty() {
        return Err("URL 为空".into());
    }
    open::that(url.trim())
        .map_err(|e| format!("打开浏览器失败: {}", e))
}

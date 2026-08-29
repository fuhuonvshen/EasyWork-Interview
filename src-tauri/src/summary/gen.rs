// EasyWork - 本地 LLM 纪要生成
// 调用内嵌 llama.cpp HTTP Server（OpenAI 兼容 API）生成会议纪要。

use anyhow::{Context, Result};
use crate::llm::engine::LlmEngine;
use std::sync::Arc;
use tokio::sync::RwLock;

/// Generate meeting minutes from a transcript using the local LLM engine.
pub async fn generate_minutes(
    transcript: &str,
    meeting_title: &str,
    meeting_type: &str,
    engine: &Arc<RwLock<LlmEngine>>,
) -> Result<String> {
    let system = super::template::system_prompt(meeting_type);
    let user = super::template::user_prompt(transcript, meeting_title);

    let prompt_chars = system.chars().count() + user.chars().count();
    log::info!("Generating minutes via local LLM, prompt_chars={}", prompt_chars);

    // Lazy-load: if server not running but a model exists, auto-start it
    {
        let eng = engine.read().await;
        if !eng.is_server_healthy().await {
            let models = eng.list_models();
            let model = models.iter()
                .find(|m| m.downloaded && m.is_recommended)
                .or_else(|| models.iter().find(|m| m.downloaded));
            drop(eng);

            if let Some(m) = model {
                log::info!("Lazy-loading LLM model: {}", m.name);
                let eng = engine.read().await;
                if let Err(e) = eng.start_server(&m.name).await {
                    return Err(anyhow::anyhow!("自动加载 LLM 模型失败: {}", e));
                }
            } else {
                let eng = engine.read().await;
                if !eng.is_binary_ready() {
                    return Err(anyhow::anyhow!("llama-server 未就绪，请在「模型管理」中下载后使用"));
                } else {
                    return Err(anyhow::anyhow!("未下载本地模型，请在「模型管理」中下载后使用"));
                }
            }
        }
    }

    // Wait for server to be healthy
    for i in 0..60 {
        if engine.read().await.is_server_healthy().await {
            break;
        }
        if i == 59 {
            return Err(anyhow::anyhow!("LLM 服务启动超时，请重试"));
        }
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
    }

    log::info!("LLM server is healthy, sending generate request...");

    let minutes = {
        let eng = engine.read().await;
        match eng.generate(&system, &user).await {
            Ok(m) => {
                log::info!("Minutes generated: {} chars", m.len());
                m
            }
            Err(e) => {
                log::error!("LLM generate failed: {:?}", e);
                return Err(anyhow::anyhow!("纪要生成失败: {}", e));
            }
        }
    };
    Ok(minutes)
}

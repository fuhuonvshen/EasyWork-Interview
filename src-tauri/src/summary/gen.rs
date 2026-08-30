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

    // 在线后端（设置中配置）不需要本地 llama-server
    if !engine.read().await.is_online() {
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

/// Generate an interview review note (求职者视角) from a transcript
/// using the local LLM engine.
pub async fn generate_interview_minutes(
    transcript: &str,
    interview_title: &str,
    company: &str,
    position: &str,
    engine: &Arc<RwLock<LlmEngine>>,
) -> Result<String> {
    let system = super::template::interview_system_prompt();
    let user = super::template::interview_user_prompt(transcript, company, position);

    let prompt_chars = system.chars().count() + user.chars().count();
    log::info!("Generating interview minutes via local LLM, prompt_chars={} (title={})", prompt_chars, interview_title);

    // 在线后端（设置中配置）不需要本地 llama-server
    if !engine.read().await.is_online() {
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
    }

    log::info!("LLM server is healthy, sending interview generate request...");

    let minutes = {
        let eng = engine.read().await;
        match eng.generate(&system, &user).await {
            Ok(m) => {
                log::info!("Interview minutes generated: {} chars", m.len());
                m
            }
            Err(e) => {
                log::error!("LLM generate failed: {:?}", e);
                return Err(anyhow::anyhow!("面试纪要生成失败: {}", e));
            }
        }
    };
    Ok(minutes)
}

/// 从 LLM 输出中提取的一道面试题（JSON 解析用）
#[derive(Debug, Clone, serde::Deserialize)]
pub struct ExtractedQuestion {
    #[serde(default)]
    pub category: String,
    pub question: String,
    #[serde(default)]
    pub expected_answer: Option<String>,
}

/// 从 LLM 输出文本中解析 JSON 数组（容忍 Markdown 代码块等噪音）
fn parse_questions_json(raw: &str) -> anyhow::Result<Vec<ExtractedQuestion>> {
    let mut text = raw.trim().to_string();
    // 去掉 ```json ... ``` 包裹
    if let Some(start) = text.find("```") {
        let end = text.rfind("```").unwrap_or(start);
        text = text[start + 3..end].trim().to_string();
        if text.starts_with("json") {
            text = text[4..].trim().to_string();
        }
    }
    // 截取第一个 [ 到最后一个 ]
    let start = text.find('[').ok_or_else(|| anyhow::anyhow!("输出中没有 JSON 数组"))?;
    let end = text.rfind(']').ok_or_else(|| anyhow::anyhow!("JSON 数组不完整"))?;
    if end <= start {
        return Err(anyhow::anyhow!("JSON 数组为空"));
    }
    let slice = &text[start..=end];
    let list: Vec<ExtractedQuestion> = serde_json::from_str(slice)?;
    Ok(list)
}

/// 用本地 LLM 从面试转写中提取面试官提出的问题（JSON 数组）。
/// 提取失败时返回 Ok(vec![])（不阻塞主流程）。
pub async fn extract_interview_questions(
    transcript: &str,
    engine: &Arc<RwLock<LlmEngine>>,
) -> Vec<ExtractedQuestion> {
    if transcript.trim().is_empty() {
        return Vec::new();
    }
    let system = super::template::interview_questions_prompt(transcript);

    // 在线后端（设置中配置）不需要本地 llama-server
    if !engine.read().await.is_online() {
        // Lazy-load + 等待就绪（与纪要生成一致）
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
                        log::warn!("提取面试问题：LLM 加载失败: {}", e);
                        return Vec::new();
                    }
                } else {
                    return Vec::new();
                }
            }
        }
        for i in 0..60 {
            if engine.read().await.is_server_healthy().await {
                break;
            }
            if i == 59 {
                log::warn!("提取面试问题：LLM 服务启动超时");
                return Vec::new();
            }
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
        }
    }

    let raw = match engine.read().await.generate(&system, "").await {
        Ok(s) => s,
        Err(e) => {
            log::warn!("提取面试问题失败: {}", e);
            return Vec::new();
        }
    };

    match parse_questions_json(&raw) {
        Ok(list) => {
            log::info!("Extracted {} interview questions", list.len());
            list
        }
        Err(e) => {
            log::warn!("解析面试问题 JSON 失败: {} | raw={}", e, &raw[..raw.len().min(200)]);
            Vec::new()
        }
    }
}

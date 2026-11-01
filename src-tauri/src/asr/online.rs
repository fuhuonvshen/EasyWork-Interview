// EasyWork - 在线语音识别
//
// 设置中选择「在线识别」时启用，按 VAD 分句逐段上传；失败由调用方回退本地模型。
// 支持三类协议：
//   - OpenAI 兼容 /v1/audio/transcriptions（硅基流动、OpenAI、自定义）
//   - 阿里云百炼 Qwen3-ASR（/compatible-mode/v1/chat/completions + input_audio）
//   - 科大讯飞语音听写（wss://iat-api.xfyun.cn/v2/iat，HMAC-SHA256 签名）

use std::collections::{BTreeMap, HashMap};
use std::io::Cursor;
use std::sync::OnceLock;
use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use futures_util::{SinkExt, StreamExt};
use hmac::{Hmac, Mac};
use serde_json::{json, Value};
use sha2::Sha256;
use tokio::sync::Semaphore;
use tokio_tungstenite::tungstenite::Message;

const TIMEOUT_SECS: u64 = 25;
const MAX_CONCURRENCY: usize = 3;
const XFYUN_HOST: &str = "iat-api.xfyun.cn";
const XFYUN_PATH: &str = "/v2/iat";

#[derive(Clone, Debug)]
pub struct OnlineAsrConfig {
    provider: String,
    base_url: String,
    model: String,
    api_key: String,
    app_id: String,
    api_secret: String,
}

impl OnlineAsrConfig {
    /// 从设置表解析；未启用或配置不完整时返回 None（调用方走本地模型）。
    pub fn from_settings(settings: &HashMap<String, String>) -> Option<Self> {
        if settings.get("asr_backend").map(|v| v.as_str()) != Some("online") {
            return None;
        }
        let get = |key: &str| {
            settings
                .get(key)
                .map(|v| v.trim().to_string())
                .unwrap_or_default()
        };
        let provider = get("asr_online_provider");
        let api_key = get("asr_online_key");
        let app_id = get("asr_online_app_id");
        let api_secret = get("asr_online_secret");

        if provider == "xfyun" {
            if api_key.is_empty() || app_id.is_empty() || api_secret.is_empty() {
                log::warn!(
                    "在线语音识别（讯飞）缺少 APPID / APIKey / APISecret，继续使用本地模型"
                );
                return None;
            }
            return Some(Self {
                provider,
                base_url: String::new(),
                model: String::new(),
                api_key,
                app_id,
                api_secret,
            });
        }

        let base_url = normalize_base_url(&get("asr_online_url"));
        let model = get("asr_online_model");
        if api_key.is_empty() || base_url.is_empty() || model.is_empty() {
            log::warn!("在线语音识别缺少 API 地址 / 模型 / Key，继续使用本地模型");
            return None;
        }
        let provider = if provider.is_empty() {
            if base_url.contains("dashscope.aliyuncs.com") {
                "dashscope".to_string()
            } else {
                "custom".to_string()
            }
        } else {
            provider
        };
        Some(Self {
            provider,
            base_url,
            model,
            api_key,
            app_id,
            api_secret,
        })
    }

    pub fn provider_label(&self) -> &str {
        &self.provider
    }
}

/// 识别一段 16kHz 单声道音频；超时 / 网络 / 服务错误都会返回 Err，由调用方回退本地。
pub async fn transcribe(config: &OnlineAsrConfig, samples: &[f32]) -> Result<String> {
    if samples.is_empty() {
        return Err(anyhow!("音频为空"));
    }
    let _permit = semaphore()
        .acquire()
        .await
        .map_err(|e| anyhow!("在线识别任务队列不可用: {}", e))?;

    let fut = async {
        match config.provider.as_str() {
            "xfyun" => transcribe_xfyun(config, samples).await,
            "dashscope" => transcribe_dashscope(config, samples).await,
            _ => transcribe_openai_compat(config, samples).await,
        }
    };
    tokio::time::timeout(Duration::from_secs(TIMEOUT_SECS), fut)
        .await
        .map_err(|_| anyhow!("在线语音识别超时（{}s）", TIMEOUT_SECS))?
}

fn semaphore() -> &'static Semaphore {
    static SEM: OnceLock<Semaphore> = OnceLock::new();
    SEM.get_or_init(|| Semaphore::new(MAX_CONCURRENCY))
}

fn client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_secs(TIMEOUT_SECS))
            .build()
            .expect("Failed to create online ASR HTTP client")
    })
}

fn normalize_base_url(raw: &str) -> String {
    let trimmed = raw.trim().trim_end_matches('/');
    let without_v1 = trimmed.strip_suffix("/v1").unwrap_or(trimmed);
    without_v1.trim_end_matches('/').to_string()
}

fn transcriptions_url(base: &str) -> String {
    if base.ends_with("/audio/transcriptions") {
        base.to_string()
    } else {
        format!("{}/v1/audio/transcriptions", base)
    }
}

fn chat_completions_url(base: &str) -> String {
    if base.ends_with("/chat/completions") {
        base.to_string()
    } else {
        format!("{}/v1/chat/completions", base)
    }
}

fn snippet(text: &str) -> String {
    let trimmed = text.trim();
    let mut out: String = trimmed.chars().take(200).collect();
    if trimmed.chars().count() > 200 {
        out.push('…');
    }
    out
}

fn encode_wav(samples: &[f32]) -> Result<Vec<u8>> {
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate: 16000,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut cursor = Cursor::new(Vec::with_capacity(samples.len() * 2 + 44));
    {
        let mut writer =
            hound::WavWriter::new(&mut cursor, spec).context("创建 WAV 编码器失败")?;
        for &sample in samples {
            let value = (sample.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
            writer.write_sample(value).context("写入 WAV 失败")?;
        }
        writer.finalize().context("完成 WAV 编码失败")?;
    }
    Ok(cursor.into_inner())
}

fn pcm16_bytes(samples: &[f32]) -> Vec<u8> {
    let mut out = Vec::with_capacity(samples.len() * 2);
    for &sample in samples {
        let value = (sample.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
        out.extend_from_slice(&value.to_le_bytes());
    }
    out
}

// ── OpenAI 兼容 /v1/audio/transcriptions ──────────────────────

async fn transcribe_openai_compat(
    config: &OnlineAsrConfig,
    samples: &[f32],
) -> Result<String> {
    let wav = encode_wav(samples)?;
    let part = reqwest::multipart::Part::bytes(wav)
        .file_name("audio.wav")
        .mime_str("audio/wav")
        .context("构造音频上传失败")?;
    let form = reqwest::multipart::Form::new()
        .part("file", part)
        .text("model".to_string(), config.model.clone());

    let response = client()
        .post(transcriptions_url(&config.base_url))
        .bearer_auth(&config.api_key)
        .multipart(form)
        .send()
        .await
        .context("在线识别请求失败")?;
    let status = response.status();
    let body = response
        .text()
        .await
        .context("读取在线识别响应失败")?;
    if !status.is_success() {
        return Err(anyhow!(
            "在线识别 HTTP {}: {}",
            status.as_u16(),
            snippet(&body)
        ));
    }
    let value: Value = serde_json::from_str(&body).context("解析在线识别响应失败")?;
    let text = value["text"].as_str().unwrap_or("").trim();
    if text.is_empty() {
        let message = value["error"]["message"]
            .as_str()
            .or_else(|| value["message"].as_str())
            .unwrap_or("未返回文本");
        return Err(anyhow!("在线识别未返回文本: {}", message));
    }
    Ok(text.to_string())
}

// ── 阿里云百炼 Qwen3-ASR（OpenAI 兼容 chat + input_audio）──────

async fn transcribe_dashscope(config: &OnlineAsrConfig, samples: &[f32]) -> Result<String> {
    let wav = encode_wav(samples)?;
    let data_uri = format!("data:audio/wav;base64,{}", BASE64.encode(&wav));
    let body = json!({
        "model": config.model,
        "stream": false,
        "messages": [{
            "role": "user",
            "content": [{
                "type": "input_audio",
                "input_audio": { "data": data_uri }
            }]
        }]
    });

    let response = client()
        .post(chat_completions_url(&config.base_url))
        .bearer_auth(&config.api_key)
        .json(&body)
        .send()
        .await
        .context("百炼语音识别请求失败")?;
    let status = response.status();
    let body = response
        .text()
        .await
        .context("读取百炼语音识别响应失败")?;
    if !status.is_success() {
        return Err(anyhow!(
            "百炼语音识别 HTTP {}: {}",
            status.as_u16(),
            snippet(&body)
        ));
    }
    let value: Value = serde_json::from_str(&body).context("解析百炼语音识别响应失败")?;
    if let Some(text) = extract_content(&value["choices"][0]["message"]["content"]) {
        let text = text.trim();
        if !text.is_empty() {
            return Ok(text.to_string());
        }
    }
    let message = value["error"]["message"]
        .as_str()
        .or_else(|| value["message"].as_str())
        .unwrap_or("未返回文本");
    Err(anyhow!("百炼语音识别未返回文本: {}", message))
}

fn extract_content(content: &Value) -> Option<String> {
    if let Some(text) = content.as_str() {
        return Some(text.to_string());
    }
    if let Some(parts) = content.as_array() {
        let mut out = String::new();
        for part in parts {
            if let Some(text) = part["text"].as_str() {
                out.push_str(text);
            }
        }
        if !out.is_empty() {
            return Some(out);
        }
    }
    None
}

// ── 科大讯飞语音听写（流式 WebSocket）─────────────────────────

async fn transcribe_xfyun(config: &OnlineAsrConfig, samples: &[f32]) -> Result<String> {
    let url = build_xfyun_url(config)?;
    let (mut ws, _) = tokio_tungstenite::connect_async(url.as_str())
        .await
        .context("连接讯飞语音识别失败")?;

    let pcm = pcm16_bytes(samples);
    let chunks: Vec<&[u8]> = pcm.chunks(1280).collect();
    if chunks.is_empty() {
        return Err(anyhow!("音频为空"));
    }

    let first = json!({
        "common": { "app_id": config.app_id },
        "business": {
            "language": "zh_cn",
            "domain": "iat",
            "accent": "mandarin",
            "vad_eos": 10000,
            "ptt": 1
        },
        "data": {
            "status": 0,
            "format": "audio/L16;rate=16000",
            "encoding": "raw",
            "audio": BASE64.encode(chunks[0])
        }
    });
    ws.send(Message::Text(first.to_string().into()))
        .await
        .context("发送讯飞音频失败")?;

    for chunk in &chunks[1..] {
        let frame = json!({
            "data": {
                "status": 1,
                "format": "audio/L16;rate=16000",
                "encoding": "raw",
                "audio": BASE64.encode(*chunk)
            }
        });
        ws.send(Message::Text(frame.to_string().into()))
            .await
            .context("发送讯飞音频失败")?;
    }
    let last = json!({
        "data": {
            "status": 2,
            "format": "audio/L16;rate=16000",
            "encoding": "raw",
            "audio": ""
        }
    });
    ws.send(Message::Text(last.to_string().into()))
        .await
        .context("结束讯飞音频发送失败")?;

    let mut pieces: BTreeMap<i64, String> = BTreeMap::new();
    let mut next_sn = 0i64;
    while let Some(message) = ws.next().await {
        let message = message.context("读取讯飞语音识别响应失败")?;
        let text = match message {
            Message::Text(text) => text.as_str().to_string(),
            Message::Close(_) => break,
            _ => continue,
        };
        let value: Value =
            serde_json::from_str(&text).context("解析讯飞语音识别响应失败")?;
        let code = value["code"].as_i64().unwrap_or(0);
        if code != 0 {
            let message = value["message"].as_str().unwrap_or("unknown error");
            return Err(anyhow!("讯飞语音识别失败（{}）: {}", code, message));
        }
        if let Some(result) = value["data"]["result"].as_object() {
            if let Some(encoded) = result.get("text").and_then(|t| t.as_str()) {
                let decoded = BASE64.decode(encoded).context("解码讯飞识别结果失败")?;
                let result_value: Value =
                    serde_json::from_slice(&decoded).context("解析讯飞识别结果失败")?;
                let mut segment = String::new();
                if let Some(words) = result_value["ws"].as_array() {
                    for word in words {
                        if let Some(candidate) = word["cw"].as_array().and_then(|c| c.first()) {
                            if let Some(ch) = candidate["w"].as_str() {
                                segment.push_str(ch);
                            }
                        }
                    }
                }
                if !segment.is_empty() {
                    let sn = result
                        .get("sn")
                        .and_then(|s| s.as_i64())
                        .unwrap_or(next_sn);
                    next_sn = next_sn.max(sn + 1);
                    pieces.insert(sn, segment);
                }
            }
        }
        if value["data"]["status"].as_i64() == Some(2) {
            break;
        }
    }
    let _ = ws.close(None).await;

    let text = pieces.values().cloned().collect::<String>();
    if text.trim().is_empty() {
        return Err(anyhow!("讯飞语音识别未返回文本"));
    }
    Ok(text.trim().to_string())
}

fn build_xfyun_url(config: &OnlineAsrConfig) -> Result<String> {
    let date = chrono::Utc::now()
        .format("%a, %d %b %Y %H:%M:%S GMT")
        .to_string();
    let origin = format!(
        "host: {}\ndate: {}\nGET {} HTTP/1.1",
        XFYUN_HOST, date, XFYUN_PATH
    );
    let mut mac = Hmac::<Sha256>::new_from_slice(config.api_secret.as_bytes())
        .map_err(|e| anyhow!("讯飞签名密钥无效: {}", e))?;
    mac.update(origin.as_bytes());
    let signature = BASE64.encode(mac.finalize().into_bytes());
    let authorization_origin = format!(
        "api_key=\"{}\", algorithm=\"hmac-sha256\", headers=\"host date request-line\", signature=\"{}\"",
        config.api_key, signature
    );
    let authorization = BASE64.encode(authorization_origin.as_bytes());
    Ok(format!(
        "wss://{}{}?authorization={}&date={}&host={}",
        XFYUN_HOST,
        XFYUN_PATH,
        url_encode(&authorization),
        url_encode(&date),
        XFYUN_HOST
    ))
}

fn url_encode(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for byte in input.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char);
            }
            _ => out.push_str(&format!("%{:02X}", byte)),
        }
    }
    out
}

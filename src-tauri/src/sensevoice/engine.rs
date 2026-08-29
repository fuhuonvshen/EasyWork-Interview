// EasyWork - SenseVoice 语音转文字引擎
// 通过 sherpa-onnx 使用阿里的 SenseVoice 模型，专为中文优化。
// 支持中英粤日韩 + 简体中文精准识别 + 标点/ITN + 情感识别。

use anyhow::{Context, Result};
use futures_util::StreamExt;
use serde::Serialize;
use sherpa_onnx::{OfflineRecognizer, OfflineRecognizerConfig};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::RwLock;

use crate::whisper::engine::SegmentInfo;

// ── Chunking constants for long audio ──────────────────────────
// SenseVoice's OfflineRecognizer allocates O(n²) memory for self-attention.
// Chunking prevents OOM on long recordings while keeping GPU acceleration.
const SV_CHUNK_SAMPLES: usize = 480_000;   // 30s at 16kHz
const SV_OVERLAP_SAMPLES: usize = 16_000;  // 1s overlap to avoid cutting words
const SV_HOP_SAMPLES: usize = SV_CHUNK_SAMPLES - SV_OVERLAP_SAMPLES;
const SV_MIN_TAIL_SAMPLES: usize = 16_000; // merge if last chunk is shorter than this
const SV_SHORT_AUDIO_THRESH: usize = SV_CHUNK_SAMPLES + SV_MIN_TAIL_SAMPLES; // ~31s

/// Available SenseVoice models for download.
#[derive(Debug, Clone, Serialize)]
pub struct SvModelInfo {
    pub name: String,
    pub size_display: String,
    pub size_bytes: u64,
    pub downloaded: bool,
    pub is_recommended: bool,
}

const SENSEVOICE_MODELS: &[(&str, u64, bool)] = &[
    (
        "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17",
        155_000_000,
        true, // recommended: int8 quantized, 155MB
    ),
];

const DOWNLOAD_URLS: &[&str] = &[
    "https://hf-mirror.com/csukuangfj",
    "https://huggingface.co/csukuangfj",
];

/// Manages a SenseVoice model via sherpa-onnx.
pub struct SenseVoiceEngine {
    recognizer: RwLock<Option<Arc<OfflineRecognizer>>>,
    current_model: RwLock<Option<String>>,
    pub models_dir: PathBuf,
    cancel_download: AtomicBool,
}

fn format_bytes(bytes: u64) -> String {
    if bytes >= 1_000_000_000 {
        format!("{:.1} GB", bytes as f64 / 1_000_000_000.0)
    } else {
        format!("{} MB", bytes / 1_000_000)
    }
}

impl SenseVoiceEngine {
    pub fn new(models_dir: PathBuf) -> Self {
        Self {
            recognizer: RwLock::new(None),
            current_model: RwLock::new(None),
            models_dir,
            cancel_download: AtomicBool::new(false),
        }
    }

    /// List available SenseVoice models with download status.
    pub fn list_models(&self) -> Vec<SvModelInfo> {
        SENSEVOICE_MODELS
            .iter()
            .map(|(name, size, recommended)| {
                let model_dir = self.models_dir.join(name);
                let downloaded =
                    model_dir.join("model.int8.onnx").exists() || model_dir.join("model.onnx").exists();
                SvModelInfo {
                    name: name.to_string(),
                    size_bytes: *size,
                    size_display: format_bytes(*size),
                    downloaded,
                    is_recommended: *recommended,
                }
            })
            .collect()
    }

    /// Check if any model is available.
    pub fn any_model_downloaded(&self) -> bool {
        self.list_models().iter().any(|m| m.downloaded)
    }

    /// Get the models directory path.
    pub fn models_dir_str(&self) -> String {
        self.models_dir.to_string_lossy().to_string()
    }

    /// Download SenseVoice model files (model.int8.onnx + tokens.txt) from HuggingFace.
    pub async fn download_model(&self, model_name: &str, app: AppHandle) -> Result<()> {
        self.cancel_download.store(false, Ordering::SeqCst);

        let model_dir = self.models_dir.join(model_name);
        std::fs::create_dir_all(&model_dir).context("无法创建模型目录")?;

        // Download individual files: model.int8.onnx + tokens.txt
        let files: &[(&str, &str)] = &[
            ("model.int8.onnx", "模型文件"),
            ("tokens.txt", "词表文件"),
        ];

        for (filename, label) in files {
            if self.cancel_download.load(Ordering::SeqCst) {
                anyhow::bail!("下载已取消");
            }

            let dest = model_dir.join(filename);
            let mut downloaded = false;

            for base_url in DOWNLOAD_URLS {
                let url = format!(
                    "{}/{}/resolve/main/{}",
                    base_url, model_name, filename
                );
                log::info!("Downloading {} from: {}", label, url);

                let client = reqwest::Client::builder()
                    .connect_timeout(std::time::Duration::from_secs(15))
                    .build()
                    .context("创建 HTTP 客户端失败")?;

                match client.get(&url).send().await {
                    Ok(response) if response.status().is_success() => {
                        let total = response.content_length().unwrap_or(0);
                        let _ = app.emit("sv-download-progress", serde_json::json!({
                            "modelName": model_name,
                            "file": filename,
                            "progress": 0,
                            "totalSize": total,
                        }));

                        let mut stream = response.bytes_stream();
                        let mut data: Vec<u8> = Vec::new();
                        let mut dl: u64 = 0;
                        let mut last_pct: u8 = 0;
                        let mut last_speed_report = std::time::Instant::now();
                        let mut bytes_since_speed: u64 = 0;

                        while let Some(chunk) = stream.next().await {
                            if self.cancel_download.load(Ordering::SeqCst) {
                                anyhow::bail!("下载已取消");
                            }
                            let chunk = chunk.context("下载失败")?;
                            data.extend_from_slice(&chunk);
                            dl += chunk.len() as u64;
                            bytes_since_speed += chunk.len() as u64;

                            let pct = if total > 0 { ((dl * 100) / total) as u8 } else { 0 };
                            let elapsed = last_speed_report.elapsed().as_secs_f32();
                            let speed = if elapsed >= 0.5 {
                                let s = (bytes_since_speed as f32 / elapsed) as u64;
                                bytes_since_speed = 0;
                                last_speed_report = std::time::Instant::now();
                                s
                            } else { 0 };

                            if pct > last_pct || elapsed >= 0.5 {
                                last_pct = pct;
                                let _ = app.emit("sv-download-progress", serde_json::json!({
                                    "modelName": model_name,
                                    "file": filename,
                                    "progress": pct,
                                    "downloadedBytes": dl,
                                    "totalSize": total,
                                    "speed": speed,
                                }));
                            }
                        }

                        std::fs::write(&dest, &data)
                            .with_context(|| format!("写入 {} 失败", filename))?;
                        downloaded = true;
                        log::info!("{} downloaded: {} bytes", filename, data.len());
                        break;
                    }
                    Ok(response) => {
                        log::warn!("{}: 服务器返回 {}", label, response.status());
                        continue;
                    }
                    Err(e) => {
                        log::warn!("{}: 连接失败: {}", label, e);
                        continue;
                    }
                }
            }

            if !downloaded {
                anyhow::bail!("无法下载 {}", filename);
            }
        }

        let _ = app.emit("sv-download-complete", serde_json::json!({
            "modelName": model_name,
        }));
        log::info!("SenseVoice model downloaded: {}", model_name);
        Ok(())
    }

    /// Cancel ongoing download.
    pub fn cancel_download(&self) {
        self.cancel_download.store(true, Ordering::SeqCst);
    }

    /// Load a SenseVoice model.
    pub async fn load_model(&self, model_name: &str) -> Result<()> {
        let model_dir = self.models_dir.join(model_name);

        // Prefer int8 quantized model (smaller, faster)
        let model_path = if model_dir.join("model.int8.onnx").exists() {
            model_dir.join("model.int8.onnx")
        } else {
            model_dir.join("model.onnx")
        };

        let tokens_path = model_dir.join("tokens.txt");

        if !model_path.exists() {
            anyhow::bail!(
                "模型文件不存在: {}\n请先下载 SenseVoice 模型",
                model_path.display()
            );
        }
        if !tokens_path.exists() {
            anyhow::bail!("tokens.txt 不存在: {}", tokens_path.display());
        }

        log::info!(
            "Loading SenseVoice model: {}",
            model_path.display()
        );

        let mut config = OfflineRecognizerConfig::default();
        config.model_config.sense_voice.model =
            Some(model_path.to_string_lossy().to_string());
        config.model_config.tokens =
            Some(tokens_path.to_string_lossy().to_string());
        config.model_config.num_threads = std::thread::available_parallelism()
            .map(|n| n.get() as i32)
            .unwrap_or(4);
        // Use ITN (inverse text normalization) for cleaner output
        config.model_config.sense_voice.use_itn = true;

        let recognizer = OfflineRecognizer::create(&config)
            .with_context(|| format!("无法加载 SenseVoice 模型: {}", model_path.display()))?;

        let mut guard = self.recognizer.write().await;
        *guard = Some(Arc::new(recognizer));

        let mut name_guard = self.current_model.write().await;
        *name_guard = Some(model_name.to_string());

        log::info!("SenseVoice model loaded: {}", model_name);
        Ok(())
    }

    /// Unload SenseVoice model and free its memory.
    pub async fn unload_model(&self) {
        let mut guard = self.recognizer.write().await;
        *guard = None;
        let mut name_guard = self.current_model.write().await;
        *name_guard = None;
        log::info!("SenseVoice model unloaded");
    }

    /// Transcribe audio. Audio must be 16kHz mono f32.
    /// Short audio (<31s) runs directly. Long audio is split into overlapping
    /// chunks to avoid O(n²) memory blowup in self-attention.
    pub async fn transcribe(&self, audio: &[f32]) -> Result<String> {
        // 1. Clone the Arc<OfflineRecognizer> and release lock promptly.
        let recognizer = {
            let guard = self.recognizer.read().await;
            guard
                .as_ref()
                .ok_or_else(|| anyhow::anyhow!("SenseVoice 模型未加载"))?
                .clone()
        };

        // 2. Empty audio fast path.
        if audio.is_empty() {
            return Ok(String::new());
        }

        // 3. Short audio: no chunking needed.
        if audio.len() <= SV_SHORT_AUDIO_THRESH {
            return Self::transcribe_chunk(&recognizer, audio);
        }

        // 4. Long audio: split into overlapping chunks.
        let total_secs = audio.len() as f64 / 16000.0;
        let n_est = (audio.len() - SV_OVERLAP_SAMPLES) / SV_HOP_SAMPLES + 1;
        log::info!(
            "SenseVoice: chunking {:.0}s audio into ~{} chunks",
            total_secs, n_est
        );

        let mut results: Vec<String> = Vec::new();
        let mut pos = 0;

        while pos < audio.len() {
            let end = std::cmp::min(pos + SV_CHUNK_SAMPLES, audio.len());

            // Merge a very short tail into the current chunk.
            let chunk_end = if audio.len() - end < SV_MIN_TAIL_SAMPLES && end < audio.len() {
                audio.len()
            } else {
                end
            };

            let chunk = &audio[pos..chunk_end];
            log::debug!(
                "SenseVoice: chunk [{}, {}) ({:.1}s)",
                pos, chunk_end,
                chunk.len() as f64 / 16000.0,
            );

            match Self::transcribe_chunk(&recognizer, chunk) {
                Ok(text) if !text.is_empty() => {
                    log::debug!("SenseVoice: chunk result ({} chars)", text.len());
                    results.push(text);
                }
                Ok(_) => {} // empty chunk result, skip
                Err(e) => {
                    log::warn!("SenseVoice: chunk [{}, {}) failed: {}", pos, chunk_end, e);
                }
            }

            if chunk_end == audio.len() {
                break;
            }
            pos += SV_HOP_SAMPLES;
        }

        if results.is_empty() {
            anyhow::bail!("SenseVoice: 所有音频块均转写失败");
        }

        let merged = Self::merge_texts(&results);
        log::info!("SenseVoice: chunking done — {} chunks → {} chars", results.len(), merged.len());
        Ok(merged)
    }

    /// Transcribe audio and return per-chunk timestamps. SenseVoice has no
    /// model-level segment timestamps, so we approximate: each 30s chunk's
    /// text gets the chunk's audio window as its time range.
    pub async fn transcribe_segments(&self, audio: &[f32]) -> Result<Vec<SegmentInfo>> {
        let recognizer = {
            let guard = self.recognizer.read().await;
            guard
                .as_ref()
                .ok_or_else(|| anyhow::anyhow!("SenseVoice 模型未加载"))?
                .clone()
        };

        if audio.is_empty() {
            return Ok(Vec::new());
        }

        // Short audio: single segment over the whole clip.
        if audio.len() <= SV_SHORT_AUDIO_THRESH {
            let text = Self::transcribe_chunk(&recognizer, audio)?;
            if text.is_empty() {
                return Ok(Vec::new());
            }
            let secs = audio.len() as f32 / 16000.0;
            return Ok(vec![SegmentInfo { start: 0.0, end: secs, text }]);
        }

        let mut segments: Vec<SegmentInfo> = Vec::new();
        let mut pos = 0;

        while pos < audio.len() {
            let end = std::cmp::min(pos + SV_CHUNK_SAMPLES, audio.len());

            // Merge a very short tail into the current chunk.
            let chunk_end = if audio.len() - end < SV_MIN_TAIL_SAMPLES && end < audio.len() {
                audio.len()
            } else {
                end
            };

            let chunk = &audio[pos..chunk_end];
            match Self::transcribe_chunk(&recognizer, chunk) {
                Ok(text) if !text.is_empty() => {
                    segments.push(SegmentInfo {
                        start: pos as f32 / 16000.0,
                        end: chunk_end as f32 / 16000.0,
                        text,
                    });
                }
                Ok(_) => {}
                Err(e) => {
                    log::warn!("SenseVoice: chunk [{}, {}) failed: {}", pos, chunk_end, e);
                }
            }

            if chunk_end == audio.len() {
                break;
            }
            pos += SV_HOP_SAMPLES;
        }

        Ok(segments)
    }

    /// Transcribe a single audio chunk (no chunking logic).
    fn transcribe_chunk(recognizer: &OfflineRecognizer, audio: &[f32]) -> Result<String> {
        let stream = recognizer.create_stream();
        stream.accept_waveform(16000, audio);
        recognizer.decode(&stream);
        let result = stream.get_result().context("SenseVoice 转写块失败")?;
        Ok(result.text.trim().to_string())
    }

    /// Find the longest common suffix of `acc` that is also a prefix of `new`.
    /// Operates on character boundaries to avoid UTF-8 slicing panics.
    fn find_text_overlap(acc: &str, new: &str) -> usize {
        let acc_chars: Vec<char> = acc.chars().collect();
        let new_chars: Vec<char> = new.chars().collect();
        let max = std::cmp::min(acc_chars.len(), new_chars.len());

        for i in (1..=max).rev() {
            let suffix: String = acc_chars[acc_chars.len() - i..].iter().collect();
            let prefix: String = new_chars[..i].iter().collect();
            if suffix == prefix {
                return prefix.len(); // byte length, safe for slicing `new`
            }
        }
        0
    }

    /// Merge chunk texts, deduplicating overlapping boundaries.
    fn merge_texts(results: &[String]) -> String {
        if results.is_empty() {
            return String::new();
        }
        let mut merged = results[0].clone();
        for chunk_text in &results[1..] {
            if chunk_text.is_empty() {
                continue;
            }
            let overlap = Self::find_text_overlap(&merged, chunk_text);
            if overlap < chunk_text.len() {
                merged.push_str(&chunk_text[overlap..]);
            }
        }
        merged
    }

    /// Delete a downloaded model.
    pub fn delete_model(&self, model_name: &str) -> Result<()> {
        let model_dir = self.models_dir.join(model_name);
        if model_dir.exists() {
            std::fs::remove_dir_all(&model_dir)
                .with_context(|| format!("无法删除模型: {}", model_dir.display()))?;
        }
        log::info!("SenseVoice model deleted: {}", model_name);
        Ok(())
    }

    pub async fn is_loaded(&self) -> bool {
        self.recognizer.read().await.is_some()
    }

    /// Ensure a model is loaded; auto-load the first downloaded model if none is loaded.
    pub async fn ensure_model_loaded(&self) -> Result<(), String> {
        if self.is_loaded().await {
            return Ok(());
        }
        let available = self.list_models();
        if let Some(model) = available.iter().find(|m| m.downloaded) {
            log::info!("Lazy-loading SenseVoice model: {}", model.name);
            self.load_model(&model.name).await.map_err(|e| format!("自动加载 SenseVoice 模型失败: {}", e))
        } else {
            Err("SenseVoice 模型未加载，且未找到已下载的模型".to_string())
        }
    }
}

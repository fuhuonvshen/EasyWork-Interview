// EasyWork - Whisper 语音转文字引擎
// 封装 whisper-rs（whisper.cpp 的 Rust 绑定），提供模型管理 + 音频转文字。
//
// 核心能力：
//   load_model()      - 加载 GGML 模型文件到内存
//   transcribe()      - 16kHz mono f32 → 中文文本
//   download_model()  - 从 Hugging Face 下载模型，支持断点续传 + 前端进度事件
//   resume_download() - 从断点恢复下载
//   delete_model()    - 删除已下载的模型
//   list_models()     - 列出可用模型及其下载状态
//   convert_audio_for_whisper() - 立体声/高采样率 → 单声道 16kHz

use anyhow::{Context, Result};
use futures_util::StreamExt;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
// Engine uses a progress callback — event emission is handled by the command layer.
// See meetily's whisper_engine/commands.rs for the pattern.
use tokio::sync::RwLock;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

/// A transcribed segment with timestamps, used for click-to-seek playback.
#[derive(Debug, Clone, Serialize)]
pub struct SegmentInfo {
    pub start: f32,
    pub end: f32,
    pub text: String,
}

/// Model metadata exposed to the frontend.
#[derive(Debug, Clone, Serialize)]
pub struct ModelInfo {
    pub name: String,
    pub size_bytes: u64,
    pub size_display: String,
    pub downloaded: bool,
    pub is_recommended: bool,
    pub has_partial: bool,
    pub partial_bytes: u64,
}

/// Available Whisper models for download.
const MODEL_LIST: &[(&str, u64)] = &[
    ("ggml-small.bin", 488_000_000),
    ("ggml-medium.bin", 1_530_000_000),
];

/// Primary and fallback download URLs for Whisper models.
/// hf-mirror.com is a HuggingFace mirror accessible from China.
const DOWNLOAD_URLS: &[&str] = &[
    "https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main",
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main",
];

/// Manages a Whisper.cpp model for speech-to-text transcription.
pub struct WhisperEngine {
    context: Arc<RwLock<Option<WhisperContext>>>,
    current_model: RwLock<Option<String>>,
    pub models_dir: PathBuf,
    cancel_download: AtomicBool,
    // Download progress tracking (pollable from frontend)
    download_progress: std::sync::atomic::AtomicU8,
    download_status: std::sync::Mutex<Option<String>>, // None=idle, Some("downloading")/"complete"/"error:..."
    pub downloaded_bytes: std::sync::atomic::AtomicU64,
    pub total_bytes: std::sync::atomic::AtomicU64,
    pub download_speed: std::sync::atomic::AtomicU64,
}

fn format_bytes(bytes: u64) -> String {
    if bytes >= 1_000_000_000 {
        format!("{:.1} GB", bytes as f64 / 1_000_000_000.0)
    } else if bytes >= 1_000_000 {
        format!("{} MB", bytes / 1_000_000)
    } else {
        format!("{} KB", bytes / 1_000)
    }
}

impl WhisperEngine {
    pub fn new(models_dir: PathBuf) -> Self {
        Self {
            context: Arc::new(RwLock::new(None)),
            current_model: RwLock::new(None),
            models_dir,
            cancel_download: AtomicBool::new(false),
            download_progress: std::sync::atomic::AtomicU8::new(0),
            download_status: std::sync::Mutex::new(None),
            downloaded_bytes: std::sync::atomic::AtomicU64::new(0),
            total_bytes: std::sync::atomic::AtomicU64::new(0),
            download_speed: std::sync::atomic::AtomicU64::new(0),
        }
    }

    /// Get current download state (polled by frontend every 500ms).
    pub fn get_download_state(&self) -> serde_json::Value {
        let progress = self.download_progress.load(Ordering::SeqCst);
        let status = self.download_status.lock().unwrap().clone();
        let downloaded = self.downloaded_bytes.load(Ordering::SeqCst);
        let total = self.total_bytes.load(Ordering::SeqCst);
        let speed = self.download_speed.load(Ordering::SeqCst);
        serde_json::json!({
            "status": status.unwrap_or_else(|| "idle".to_string()),
            "progress": progress,
            "downloadedBytes": downloaded,
            "totalBytes": total,
            "speed": speed,
        })
    }

    /// List all available models with their download status.
    pub fn list_models(&self) -> Vec<ModelInfo> {
        MODEL_LIST
            .iter()
            .map(|(name, size)| {
                let dest = self.models_dir.join(name);
                let partial = dest.with_extension("partial");
                let downloaded = dest.exists();
                let has_partial = partial.exists();
                let partial_bytes = if has_partial {
                    std::fs::metadata(&partial).map(|m| m.len()).unwrap_or(0)
                } else {
                    0
                };
                ModelInfo {
                    name: name.to_string(),
                    size_bytes: *size,
                    size_display: format_bytes(*size),
                    downloaded,
                    is_recommended: *name == "ggml-small.bin",
                    has_partial,
                    partial_bytes,
                }
            })
            .collect()
    }

    /// Check whether a model file or partial download exists.
    pub fn model_exists(&self, filename: &str) -> bool {
        self.models_dir.join(filename).exists()
    }

    /// Get path to a partial download file.
    pub fn partial_path(&self, filename: &str) -> PathBuf {
        self.models_dir.join(filename).with_extension("partial")
    }

    /// Download a model, updating shared state (pollable by frontend).
    /// Uses multiple mirror URLs, resumable via HTTP Range.
    pub async fn download_model(&self, filename: &str) -> Result<()> {
        self.cancel_download.store(false, Ordering::SeqCst);
        self.download_progress.store(0, Ordering::SeqCst);
        self.downloaded_bytes.store(0, Ordering::SeqCst);
        self.total_bytes.store(0, Ordering::SeqCst);
        self.download_speed.store(0, Ordering::SeqCst);
        *self.download_status.lock().unwrap() = Some("downloading".to_string());

        let dest = self.models_dir.join(filename);
        let partial = dest.with_extension("partial");

        std::fs::create_dir_all(&self.models_dir)
            .context("无法创建模型目录")?;

        let resume_from = if partial.exists() {
            std::fs::metadata(&partial).map(|m| m.len()).unwrap_or(0)
        } else {
            0
        };

        let mut last_error = String::new();
        for base_url in DOWNLOAD_URLS {
            let url = format!("{}/{}", base_url, filename);
            log::info!("Downloading from {} (resume={})", url, resume_from);

            let client = reqwest::Client::builder()
                .connect_timeout(std::time::Duration::from_secs(15))
                .build()
                .context("创建 HTTP 客户端失败")?;

            let mut request = client.get(&url);
            if resume_from > 0 {
                request = request.header("Range", format!("bytes={}-", resume_from));
            }

            match request.send().await {
                Ok(response) => {
                    if !response.status().is_success()
                        && response.status() != reqwest::StatusCode::PARTIAL_CONTENT
                    {
                        last_error = format!("服务器返回 {}", response.status());
                        continue;
                    }

                    let total_size = if response.status() == reqwest::StatusCode::PARTIAL_CONTENT
                    {
                        response.content_length().unwrap_or(0) + resume_from
                    } else {
                        response.content_length().unwrap_or(0)
                    };

                    let mut stream = response.bytes_stream();
                    let mut downloaded = resume_from;
                    let mut last_progress: u8 = 0;
                    let mut last_speed_tick = std::time::Instant::now();
                    let mut bytes_in_tick: u64 = 0;

                    let mut data = if resume_from > 0 && partial.exists() {
                        std::fs::read(&partial).unwrap_or_default()
                    } else {
                        Vec::new()
                    };

                    self.total_bytes.store(total_size, Ordering::SeqCst);
                    self.downloaded_bytes.store(downloaded, Ordering::SeqCst);

                    while let Some(chunk) = stream.next().await {
                        if self.cancel_download.load(Ordering::SeqCst) {
                            std::fs::write(&partial, &data).ok();
                            *self.download_status.lock().unwrap() = Some("cancelled".to_string());
                            self.download_progress.store(last_progress, Ordering::SeqCst);
                            self.downloaded_bytes.store(downloaded, Ordering::SeqCst);
                            self.download_speed.store(0, Ordering::SeqCst);
                            anyhow::bail!("下载已取消");
                        }

                        let chunk = match chunk {
                            Ok(c) => c,
                            Err(e) => {
                                std::fs::write(&partial, &data).ok();
                                last_error = format!("下载中断: {}", e);
                                break;
                            }
                        };
                        data.extend_from_slice(&chunk);
                        downloaded += chunk.len() as u64;
                        bytes_in_tick += chunk.len() as u64;

                        // Always update bytes; update % when it changes
                        self.downloaded_bytes.store(downloaded, Ordering::SeqCst);
                        let pct = if total_size > 0 { ((downloaded * 100) / total_size) as u8 } else { 0 };
                        if pct != last_progress {
                            last_progress = pct;
                            self.download_progress.store(pct, Ordering::SeqCst);
                        }

                        // Update speed independently every 1s
                        let elapsed = last_speed_tick.elapsed().as_secs_f32();
                        if elapsed >= 1.0 {
                            let spd = (bytes_in_tick as f32 / elapsed) as u64;
                            self.download_speed.store(spd, Ordering::SeqCst);
                            bytes_in_tick = 0;
                            last_speed_tick = std::time::Instant::now();
                        }
                    }

                    // Download complete
                    if total_size > 0 && downloaded >= total_size {
                        let tmp = dest.with_extension("tmp");
                        std::fs::write(&tmp, &data).context("写入模型文件失败")?;
                        std::fs::rename(&tmp, &dest).context("安装模型文件失败")?;
                        let _ = std::fs::remove_file(&partial);

                        self.download_progress.store(100, Ordering::SeqCst);
                        self.downloaded_bytes.store(downloaded, Ordering::SeqCst);
                        self.download_speed.store(0, Ordering::SeqCst);
                        *self.download_status.lock().unwrap() = Some("complete".to_string());
                        log::info!("Model {} downloaded successfully", filename);
                        return Ok(());
                    }

                    std::fs::write(&partial, &data).ok();
                    last_error = "下载未完成，已保存进度".to_string();
                }
                Err(e) => {
                    last_error = format!("连接失败: {}", e);
                    continue;
                }
            }
        }

        *self.download_status.lock().unwrap() = Some(format!("error:{}", last_error));
        self.download_progress.store(0, Ordering::SeqCst);
        anyhow::bail!(last_error)
    }

    /// Cancel an ongoing download (saves partial progress).
    pub fn cancel_download(&self) {
        self.cancel_download.store(true, Ordering::SeqCst);
    }

    /// Delete a downloaded model file and any partial data.
    pub fn delete_model(&self, filename: &str) -> Result<()> {
        let path = self.models_dir.join(filename);
        let partial = path.with_extension("partial");

        if path.exists() {
            std::fs::remove_file(&path)
                .with_context(|| format!("无法删除模型文件: {}", path.display()))?;
        }
        if partial.exists() {
            std::fs::remove_file(&partial).ok();
        }

        log::info!("Model deleted: {}", filename);
        Ok(())
    }

    /// Get the path to the models directory as a string.
    pub fn models_dir_str(&self) -> String {
        self.models_dir.to_string_lossy().to_string()
    }

    /// Load a Whisper GGML model by name.
    pub async fn load_model(&self, filename: &str) -> Result<()> {
        let model_path = self.models_dir.join(filename);

        if !model_path.exists() {
            anyhow::bail!(
                "模型文件不存在: {}\n请先将 GGML 模型文件下载到 {}",
                model_path.display(),
                self.models_dir.display()
            );
        }

        log::info!("Loading Whisper model: {}", model_path.display());

        let params = WhisperContextParameters {
            use_gpu: false,
            gpu_device: 0,
            flash_attn: false,
            ..Default::default()
        };

        let ctx = WhisperContext::new_with_params(model_path.as_path(), params)
            .with_context(|| format!("无法加载模型: {}", model_path.display()))?;

        let mut guard = self.context.write().await;
        *guard = Some(ctx);

        let mut name_guard = self.current_model.write().await;
        *name_guard = Some(filename.to_string());

        log::info!("Model loaded: {}", filename);
        Ok(())
    }

    /// Unload Whisper model and free its memory.
    pub async fn unload_model(&self) {
        let mut guard = self.context.write().await;
        *guard = None;
        let mut name_guard = self.current_model.write().await;
        *name_guard = None;
        log::info!("Whisper model unloaded");
    }

    /// Transcribe audio samples. Audio must be 16kHz mono f32.
    pub async fn transcribe(&self, audio: &[f32]) -> Result<String> {
        let guard = self.context.read().await;
        let ctx = guard
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("没有加载模型，请先加载 Whisper 模型"))?;

        let mut state = ctx
            .create_state()
            .context("无法创建 Whisper 状态")?;

        let mut params = FullParams::new(SamplingStrategy::BeamSearch {
            beam_size: 5,
            patience: 1.0,
        });

        params.set_no_timestamps(true);
        params.set_print_special(false);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);
        params.set_language(Some("zh"));

        // Auto-detect thread count so Whisper utilizes all CPU cores
        let n_threads = std::thread::available_parallelism()
            .map(|n| n.get() as i32)
            .unwrap_or(4);
        params.set_n_threads(n_threads);

        state
            .full(params, audio)
            .context("语音转文字失败")?;

        let num_segments = state.full_n_segments();
        let mut result = String::new();

        for i in 0..num_segments {
            let segment = state
                .get_segment(i)
                .ok_or_else(|| anyhow::anyhow!("无法获取第 {} 个转写片段", i))?;

            let text = segment
                .to_str_lossy()
                .with_context(|| format!("无法读取第 {} 个转写文本", i))?;

            let trimmed = text.trim();
            if !trimmed.is_empty() {
                if !result.is_empty() {
                    result.push('\n');
                }
                result.push_str(trimmed);
            }
        }

        Ok(result)
    }

    pub async fn is_loaded(&self) -> bool {
        self.context.read().await.is_some()
    }

    /// Transcribe audio and return per-segment timestamps (for click-to-seek
    /// audio playback). Timestamps come from Whisper's own segments.
    pub async fn transcribe_segments(&self, audio: &[f32]) -> Result<Vec<SegmentInfo>> {
        let guard = self.context.read().await;
        let ctx = guard
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("没有加载模型，请先加载 Whisper 模型"))?;

        let mut state = ctx
            .create_state()
            .context("无法创建 Whisper 状态")?;

        let mut params = FullParams::new(SamplingStrategy::BeamSearch {
            beam_size: 5,
            patience: 1.0,
        });

        // Timestamps must be enabled to get segment start/end times
        params.set_no_timestamps(false);
        params.set_print_special(false);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);
        params.set_language(Some("zh"));

        let n_threads = std::thread::available_parallelism()
            .map(|n| n.get() as i32)
            .unwrap_or(4);
        params.set_n_threads(n_threads);

        state
            .full(params, audio)
            .context("语音转文字失败")?;

        let num_segments = state.full_n_segments();
        let mut segments = Vec::with_capacity(num_segments as usize);

        for i in 0..num_segments {
            let segment = state
                .get_segment(i)
                .ok_or_else(|| anyhow::anyhow!("无法获取第 {} 个转写片段", i))?;

            let text = segment
                .to_str_lossy()
                .with_context(|| format!("无法读取第 {} 个转写文本", i))?;
            let trimmed = text.trim();
            if trimmed.is_empty() {
                continue;
            }

            // whisper.cpp timestamps are 100ns ticks: seconds = t / 1e7
            let t0 = segment.start_timestamp();
            let t1 = segment.end_timestamp();
            segments.push(SegmentInfo {
                start: (t0 as f64 / 1e7) as f32,
                end: (t1 as f64 / 1e7) as f32,
                text: trimmed.to_string(),
            });
        }

        Ok(segments)
    }

    /// Ensure a model is loaded; auto-load the first downloaded model if none is loaded.
    pub async fn ensure_model_loaded(&self) -> Result<(), String> {
        if self.is_loaded().await {
            return Ok(());
        }
        let available = self.list_models();
        let model = available
            .iter()
            .find(|m| m.downloaded && m.is_recommended)
            .or_else(|| available.iter().find(|m| m.downloaded));
        match model {
            Some(m) => {
                log::info!("Lazy-loading Whisper model: {}", m.name);
                self.load_model(&m.name).await.map_err(|e| format!("自动加载 Whisper 模型失败: {}", e))
            }
            None => Err("没有加载模型，且未找到已下载的模型".to_string()),
        }
    }
}

/// Convert captured audio to Whisper-compatible format (16kHz mono f32).
pub fn convert_audio_for_whisper(
    samples: &[f32],
    channels: u16,
    source_rate: u32,
) -> Vec<f32> {
    let target_rate: u32 = 16000;

    let mono: Vec<f32> = if channels > 1 {
        samples
            .chunks(channels as usize)
            .map(|frame| frame.iter().sum::<f32>() / channels as f32)
            .collect()
    } else {
        samples.to_vec()
    };

    if source_rate == target_rate {
        mono
    } else {
        let ratio = source_rate as f64 / target_rate as f64;
        let out_len = (mono.len() as f64 / ratio).ceil() as usize;
        let mut resampled = Vec::with_capacity(out_len);

        for i in 0..out_len {
            let src_idx = (i as f64 * ratio) as usize;
            let frac = (i as f64 * ratio) - src_idx as f64;
            let a = mono.get(src_idx).copied().unwrap_or(0.0);
            let b = mono.get(src_idx + 1).copied().unwrap_or(a);
            resampled.push(a + (b - a) * frac as f32);
        }

        resampled
    }
}

/// Format seconds into a human-readable ETA string.
fn format_eta(seconds: f64) -> String {
    if seconds < 60.0 {
        format!("{}秒", seconds as u64)
    } else if seconds < 3600.0 {
        format!("{}分{}秒", seconds as u64 / 60, seconds as u64 % 60)
    } else {
        format!(
            "{}时{}分",
            seconds as u64 / 3600,
            (seconds as u64 % 3600) / 60
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_convert_stereo_48k_to_16k_mono() {
        let input = vec![0.0f32; 48000 * 2];
        let output = convert_audio_for_whisper(&input, 2, 48000);
        assert_eq!(output.len(), 16000);
    }

    #[test]
    fn test_convert_mono_passthrough() {
        let input = vec![0.5f32; 16000];
        let output = convert_audio_for_whisper(&input, 1, 16000);
        assert_eq!(output.len(), 16000);
    }
}

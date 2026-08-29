// EasyWork - 说话人区分引擎
// 基于 sherpa-onnx 的 SpeakerEmbeddingExtractor 实现实时声纹比对。
// 对 VAD 切割出的每个语音段提取声纹 embedding，通过与已知说话人比对来区分身份。

use anyhow::{Context, Result};
use futures_util::StreamExt;
use sherpa_onnx::{
    SpeakerEmbeddingExtractor, SpeakerEmbeddingExtractorConfig, SpeakerEmbeddingManager,
};
use std::path::{Path, PathBuf};
use tauri::Emitter;

/// 中文声纹模型（eres2net，专为中文说话人识别优化，~52MB）
const DIARIZATION_MODEL: &str = "3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k";

/// 下载地址（GitHub Releases，sherpa-onnx 官方分发）
const DOWNLOAD_URLS: &[&str] = &[
    "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models",
];

/// 说话人区分引擎。
///
/// 内部维护：
/// - `extractor`: 从语音段提取固定维度的声纹 embedding
/// - `manager`: 管理已知说话人的 embedding 索引，支持 search/add
pub struct DiarizationEngine {
    extractor: SpeakerEmbeddingExtractor,
    manager: SpeakerEmbeddingManager,
    dim: i32,
}

impl DiarizationEngine {
    /// 从模型文件创建引擎。
    pub fn new(model_path: &Path) -> Result<Self> {
        if !model_path.exists() {
            anyhow::bail!("声纹模型文件不存在: {}", model_path.display());
        }

        let config = SpeakerEmbeddingExtractorConfig {
            model: Some(model_path.to_string_lossy().to_string()),
            num_threads: 2,
            debug: false,
            provider: None,
        };

        let extractor = SpeakerEmbeddingExtractor::create(&config)
            .context("无法创建 SpeakerEmbeddingExtractor，请检查模型文件")?;
        let dim = extractor.dim();

        let manager = SpeakerEmbeddingManager::create(dim)
            .context("无法创建 SpeakerEmbeddingManager")?;

        log::info!(
            "说话人区分引擎就绪 (模型: {}, 维度: {})",
            model_path.display(),
            dim
        );

        Ok(Self {
            extractor,
            manager,
            dim,
        })
    }

    /// 对一段 16kHz mono 音频提取声纹并匹配说话人。
    ///
    /// 返回说话人名称（如 "参会者_1"），如果音频太短无法提取则返回 None。
    pub fn diarize(&self, audio: &[f32]) -> Option<String> {
        if audio.len() < 8000 {
            // 至少需要 0.5 秒（16kHz 下 8000 采样点）
            return None;
        }

        let stream = self.extractor.create_stream()?;
        stream.accept_waveform(16000, audio);

        if !self.extractor.is_ready(&stream) {
            log::debug!("声纹提取: 音频过短，跳过");
            return None;
        }

        let embedding = self.extractor.compute(&stream)?;

        if embedding.len() != self.dim as usize {
            log::warn!("声纹维度异常: 期望 {}, 实际 {}", self.dim, embedding.len());
            return None;
        }

        // 阈值 0.25：宽松匹配，对 AI 合成语音更友好
        const THRESHOLD: f32 = 0.25;

        if let Some(name) = self.manager.search(&embedding, THRESHOLD) {
            log::debug!("说话人匹配: {} (score >= {})", name, THRESHOLD);
            Some(name)
        } else {
            let num = self.manager.num_speakers() + 1;
            let name = format!("参会者_{}", num);
            self.manager.add(&name, &embedding);
            log::info!("新说话人: {}", name);
            Some(name)
        }
    }

    /// 获取当前已知的说话人数量。
    #[allow(dead_code)]
    pub fn num_speakers(&self) -> i32 {
        self.manager.num_speakers()
    }

    /// 重置所有说话人信息（新会议时调用）。
    #[allow(dead_code)]
    pub fn reset(&self) {
        for name in self.manager.get_all_speakers() {
            self.manager.remove(&name);
        }
        log::info!("说话人列表已重置");
    }
}

// ── Model download ─────────────────────────────────────────────
pub async fn ensure_model_downloaded(models_dir: &Path, app_handle: &tauri::AppHandle) -> Result<PathBuf> {
    let model_dir = models_dir.join(DIARIZATION_MODEL);
    let model_path = model_dir.join("model.onnx");

    if model_path.exists() {
        log::info!("声纹模型已存在: {}", model_path.display());
        return Ok(model_path);
    }

    std::fs::create_dir_all(&model_dir)
        .context("无法创建声纹模型目录")?;

    let mut downloaded = false;
    for base_url in DOWNLOAD_URLS {
        let url = format!("{}/{}.onnx", base_url, DIARIZATION_MODEL);
        log::info!("正在下载声纹模型: {}", url);

        let client = reqwest::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(15))
            .build()
            .context("创建 HTTP 客户端失败")?;

        match client.get(&url).send().await {
            Ok(response) if response.status().is_success() => {
                let total = response.content_length().unwrap_or(0);
                let mut stream = response.bytes_stream();
                let mut data: Vec<u8> = Vec::new();
                let mut downloaded_bytes: u64 = 0;
                let mut last_pct: u8 = 0;

                while let Some(chunk) = stream.next().await {
                    let chunk = chunk.context("下载声纹模型中断")?;
                    data.extend_from_slice(&chunk);
                    downloaded_bytes += chunk.len() as u64;
                    if total > 0 {
                        let pct = ((downloaded_bytes * 100) / total) as u8;
                        if pct != last_pct {
                            last_pct = pct;
                            let _ = app_handle.emit("diarization-download-progress", serde_json::json!({
                                "progress": pct, "downloadedBytes": downloaded_bytes, "totalSize": total,
                            }));
                        }
                    }
                }

                std::fs::write(&model_path, &data)
                    .context("写入声纹模型文件失败")?;
                downloaded = true;
                let _ = app_handle.emit("diarization-download-progress", serde_json::json!({
                    "progress": 100, "downloadedBytes": data.len(), "totalSize": data.len(),
                }));
                log::info!("声纹模型下载完成: {:.1}MB", data.len() as f64 / 1_000_000.0);
                break;
            }
            Ok(response) => {
                log::warn!("{} 返回 {}", url, response.status());
                continue;
            }
            Err(e) => {
                log::warn!("{} 连接失败: {}", url, e);
                continue;
            }
        }
    }

    if !downloaded {
        anyhow::bail!("无法下载声纹模型，说话人区分功能不可用");
    }

    Ok(model_path)
}


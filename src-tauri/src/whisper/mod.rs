// EasyWork - 语音转文字模块入口
// 声明 engine 子模块（Whisper 模型加载、转写、下载）。

pub mod commands;
pub mod engine;

use anyhow::{Context, Result};
use std::path::Path;
use std::sync::Arc;

/// 初始化 Whisper 引擎：创建引擎，扫描已下载模型但不自动加载。
pub async fn init(models_dir: &Path) -> Result<Arc<engine::WhisperEngine>> {
    if !models_dir.exists() {
        std::fs::create_dir_all(models_dir)
            .context("创建 Whisper 模型目录失败")?;
    }
    log::info!("Whisper models directory: {}", models_dir.display());

    let engine = Arc::new(engine::WhisperEngine::new(models_dir.to_path_buf()));
    log::info!("Whisper engine created (model not loaded)");
    Ok(engine)
}

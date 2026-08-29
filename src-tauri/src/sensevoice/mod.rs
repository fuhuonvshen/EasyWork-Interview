pub mod commands;
pub mod engine;
pub mod noise;

use anyhow::{Context, Result};
use std::path::Path;
use std::sync::Arc;

/// 初始化 SenseVoice 引擎：创建引擎，不自动加载模型。
pub async fn init(models_dir: &Path) -> Result<Arc<engine::SenseVoiceEngine>> {
    if !models_dir.exists() {
        std::fs::create_dir_all(models_dir)
            .context("创建 SenseVoice 模型目录失败")?;
    }
    log::info!("SenseVoice models directory: {}", models_dir.display());

    let engine = Arc::new(engine::SenseVoiceEngine::new(models_dir.to_path_buf()));
    log::info!("SenseVoice engine created (model not loaded)");
    Ok(engine)
}
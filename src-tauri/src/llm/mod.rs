// EasyWork - 本地 LLM 推理模块（llama.cpp HTTP server + GGUF 模型管理）

pub mod commands;
pub mod engine;
pub mod models;

use anyhow::{Context, Result};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::RwLock;
use crate::llm::engine::LlmEngine;

/// 初始化 LLM 引擎：创建引擎，复制二进制，自动加载模型。
pub async fn init(models_dir: &Path, bin_dir: &Path, resource_dir: Option<&Path>, dev_bin_dir: Option<&Path>) -> Result<Arc<RwLock<LlmEngine>>> {
    std::fs::create_dir_all(models_dir)
        .context("创建 LLM 模型目录失败")?;
    std::fs::create_dir_all(bin_dir)
        .context("创建 LLM 二进制目录失败")?;

    // 1. Create engine (gpu_layers starts at 0, will update after binary is ready)
    let engine = Arc::new(RwLock::new(LlmEngine::new(
        models_dir.to_path_buf(),
        bin_dir.to_path_buf(),
    )));

    // 2. GPU driver detection FIRST, so ensure_binary (which reads gpu_layers)
    //    can pick the CUDA archive instead of the CPU one. macOS: Metal always.
    #[cfg(target_os = "macos")]
    let has_driver = true;
    #[cfg(not(target_os = "macos"))]
    let has_driver = LlmEngine::has_nvidia_driver();
    if has_driver {
        engine.write().await.gpu_layers = 99;
    }
    log::info!("GPU driver detected: {}, gpu_layers={}", has_driver, if has_driver { 99 } else { 0 });

    // 3. Ensure llama-server binary exists. copy_from_bundle runs every
    //    launch and fills in missing files (self-healing), so a bin_dir that
    //    lost its CUDA runtime DLLs recovers without manual cleanup.
    let mut binary_copied = false;
    if let Some(dev_dir) = dev_bin_dir {
        if engine.read().await.copy_from_bundle(dev_dir).is_ok() {
            binary_copied = true;
        }
    }

    // Try production bundle (resource dir)
    if !binary_copied {
        if let Some(res_dir) = resource_dir {
            let bundle_path = res_dir.join("binaries");
            if engine.read().await.copy_from_bundle(&bundle_path).is_ok() {
                binary_copied = true;
            }
        }
    }

    // 不再自动下载：缺少二进制时由用户在「模型管理」中手动下载，
    // 以便展示下载进度（Windows 常见场景）。
    if !binary_copied {
        log::info!("llama-server 二进制缺失，等待用户在模型管理中下载");
    }

    // 4. Synchronous copy paths only: verify the CUDA runtime DLL actually
    //    landed in bin_dir. Driver without runtime → CPU fallback.
    #[cfg(not(target_os = "macos"))]
    if has_driver && !LlmEngine::has_cuda_runtime(bin_dir) {
        log::warn!("NVIDIA 驱动存在但 CUDA 运行库 (cudart64_*) 不在 bin 目录 — 降级为 CPU 推理");
        engine.write().await.gpu_layers = 0;
    }

    Ok(engine)
}

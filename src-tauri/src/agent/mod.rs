pub mod commands;
pub mod sidecar;

use anyhow::Result;
use sidecar::{AgentSidecar, spawn_python_server, wait_for_healthy};
use std::collections::HashMap;
use std::path::Path;

/// 启动 Python Agent sidecar 并等待健康检查。
/// 返回 (sidecar 代理, 子进程句柄)，上层负责注册到 Tauri state。
/// `bundled_agent` 是可选的内置 agent 可执行文件路径（由 PyInstaller 打包）。
pub async fn init(
    project_dir: &Path,
    manifest_dir: &Path,
    db_path: &Path,
    port: u16,
    settings: &HashMap<String, String>,
    bundled_agent: Option<&Path>,
) -> Result<(AgentSidecar, Option<tokio::process::Child>)> {
    log::info!("Starting Python agent sidecar on port {}...", port);
    let sidecar = AgentSidecar::new(port);

    match spawn_python_server(project_dir, manifest_dir, db_path, port, settings, bundled_agent).await {
        Ok(mut child) => {
            // Pipe stdout/stderr to logs
            if let Some(stdout) = child.stdout.take() {
                tokio::spawn(async move {
                    use tokio::io::AsyncBufReadExt;
                    let mut reader = tokio::io::BufReader::new(stdout);
                    let mut line = String::new();
                    while reader.read_line(&mut line).await.is_ok() && !line.is_empty() {
                        log::info!("[python-agent] {}", line.trim_end());
                        line.clear();
                    }
                });
            }
            if let Some(stderr) = child.stderr.take() {
                tokio::spawn(async move {
                    use tokio::io::AsyncBufReadExt;
                    let mut reader = tokio::io::BufReader::new(stderr);
                    let mut line = String::new();
                    while reader.read_line(&mut line).await.is_ok() && !line.is_empty() {
                        log::warn!("[python-agent] {}", line.trim_end());
                        line.clear();
                    }
                });
            }

            // Wait for health check
            match wait_for_healthy(&sidecar, std::time::Duration::from_secs(30)).await {
                Ok(()) => {
                    log::info!("Agent: Python server healthy on port {}", port);
                    Ok((sidecar, Some(child)))
                }
                Err(e) => {
                    log::error!("Agent: Python server failed to start: {}", e);
                    let _ = child.start_kill();
                    // Return sidecar anyway (commands will return errors gracefully)
                    Ok((sidecar, None))
                }
            }
        }
        Err(e) => {
            log::error!("Agent: Failed to spawn Python server: {}", e);
            Ok((sidecar, None))
        }
    }
}

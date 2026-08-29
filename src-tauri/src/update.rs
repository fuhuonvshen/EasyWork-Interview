// EasyWork - 应用更新辅助命令
// Windows 更新全流程自研（插件 downloadAndInstall 同步等待 msiexec 结束，
// 而应用进程活着时 sidecar 锁住安装文件 → 安装必然失败，无法救回）：
//   update_check   → 读 update.json（走系统代理），返回最新版信息
//   update_download → 下载 MSI 到临时目录，发 update-progress 事件
//   install_update → 清理 sidecar → 异步启动 msiexec → 退出应用

use futures_util::StreamExt;
use serde::Deserialize;
use std::collections::HashMap;
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncWriteExt;

use crate::cleanup_child_process;

const UPDATE_JSON_URL: &str = "https://github.com/fuhuonvshen/EasyWork/releases/latest/download/update.json";

#[derive(Deserialize)]
struct UpdateManifest {
    version: String,
    notes: Option<String>,
    platforms: HashMap<String, PlatformArtifact>,
}

#[derive(Deserialize)]
struct PlatformArtifact {
    url: String,
    #[allow(dead_code)]
    signature: Option<String>,
}

async fn fetch_manifest() -> Result<UpdateManifest, String> {
    let client = reqwest::Client::builder()
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;
    client
        .get(UPDATE_JSON_URL)
        .send()
        .await
        .map_err(|e| format!("获取更新信息失败: {}", e))?
        .json::<UpdateManifest>()
        .await
        .map_err(|e| format!("解析更新信息失败: {}", e))
}

/// 检查更新：返回最新版本信息（仅当高于当前版本时）。
#[tauri::command]
pub async fn update_check(app: AppHandle) -> Result<Option<serde_json::Value>, String> {
    let manifest = fetch_manifest().await?;
    let current = app.package_info().version.to_string();
    if manifest.version <= current {
        return Ok(None);
    }
    let artifact = manifest
        .platforms
        .get("windows-x86_64")
        .ok_or("更新清单中缺少 Windows 安装包")?;
    Ok(Some(serde_json::json!({
        "version": manifest.version,
        "notes": manifest.notes.unwrap_or_default(),
        "url": artifact.url,
    })))
}

/// 下载更新安装包（MSI）到临时目录，进度通过 update-progress 事件上报。
#[tauri::command]
pub async fn update_download(app: AppHandle, url: String) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("下载失败: {}", e))?;
    let total = resp.content_length();

    let dest = std::env::temp_dir().join(format!(
        "easywork-update-{}.msi",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0)
    ));
    let mut file = tokio::fs::File::create(&dest)
        .await
        .map_err(|e| format!("创建临时文件失败: {}", e))?;

    let mut stream = resp.bytes_stream();
    let mut downloaded: u64 = 0;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("下载中断: {}", e))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("写入文件失败: {}", e))?;
        downloaded += chunk.len() as u64;
        if let Some(t) = total {
            if t > 0 {
                let pct = ((downloaded * 100) / t).min(100) as u8;
                let _ = app.emit("update-progress", pct);
            }
        }
    }
    file.flush().await.ok();

    log::info!("更新包已下载: {} ({:.1} MB)", dest.display(), downloaded as f64 / 1024.0 / 1024.0);
    Ok(dest.to_string_lossy().to_string())
}

/// 更新安装前退出应用：先清理 sidecar 子进程（easywork-agent / llama-server，
/// 否则它们锁住安装目录文件导致 MSI 安装失败 Error 1310），再正常退出
/// 让 msiexec 完成安装。不要使用 relaunch——新进程会再次锁住安装文件。
#[tauri::command]
pub async fn exit_for_update(app: AppHandle) {
    let app2 = app.clone();
    tauri::async_runtime::spawn_blocking(move || cleanup_child_process(&app2))
        .await
        .ok();
    app.exit(0);
}

/// Windows 更新安装：下载完成后调用。
/// 先清理 sidecar 子进程（否则锁住安装目录文件导致 Error 1310），再异步
/// 启动 msiexec（/passive）并退出应用，让 msiexec 在应用退出后完成安装。
/// 不要用插件内置的 downloadAndInstall——它同步等待 msiexec 结束才返回，
/// 而此时应用进程仍在运行、sidecar 仍锁着文件，安装必然失败。
#[tauri::command]
pub async fn install_update(app: AppHandle, installer_path: String) -> Result<(), String> {
    let app2 = app.clone();
    tauri::async_runtime::spawn_blocking(move || cleanup_child_process(&app2))
        .await
        .map_err(|e| format!("清理子进程失败: {}", e))?;

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("msiexec")
            .args(["/i", &installer_path, "/passive", "/norestart"])
            .spawn()
            .map_err(|e| format!("启动安装程序失败: {}", e))?;
        log::info!("msiexec 已启动: {}", installer_path);
    }

    #[cfg(not(target_os = "windows"))]
    {
        return Err("此安装方式仅支持 Windows".into());
    }

    app.exit(0);
    Ok(())
}

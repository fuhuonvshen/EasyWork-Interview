// EasyWork - 应用更新辅助命令
// Windows 更新全流程自研（插件 downloadAndInstall 同步等待安装器结束，
// 而应用进程活着时 sidecar 锁住安装文件 → 安装必然失败，无法救回）：
//   update_check   → 读 update.json（走系统代理），返回最新版信息
//   update_download → 下载安装包（NSIS .exe，与初始安装一致）到临时目录，发进度事件
//   install_update → 清理 sidecar → 异步启动安装器 → 退出应用
//
// 统一走 NSIS：MSI 每版本注册独立产品代码，更新会在「设置 → 应用」里累积
// 多个卸载条目，且与 NSIS 的 uninstall.exe 并存导致半卸载；NSIS 覆盖升级
// 始终复用同一卸载键，卸载入口只有 uninstall.exe。

use futures_util::StreamExt;
use serde::Deserialize;
use std::collections::HashMap;
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncWriteExt;

use crate::cleanup_child_process;

const UPDATE_JSON_URL: &str = "https://github.com/fuhuonvshen/EasyWork-Interview/releases/latest/download/update.json";

/// 启动时清理 %TEMP% 残留的更新安装包/脚本（超过 1 小时的视为上次
/// 更新未完成/失败的残留；刚下载的包安装只需几分钟，不会被误删）。
pub fn cleanup_stale_update_files() {
    let cutoff = std::time::SystemTime::now()
        .checked_sub(std::time::Duration::from_secs(3600))
        .unwrap_or(std::time::SystemTime::now());
    if let Ok(rd) = std::fs::read_dir(std::env::temp_dir()) {
        for entry in rd.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.starts_with("easywork-update-") {
                continue;
            }
            if !(name.ends_with(".exe") || name.ends_with(".msi") || name.ends_with(".bat")) {
                continue;
            }
            let stale = entry
                .metadata()
                .ok()
                .and_then(|m| m.modified().ok())
                .map(|t| t < cutoff)
                .unwrap_or(false);
            if stale {
                if let Err(e) = std::fs::remove_file(entry.path()) {
                    log::warn!("清理旧更新包失败 {}: {}", entry.path().display(), e);
                } else {
                    log::info!("已清理旧更新包: {}", entry.path().display());
                }
            }
        }
    }
}

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

/// 下载更新安装包（NSIS .exe / 兼容 .msi）到临时目录，进度通过 update-progress 事件上报。
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

    // 临时文件扩展名必须与安装器类型一致（install_update 按扩展名选择启动方式）
    let ext = if url.to_ascii_lowercase().ends_with(".msi") { "msi" } else { "exe" };
    let dest = std::env::temp_dir().join(format!(
        "easywork-update-{}.{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0),
        ext
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
/// 否则它们锁住安装目录文件导致安装失败），再正常退出让安装器完成安装。
/// 不要使用 relaunch——新进程会再次锁住安装文件。
#[tauri::command]
pub async fn exit_for_update(app: AppHandle) {
    let app2 = app.clone();
    tauri::async_runtime::spawn_blocking(move || cleanup_child_process(&app2))
        .await
        .ok();
    app.exit(0);
}

/// Windows 更新安装：下载完成后调用。
/// 先清理 sidecar 子进程（否则锁住安装目录文件导致安装失败），再异步启动
/// 安装器并退出应用，让安装器在应用退出后完成覆盖安装。
/// NSIS（.exe，默认）：/S 静默覆盖升级，卸载键复用，卸载入口只有 uninstall.exe。
/// MSI（.msi，兼容旧 update.json）：msiexec /passive。
/// 不要用插件内置的 downloadAndInstall——它同步等待安装器结束才返回，
/// 而此时应用进程仍在运行、sidecar 仍锁着文件，安装必然失败。
#[tauri::command]
pub async fn install_update(app: AppHandle, installer_path: String) -> Result<(), String> {
    let app2 = app.clone();
    tauri::async_runtime::spawn_blocking(move || cleanup_child_process(&app2))
        .await
        .map_err(|e| format!("清理子进程失败: {}", e))?;

    #[cfg(target_os = "windows")]
    {
        if installer_path.to_ascii_lowercase().ends_with(".msi") {
            std::process::Command::new("msiexec")
                .args(["/i", &installer_path, "/passive", "/norestart"])
                .spawn()
                .map_err(|e| format!("启动安装程序失败: {}", e))?;
            log::info!("msiexec 已启动: {}", installer_path);
        } else {
            // NSIS 静默升级（/S）覆盖安装前会先跑旧版卸载器删除文件：若本应用
            // 进程尚未完全退出，删除会被占用拒绝 → 静默安装直接失败且无提示
            // （表现：进度条后应用退出，重开仍是旧版、又提示更新）。
            // 对策：写临时 bat，延时约 2 秒后再启动安装器（进程句柄已释放），
            // bat 执行完自删，不依赖 cmd 对复杂引号命令行的解析。
            let bat = std::env::temp_dir().join(format!(
                "easywork-update-{}.bat",
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_secs())
                    .unwrap_or(0)
            ));
            let script = format!(
                "@echo off\r\nping -n 3 127.0.0.1 > nul\r\n\"{}\" /S\r\ndel \"%~f0\"\r\n",
                installer_path
            );
            std::fs::write(&bat, script)
                .map_err(|e| format!("写入安装脚本失败: {}", e))?;
            std::process::Command::new("cmd")
                .arg("/c")
                .arg(&bat)
                .spawn()
                .map_err(|e| format!("启动安装程序失败: {}", e))?;
            log::info!("NSIS 安装器已调度（延时 2s 的临时脚本 {}）", bat.display());
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        return Err("此安装方式仅支持 Windows".into());
    }

    // 留出时间让界面展示「正在完成安装」提示，再退出交给安装器
    tokio::time::sleep(std::time::Duration::from_millis(2000)).await;
    app.exit(0);
    Ok(())
}

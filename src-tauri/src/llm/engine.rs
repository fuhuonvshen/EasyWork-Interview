// EasyWork - LLM 推理引擎
// 管理 llama-server 进程生命周期 + GGUF 模型下载 + 推理调用
//
// 架构：
//   LlmEngine (全局单例)
//     ├─ 复制捆绑的 llama-server 二进制到数据目录
//     ├─ 下载 GGUF 模型文件（HuggingFace，参考 whisper/engine.rs 模式）
//     ├─ 启动/停止 llama-server 子进程
//     └─ 通过 HTTP 调 /v1/chat/completions 做推理

use anyhow::{Context, Result};
use futures_util::StreamExt;
use reqwest::Client;
use std::path::PathBuf;
use std::process::Stdio;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering};
use std::sync::{Arc, Mutex};
use tokio::sync::RwLock;

use crate::llm::models;

// ── Constants ──

const LLAMA_SERVER_PORT: u16 = 11435;
const REQUEST_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(600);
const SERVER_START_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(180);

// ── Engine ──

pub struct LlmEngine {
    pub models_dir: PathBuf,
    pub bin_dir: PathBuf,
    pub server_url: String,
    pub gpu_layers: u32,

    // Server process
    server_process: Arc<Mutex<Option<tokio::process::Child>>>,
    /// Which model name (e.g. "qwen3.5:2b") is loaded, if any
    pub current_model: RwLock<Option<String>>,

    // Download state (polled by frontend, same pattern as WhisperEngine)
    cancel_download: AtomicBool,
    download_progress: AtomicU8,
    download_status: Mutex<Option<String>>,
    downloaded_bytes: AtomicU64,
    total_bytes: AtomicU64,
    download_speed: AtomicU64,

    // Idle tracking for auto-shutdown
    last_used: Arc<Mutex<std::time::Instant>>,
}

impl LlmEngine {
    /// Create engine. `models_dir` is where GGUF files go (configurable).
    /// `bin_dir` is where the llama-server binary goes (always under app data).
    pub fn new(models_dir: PathBuf, bin_dir: PathBuf) -> Self {
        std::fs::create_dir_all(&models_dir).ok();
        std::fs::create_dir_all(&bin_dir).ok();

        Self {
            models_dir,
            bin_dir,
            server_url: format!("http://127.0.0.1:{}", LLAMA_SERVER_PORT),
            gpu_layers: 0,  // Updated after binary copy in init()
            server_process: Arc::new(Mutex::new(None)),
            current_model: RwLock::new(None),
            cancel_download: AtomicBool::new(false),
            download_progress: AtomicU8::new(0),
            download_status: Mutex::new(None),
            downloaded_bytes: AtomicU64::new(0),
            total_bytes: AtomicU64::new(0),
            download_speed: AtomicU64::new(0),
            last_used: Arc::new(Mutex::new(std::time::Instant::now())),
        }
    }

    // ── Binary management ──

    /// Path to llama-server binary
    pub fn bin_path(&self) -> PathBuf {
        self.bin_dir.join(if cfg!(target_os = "windows") { "llama-server.exe" } else { "llama-server" })
    }

    /// Check if llama-server binary exists (and DLL on Windows)
    pub fn is_binary_ready(&self) -> bool {
        if !self.bin_path().exists() {
            return false;
        }
        #[cfg(target_os = "windows")]
        {
            if !self.bin_dir.join("llama-server-impl.dll").exists() {
                return false;
            }
        }
        true
    }

    /// CUDA runtime DLLs required by the CUDA build of llama-server.
    /// Newer llama.cpp release zips no longer ship them — they come in a
    /// separate `cudart-llama-bin-*.zip` asset.
    #[cfg(target_os = "windows")]
    pub fn cuda_runtime_dlls() -> [&'static str; 3] {
        ["cudart64_12.dll", "cublas64_12.dll", "cublasLt64_12.dll"]
    }

    /// Strict check: all CUDA runtime DLLs present in bin_dir.
    #[cfg(target_os = "windows")]
    pub fn has_cuda_runtime_dlls(bin_dir: &std::path::Path) -> bool {
        Self::cuda_runtime_dlls()
            .iter()
            .all(|f| bin_dir.join(f).exists())
    }

    /// Copy the bundled llama-server binary (and all companion DLLs) to bin_dir.
    /// Called once during app setup. Missing files are copied in; existing
    /// files are kept (bin_dir may already hold a downloaded build), so a
    /// partially-populated bin_dir self-heals on next launch.
    pub fn copy_from_bundle(&self, bundle_path: &std::path::Path) -> Result<()> {
        std::fs::create_dir_all(&self.bin_dir)?;

        if !bundle_path.exists() {
            return Err(anyhow::anyhow!("bundle path not found: {:?}", bundle_path));
        }

        let mut found_exe = self.is_binary_ready();
        for entry in std::fs::read_dir(bundle_path)
            .context("读取 bundle 目录失败")?
        {
            let entry = entry?;
            let fname = entry.file_name();
            let name = fname.to_string_lossy();

            let is_binary = cfg!(target_os = "windows")
                && (name.ends_with(".exe") || name.ends_with(".dll"))
                || (!cfg!(target_os = "windows")
                    && (name == "llama-server" || name.ends_with(".dylib")));
            if !is_binary {
                continue;
            }

            let dst = self.bin_dir.join(&*name);
            if dst.exists() {
                if name == "llama-server.exe" || name == "llama-server" {
                    found_exe = true;
                }
                continue;
            }
            // A file may be locked (e.g. agent running from bin_dir) — don't
            // abort the whole copy, just skip it and let the download path
            // or the next launch fill the gap.
            if let Err(e) = std::fs::copy(entry.path(), &dst) {
                log::warn!("copy {} failed: {}", name, e);
                continue;
            }
            if name == "llama-server.exe" || name == "llama-server" {
                found_exe = true;
                log::info!("llama-server copied to {:?}", dst);
            }
        }

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if let Ok(meta) = std::fs::metadata(self.bin_path()) {
                let mut perms = meta.permissions();
                perms.set_mode(0o755);
                let _ = std::fs::set_permissions(self.bin_path(), perms);
            }
        }

        if !found_exe {
            return Err(anyhow::anyhow!("bundle directory missing llama-server executable"));
        }
        log::info!("llama-server bundle copied to {:?}", self.bin_dir);
        Ok(())
    }

    /// Download llama-server binary if not present.
    pub async fn ensure_binary(&self) -> Result<()> {
        // Windows self-heal: NVIDIA driver present but bin_dir lacks the CUDA
        // runtime DLLs. Newer llama.cpp CUDA zips no longer ship cudart/cublas
        // (separate `cudart-llama-bin-*.zip` asset) — top up just the runtime
        // instead of re-downloading the whole build.
        #[cfg(target_os = "windows")]
        if Self::has_nvidia_driver() && !Self::has_cuda_runtime_dlls(&self.bin_dir) {
            if self.is_binary_ready() {
                log::warn!("llama-server 已就位但缺少 CUDA 运行库 — 仅下载运行库包");
                return self.ensure_cuda_runtime().await;
            }
        }
        if self.is_binary_ready() {
            return Ok(());
        }
        std::fs::create_dir_all(&self.bin_dir)
            .context("创建二进制目录失败")?;

        let tag = "b10034";
        // macOS 资产是 .tar.gz，其他平台是 .zip。
        // CUDA 版选择只看 NVIDIA 驱动，不能依赖 bin 目录现状。
        let (platform, is_targz) = if cfg!(target_os = "windows") {
            (if Self::has_nvidia_driver() { "win-cuda-12.4-x64" } else { "win-cpu-x64" }, false)
        } else if cfg!(target_os = "macos") { ("macos-arm64", true) }
        else { ("linux-x64", false) };
        let ext = if is_targz { "tar.gz" } else { "zip" };

        // Try the hardcoded URL first
        let asset_name = format!("llama-{tag}-bin-{platform}.{}", ext);
        let url = format!("https://github.com/ggml-org/llama.cpp/releases/download/{tag}/{asset_name}");
        match self.download_and_extract_with_retry(&url, is_targz, 3).await {
            Ok(()) => {}
            Err(e) => {
                log::warn!("固定地址下载失败 ({}), 尝试通过 GitHub API 查找正确资产...", e);
                // Fallback: query GitHub API for the latest release and find the matching asset
                let tag_new = self.latest_release_tag().await?;
                let mut found: Option<String> = None;
                let api_url = "https://api.github.com/repos/ggml-org/llama.cpp/releases/latest";
                let client = reqwest::Client::builder()
                    .user_agent("EasyWork")
                    .build()
                    .context("创建 HTTP 客户端失败")?;
                let json: serde_json::Value = client.get(api_url).send().await
                    .context("查询 llama.cpp 最新版本失败")?
                    .json().await
                    .context("解析 GitHub API 响应失败")?;
                if let Some(assets) = json["assets"].as_array() {
                    for asset in assets {
                        let name = asset["name"].as_str().unwrap_or("");
                        if name.contains(platform) && (name.ends_with(&ext) || name.ends_with(".zip")) {
                            found = Some(name.to_string());
                            break;
                        }
                    }
                }
                let asset_name = found.ok_or_else(|| anyhow::anyhow!(
                    "未在 llama.cpp 最新版本 ({}) 中找到匹配资产 (平台: {})", tag_new, platform
                ))?;
                let is_targz = asset_name.ends_with(".tar.gz");
                let url = format!("https://github.com/ggml-org/llama.cpp/releases/download/{}/{}", tag_new, asset_name);
                log::info!("通过 GitHub API 找到资产: {}", asset_name);
                self.download_and_extract_with_retry(&url, is_targz, 3).await?;
            }
        }

        // CUDA build downloaded — top up the CUDA runtime DLLs (newer llama.cpp
        // zips don't include them; they live in a separate cudart asset).
        #[cfg(target_os = "windows")]
        if Self::has_nvidia_driver() && !Self::has_cuda_runtime_dlls(&self.bin_dir) {
            self.ensure_cuda_runtime().await?;
        }
        Ok(())
    }

    /// Query llama.cpp latest release tag via GitHub API.
    async fn latest_release_tag(&self) -> Result<String> {
        let api_url = "https://api.github.com/repos/ggml-org/llama.cpp/releases/latest";
        let client = reqwest::Client::builder()
            .user_agent("EasyWork")
            .build()
            .context("创建 HTTP 客户端失败")?;
        let resp = client.get(api_url).send().await
            .context("查询 llama.cpp 最新版本失败")?;
        if !resp.status().is_success() {
            anyhow::bail!("GitHub API 返回 {}", resp.status());
        }
        let json: serde_json::Value = resp.json().await
            .context("解析 GitHub API 响应失败")?;
        Ok(json["tag_name"].as_str().unwrap_or("b10034").to_string())
    }

    /// Download the CUDA runtime package (cudart/cublas/cublasLt) into bin_dir.
    /// Newer llama.cpp releases ship these as a separate
    /// `cudart-llama-bin-win-cuda-12.4-x64.zip` asset.
    #[cfg(target_os = "windows")]
    async fn ensure_cuda_runtime(&self) -> Result<()> {
        let tag = self.latest_release_tag().await?;
        let url = format!(
            "https://github.com/ggml-org/llama.cpp/releases/download/{}/cudart-llama-bin-win-cuda-12.4-x64.zip",
            tag
        );
        log::info!("下载 CUDA 运行库包 ({}): {}", tag, url);
        self.download_and_extract_with_retry(&url, false, 3).await
    }

    /// Download + extract with automatic retries (exponential backoff).
    async fn download_and_extract_with_retry(
        &self,
        url: &str,
        is_targz: bool,
        retries: u32,
    ) -> Result<()> {
        let mut last_err: Option<anyhow::Error> = None;
        for attempt in 0..retries {
            match self.download_and_extract(url, is_targz).await {
                Ok(()) => return Ok(()),
                Err(e) => {
                    log::warn!("下载失败 (第 {}/{} 次尝试): {}", attempt + 1, retries, e);
                    last_err = Some(e);
                    if attempt + 1 < retries {
                        tokio::time::sleep(
                            std::time::Duration::from_secs(3 * (attempt as u64 + 1)),
                        )
                        .await;
                    }
                }
            }
        }
        Err(last_err.unwrap_or_else(|| anyhow::anyhow!("下载失败")))
    }

    /// Download llama-server archive and extract executable + companion files into bin_dir.
    /// `is_targz` selects .tar.gz (macOS) vs .zip (Windows/Linux) handling.
    /// Streams with progress so the frontend can show a download bar.
    async fn download_and_extract(&self, url: &str, is_targz: bool) -> Result<()> {
        log::info!("Downloading llama-server from {}", url);
        self.set_status("downloading");
        self.download_progress.store(0, Ordering::SeqCst);
        self.downloaded_bytes.store(0, Ordering::SeqCst);
        self.total_bytes.store(0, Ordering::SeqCst);
        self.download_speed.store(0, Ordering::SeqCst);

        let response = reqwest::get(url)
            .await
            .context("下载 llama-server 失败")?;

        if !response.status().is_success() {
            anyhow::bail!("HTTP {}", response.status());
        }

        let total = response.content_length().unwrap_or(0);
        self.total_bytes.store(total, Ordering::SeqCst);

        let tmp_path = self.bin_dir.join("llama-server-tmp.archive");
        let mut file = tokio::fs::File::create(&tmp_path)
            .await
            .context("创建临时文件失败")?;

        use tokio::io::AsyncWriteExt;
        let mut stream = response.bytes_stream();
        let mut downloaded: u64 = 0;
        let mut last_time = std::time::Instant::now();
        let mut bytes_since_last: u64 = 0;
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.context("读取下载流失败")?;
            file.write_all(&chunk).await?;
            downloaded += chunk.len() as u64;
            bytes_since_last += chunk.len() as u64;

            if total > 0 {
                self.download_progress.store((downloaded * 100 / total) as u8, Ordering::SeqCst);
            }
            self.downloaded_bytes.store(downloaded, Ordering::SeqCst);

            let elapsed = last_time.elapsed().as_secs_f32();
            if elapsed >= 1.0 {
                self.download_speed.store((bytes_since_last as f32 / elapsed) as u64, Ordering::SeqCst);
                bytes_since_last = 0;
                last_time = std::time::Instant::now();
            }
        }
        file.flush().await?;
        drop(file);

        let file = std::fs::File::open(&tmp_path)?;
        let file_len = downloaded as usize;

        if is_targz {
            // macOS: tar.gz 格式 — 扁平解压 llama-server + 全部 .dylib 依赖库
            let gz = flate2::read::GzDecoder::new(file);
            let mut archive = tar::Archive::new(gz);
            let mut found = false;
            for entry in archive.entries().with_context(|| format!("解析 tar.gz 失败 ({} bytes)", file_len))? {
                let mut entry = entry.context("读取 tar 条目失败")?;
                if entry.header().entry_type().is_dir() {
                    continue;
                }
                let path = entry.path().context("读取 tar 路径失败")?.to_path_buf();
                if let Some(name) = path.file_name().map(|n| n.to_string_lossy().to_string()) {
                    if name == "llama-server" || name.ends_with(".dylib") {
                        let dst = self.bin_dir.join(&name);
                        let mut out = std::fs::File::create(&dst)?;
                        std::io::copy(&mut entry, &mut out)?;
                        log::info!("Extracted: {}", name);
                        if name == "llama-server" {
                            found = true;
                        }
                    }
                }
            }
            if !found {
                anyhow::bail!("tar.gz 中未找到 llama-server 可执行文件");
            }
            #[cfg(target_os = "macos")]
            {
                use std::os::unix::fs::PermissionsExt;
                let exe = self.bin_dir.join("llama-server");
                if let Ok(meta) = std::fs::metadata(&exe) {
                    let mut perms = meta.permissions();
                    perms.set_mode(0o755);
                    let _ = std::fs::set_permissions(&exe, perms);
                }
            }
        } else {
            // Windows/Linux: zip 格式
            let mut archive = zip::ZipArchive::new(file)
                .with_context(|| format!("解析 zip 文件失败 ({} bytes)", file_len))?;
            for i in 0..archive.len() {
                let mut entry = archive.by_index(i)?;
                let name = entry.name().to_string();
                // Extract exe, DLLs (Windows), or unix binary (macOS/Linux).
                // Flatten to file names only — some zips (e.g. the cudart
                // runtime package) keep files under subdirectories.
                let fname = std::path::Path::new(&name)
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string());
                let Some(fname) = fname else { continue };
                if fname.ends_with(".exe") || fname.ends_with(".dll") || fname == "llama-server" {
                    let dst = self.bin_dir.join(&fname);
                    let mut out = std::fs::File::create(&dst)?;
                    std::io::copy(&mut entry, &mut out)?;
                    log::info!("Extracted: {}", fname);
                }
            }
        }

        let _ = std::fs::remove_file(&tmp_path);
        self.set_status("complete");
        self.download_progress.store(100, Ordering::SeqCst);
        log::info!("llama-server downloaded & extracted to {:?}", self.bin_dir);
        Ok(())
    }

    // ── Server process management ──

    /// Start llama-server with the given model
    pub async fn start_server(&self, model_name: &str) -> Result<()> {
        // Stop existing server first
        self.stop_server().await;

        let gguf_file = models::get_gguf_filename(model_name)
            .ok_or_else(|| anyhow::anyhow!("未知模型: {}", model_name))?;
        let model_path = self.models_dir.join(gguf_file);
        if !model_path.exists() {
            return Err(anyhow::anyhow!("模型文件未下载: {}", gguf_file));
        }

        let ngl = self.gpu_layers;
        let bin_path = self.bin_path();
        if !bin_path.exists() {
            return Err(anyhow::anyhow!("llama-server 未就绪，请在「模型管理」中下载"));
        }

        // Try GPU mode first, fall back to CPU on CUDA init failure
        let mut ngl = ngl;
        loop {
            log::info!("Starting llama-server: {} --n-gpu-layers {} --port {}", bin_path.display(), ngl, LLAMA_SERVER_PORT);
            let mut cmd = tokio::process::Command::new(&bin_path);
            cmd.arg("--model")
                .arg(&model_path)
                .arg("--host")
                .arg("127.0.0.1")
                .arg("--port")
                .arg(LLAMA_SERVER_PORT.to_string())
                .arg("--n-gpu-layers")
                .arg(ngl.to_string())
                .arg("--ctx-size")
                .arg("32768")
                // 把模型思考提取到 message.reasoning_content（DeepSeek 同款格式），
                // 前端可分离显示；非思考模型不受影响
                .arg("--reasoning-format")
                .arg("deepseek");

            #[cfg(target_os = "windows")]
            cmd.as_std_mut().creation_flags(0x08000000);

            match cmd.spawn() {
                Ok(child) => {
                    // Store process handle
                    {
                        let mut proc = self.server_process.lock().unwrap();
                        *proc = Some(child);
                    }
                    break;
                }
                Err(e) if ngl > 0 => {
                    log::warn!("llama-server GPU 模式启动失败 ({}), 降级到 CPU 模式", e);
                    ngl = 0;
                    continue;
                }
                Err(e) => {
                    return Err(anyhow::anyhow!("启动 llama-server 失败: {}", e));
                }
            }
        }

        // Wait for health
        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(5))
            .build()
            .map_err(|e| anyhow::anyhow!("创建 HTTP 客户端失败: {}", e))?;

        let health_url = format!("http://127.0.0.1:{}/health", LLAMA_SERVER_PORT);
        let start = std::time::Instant::now();

        loop {
            if start.elapsed() > SERVER_START_TIMEOUT {
                self.stop_server().await;
                return Err(anyhow::anyhow!("llama-server 启动超时（180s）"));
            }
            match client.get(&health_url).send().await {
                Ok(resp) if resp.status().is_success() => {
                    log::info!("llama-server ready (model: {})", model_name);
                    *self.current_model.write().await = Some(model_name.to_string());
                    // Reset idle timer and spawn auto-shutdown watcher
                    *self.last_used.lock().unwrap() = std::time::Instant::now();
                    let proc_clone = self.server_process.clone();
                    let idle_clone = self.last_used.clone();
                    tokio::spawn(async move {
                        loop {
                            tokio::time::sleep(std::time::Duration::from_secs(60)).await;
                            let elapsed = idle_clone.lock().unwrap().elapsed();
                            if elapsed > std::time::Duration::from_secs(300) {
                                // Take child outside the lock so MutexGuard is dropped before .await
                                let child = proc_clone.lock().ok().and_then(|mut p| p.take());
                                if let Some(mut c) = child {
                                    let _ = c.start_kill();
                                    let _ = c.wait().await;
                                    log::info!("llama-server auto-stopped (idle {}s)", elapsed.as_secs());
                                }
                                break;
                            }
                        }
                    });
                    return Ok(());
                }
                _ => tokio::time::sleep(std::time::Duration::from_millis(500)).await,
            }
        }
    }

    /// Stop llama-server
    pub async fn stop_server(&self) {
        let child = {
            let mut proc = self.server_process.lock().unwrap();
            proc.take()
        };
        if let Some(mut child) = child {
            let _ = child.start_kill().ok();
            let _ = child.wait().await;
            log::info!("llama-server stopped");
        }
        *self.current_model.write().await = None;
    }

    /// Check if server is currently running and healthy
    pub async fn is_server_healthy(&self) -> bool {
        {
            let proc = self.server_process.lock().unwrap();
            if proc.is_none() {
                return false;
            }
        } // MutexGuard dropped before await

        // Quick health check
        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(2))
            .build()
            .ok();
        match client {
            Some(c) => {
                let url = format!("{}/health", self.server_url);
                c.get(&url).send().await.ok().map_or(false, |r| r.status().is_success())
            }
            None => false,
        }
    }

    /// Check if NVIDIA driver is installed (nvidia-smi present and runnable).
    pub fn has_nvidia_driver() -> bool {
        // Must have NVIDIA driver
        #[allow(unused_mut)]
        let mut nvcmd = std::process::Command::new("nvidia-smi");
        #[cfg(target_os = "windows")]
        nvcmd.creation_flags(0x08000000);
        let has_driver = nvcmd
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false);

        if has_driver {
            return true;
        }
        let alt = [
            "C:\\Windows\\System32\\nvidia-smi.exe",
            "C:\\Program Files\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe",
        ];
        alt.iter().any(|p| std::path::Path::new(p).exists())
    }

    /// Check for CUDA Runtime DLL (cudart64_*) in System32, the app's bin dir,
    /// and PATH. llama.cpp's CUDA build needs these at load time.
    pub fn has_cuda_runtime(bin_dir: &std::path::Path) -> bool {
        // Check for CUDA Runtime DLL in PATH, System32, and app's own bin dir
        let search_dirs: Vec<std::path::PathBuf> = {
            let mut dirs = vec![
                std::path::PathBuf::from("C:\\Windows\\System32"),
                bin_dir.to_path_buf(),
            ];
            if let Some(path) = std::env::var_os("PATH") {
                for p in std::env::split_paths(&path) {
                    dirs.push(p);
                }
            }
            dirs
        };

        for dir in &search_dirs {
            if let Ok(entries) = std::fs::read_dir(dir) {
                for entry in entries.flatten() {
                    let name = entry.file_name().to_string_lossy().to_lowercase();
                    if name.starts_with("cudart64_") {
                        return true;
                    }
                }
            }
        }
        false
    }

    // ── Model download ──
    // Same polling pattern as whisper/engine.rs

    pub fn get_download_state(&self) -> serde_json::Value {
        serde_json::json!({
            "status": self.download_status.lock().unwrap().clone().unwrap_or_else(|| "idle".to_string()),
            "progress": self.download_progress.load(Ordering::SeqCst),
            "downloadedBytes": self.downloaded_bytes.load(Ordering::SeqCst),
            "totalBytes": self.total_bytes.load(Ordering::SeqCst),
            "speed": self.download_speed.load(Ordering::SeqCst),
        })
    }

    pub fn cancel_download(&self) {
        self.cancel_download.store(true, Ordering::SeqCst);
    }

    pub async fn download_model(&self, name: &str) -> Result<()> {
        if self.cancel_download.load(Ordering::SeqCst) {
            self.cancel_download.store(false, Ordering::SeqCst);
        }
        self.set_status("downloading");
        self.download_progress.store(0, Ordering::SeqCst);
        self.downloaded_bytes.store(0, Ordering::SeqCst);
        self.total_bytes.store(0, Ordering::SeqCst);
        self.download_speed.store(0, Ordering::SeqCst);

        let gguf_file = models::get_gguf_filename(name)
            .ok_or_else(|| anyhow::anyhow!("未知模型: {}", name))?;
        let dest = self.models_dir.join(gguf_file);
        let partial = dest.with_extension("partial");

        // Try URLs in order
        let urls = models::get_all_download_urls(name);
        let client = Client::new();

        for url in urls {
            log::info!("Downloading GGUF model: {}", url);
            match client.get(url).send().await {
                Ok(response) => {
                    // Some CDNs/proxies stream without content-length; fall back
                    // to the known model size so the progress bar stays smooth.
                    let total = response.content_length()
                        .or_else(|| models::get_size_bytes(name))
                        .unwrap_or(0);
                    self.total_bytes.store(total, Ordering::SeqCst);

                    let mut stream = response.bytes_stream();
                    let mut file = tokio::fs::File::create(&partial).await?;
                    use tokio::io::AsyncWriteExt;
                    let mut downloaded: u64 = 0;
                    let mut last_time = std::time::Instant::now();
                    let mut bytes_since_last: u64 = 0;

                    while let Some(chunk) = stream.next().await {
                        if self.cancel_download.load(Ordering::SeqCst) {
                            drop(file);
                            let _ = std::fs::remove_file(&partial);
                            self.set_status("cancelled");
                            return Err(anyhow::anyhow!("下载已取消"));
                        }

                        let chunk = chunk?;
                        file.write_all(&chunk).await?;
                        downloaded += chunk.len() as u64;
                        bytes_since_last += chunk.len() as u64;

                        if total > 0 {
                            let pct = (downloaded * 100 / total) as u8;
                            self.download_progress.store(pct, Ordering::SeqCst);
                        }
                        self.downloaded_bytes.store(downloaded, Ordering::SeqCst);

                        let elapsed = last_time.elapsed().as_secs_f32();
                        if elapsed >= 1.0 {
                            let speed = (bytes_since_last as f32 / elapsed) as u64;
                            self.download_speed.store(speed, Ordering::SeqCst);
                            bytes_since_last = 0;
                            last_time = std::time::Instant::now();
                        }
                    }
                    file.flush().await?;
                    drop(file);

                    // Rename partial -> final
                    std::fs::rename(&partial, &dest)
                        .context("重命名模型文件失败")?;

                    log::info!("GGUF model downloaded: {:?}", dest);
                    self.set_status("complete");
                    self.download_progress.store(100, Ordering::SeqCst);
                    return Ok(());
                }
                Err(e) => {
                    log::warn!("Download from {} failed: {}", url, e);
                    continue;
                }
            }
        }

        self.set_status("error:所有下载源均失败");
        Err(anyhow::anyhow!("所有下载源均失败"))
    }

    pub fn delete_model(&self, name: &str) -> Result<()> {
        if let Some(gguf_file) = models::get_gguf_filename(name) {
            let path = self.models_dir.join(gguf_file);
            if path.exists() {
                std::fs::remove_file(&path)?;
                log::info!("Deleted model: {:?}", path);
            }
        }
        Ok(())
    }

    // ── Inference ──

    /// Generate text by calling llama-server's OpenAI-compatible API
    pub async fn generate(
        &self,
        system_prompt: &str,
        user_prompt: &str,
    ) -> Result<String> {
        *self.last_used.lock().unwrap() = std::time::Instant::now();
        if !self.is_server_healthy().await {
            return Err(anyhow::anyhow!("llama-server 未运行，请先加载模型"));
        }

        let client = Client::builder()
            .timeout(REQUEST_TIMEOUT)
            .build()
            .context("创建 HTTP 客户端失败")?;

        let body = serde_json::json!({
            "model": "local",
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            "stream": false,
            "temperature": 0.5,
            "top_p": 0.8,
            "repeat_penalty": 1.05,
            "repeat_last_n": 256,
            "n_predict": -1,
            "stop": ["<|im_end|>", "<|end_of_turn|>"]
        });

        let resp = client
            .post(format!("{}/v1/chat/completions", self.server_url))
            .json(&body)
            .send()
            .await
            .context("连接 llama-server 失败")?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(anyhow::anyhow!("llama-server 返回错误 {}: {}", status, text));
        }

        let json: serde_json::Value = resp
            .json()
            .await
            .context("解析 llama-server 响应失败")?;

        let choice = &json["choices"][0];
        let msg = &choice["message"];

        // Try content field first, then reasoning_content (for Qwen/R1 models)
        let content = msg["content"].as_str()
            .filter(|s| !s.trim().is_empty())
            .or_else(|| msg["reasoning_content"].as_str())
            .unwrap_or("")
            .trim()
            .to_string();

        // Strip thinking/reasoning content (e.g., <think>...</think> from Qwen3.5)
        let content = Self::strip_thinking_tags(&content);

        if content.is_empty() {
            // Log the full response for debugging
            let response_text = serde_json::to_string(&json).unwrap_or_default();
            log::error!("llama-server 返回空内容，完整响应(前500字): {}", &response_text[..response_text.len().min(500)]);
            return Err(anyhow::anyhow!("llama-server 返回了空内容"));
        }

        Ok(content)
    }

    // ── Helpers ──

    /// Strip <think>...</think> blocks from model output (Qwen3.5 / reasoning models).
    /// If no </think> found, returns the content as-is (thinking may be in progress).
    fn strip_thinking_tags(content: &str) -> String {
        // Try to find a complete think block with closing tag
        if let Some(end) = content.find("</think>") {
            // Return everything after </think>
            let after = content[end + 8..].trim();
            if !after.is_empty() {
                return after.to_string();
            }
        }
        // Also handle ​<​/​t​h​i​n​k​> (with possible zero-width chars)
        // Fallback: try removing opening tag only
        let cleaned = content.replace("<think>", "").replace("</think>", "");
        cleaned.trim().to_string()
    }

    fn set_status(&self, status: &str) {
        *self.download_status.lock().unwrap() = Some(status.to_string());
    }

    /// List models with download status
    pub fn list_models(&self) -> Vec<models::LlmModelInfo> {
        let current = self.current_model.try_read().map(|g| g.clone()).ok().flatten();
        models::list_models(&self.models_dir, current.as_deref())
    }

    /// Get the PID of the running llama-server process, if any.
    pub fn server_pid(&self) -> Option<u32> {
        self.server_process.lock().ok()
            .and_then(|proc| proc.as_ref()?.id())
    }
}

impl Drop for LlmEngine {
    fn drop(&mut self) {
        // Try to stop server on drop
        if let Ok(mut proc) = self.server_process.lock() {
            if let Some(mut child) = proc.take() {
                let _ = child.start_kill();
            }
        }
    }
}

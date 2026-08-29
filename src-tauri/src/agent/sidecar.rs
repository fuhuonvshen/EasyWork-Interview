// EasyWork - Agent sidecar: HTTP proxy to Python agent server + process lifecycle.
//
// The Python server handles all LLM logic (Ollama calls, context building,
// memory management, ReAct loop, skill system, Excel execution).
// Rust only forwards requests through this thin HTTP proxy.

use reqwest::Client;
use serde::de::DeserializeOwned;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

const DEFAULT_PORT: u16 = 9876;
const HEALTH_CHECK_INTERVAL: Duration = Duration::from_millis(500);
const HEALTH_CHECK_TIMEOUT: Duration = Duration::from_secs(30);

/// Manages the Python agent sidecar process and HTTP connection.
pub struct AgentSidecar {
    client: Client,
    /// Dedicated client for SSE streaming: no 180s cap (long local generations)
    /// and no system proxy (localhost only, mirrors Python trust_env=False).
    stream_client: Client,
    base_url: RwLock<String>,
}

impl AgentSidecar {
    pub fn new(port: u16) -> Self {
        Self {
            client: Client::builder()
                .timeout(Duration::from_secs(180))
                .build()
                .expect("Failed to create HTTP client"),
            stream_client: Client::builder()
                .no_proxy()
                .timeout(Duration::from_secs(600))
                .build()
                .expect("Failed to create stream client"),
            base_url: RwLock::new(format!("http://127.0.0.1:{}", port)),
        }
    }

    pub async fn set_port(&self, port: u16) {
        *self.base_url.write().await = format!("http://127.0.0.1:{}", port);
    }

    /// Call an endpoint on the Python agent server.
    pub async fn call<T: DeserializeOwned>(
        &self,
        method: reqwest::Method,
        path: &str,
        body: Option<&serde_json::Value>,
    ) -> Result<T, String> {
        let url = format!("{}{}", self.base_url.read().await, path);
        let mut req = self.client.request(method, &url);
        if let Some(b) = body {
            req = req.json(b);
        }
        let resp = req.send().await.map_err(|e| format!("Agent 服务不可达: {}", e))?;
        let status = resp.status();
        let text = resp
            .text()
            .await
            .map_err(|e| format!("读取响应失败: {}", e))?;
        if !status.is_success() {
            return Err(format!("Agent 服务错误 ({}): {}", status.as_u16(), text));
        }
        serde_json::from_str::<T>(&text).map_err(|e| format!("解析响应失败: {} — body: {}", e, &text[..text.len().min(200)]))
    }

    /// Convenience: POST with JSON body.
    pub async fn post<T: DeserializeOwned>(
        &self,
        path: &str,
        body: &serde_json::Value,
    ) -> Result<T, String> {
        self.call(reqwest::Method::POST, path, Some(body)).await
    }

    /// Convenience: GET without body.
    pub async fn get<T: DeserializeOwned>(&self, path: &str) -> Result<T, String> {
        self.call(reqwest::Method::GET, path, None).await
    }

    /// Open a streaming POST and return the raw response (caller drains bytes).
    /// Uses the dedicated stream client without the 180s global timeout.
    pub async fn stream_post(
        &self,
        path: &str,
        body: &serde_json::Value,
    ) -> Result<reqwest::Response, String> {
        let url = format!("{}{}", self.base_url.read().await, path);
        let resp = self
            .stream_client
            .post(&url)
            .json(body)
            .send()
            .await
            .map_err(|e| format!("Agent 服务不可达: {}", e))?;
        if !resp.status().is_success() {
            let status = resp.status().as_u16();
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("Agent 服务错误 ({}): {}", status, text));
        }
        Ok(resp)
    }
}

/// Find an available TCP port starting from `start_port`.
/// Returns `None` if no port is available within `max_attempts`.
pub fn find_available_port(start_port: u16, max_attempts: u16) -> Option<u16> {
    for port in start_port..start_port.saturating_add(max_attempts) {
        if std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, port)).is_ok() {
            return Some(port);
        }
    }
    None
}

/// Spawn the Python agent server.
/// Uses local llama-server by default; can use any OpenAI-compatible online API if configured.
/// If `bundled_agent` is provided and exists, runs it directly instead of system Python.
pub async fn spawn_python_server(
    project_dir: &std::path::Path,
    manifest_dir: &std::path::Path,
    db_path: &std::path::Path,
    port: u16,
    settings: &std::collections::HashMap<String, String>,
    bundled_agent: Option<&std::path::Path>,
) -> Result<tokio::process::Child, String> {
    let llm_backend = settings.get("agent_llm_backend")
        .filter(|s| !s.is_empty())
        .map(|s| s.as_str())
        .unwrap_or("local");

    // ── Try bundled agent binary first ──
    if let Some(agent_path) = bundled_agent {
        if agent_path.exists() {
            log::info!("Using bundled agent: {:?}", agent_path);
            // Derive data dir from db_path (db_path = app_data_dir / "easywork.db")
            let app_data_dir = db_path.parent().unwrap_or(db_path);
            let mut cmd = tokio::process::Command::new(agent_path);
            cmd.env("AGENT_PORT", port.to_string())
                .env("AGENT_DB_PATH", db_path.to_string_lossy().to_string())
                // AGENT_DATA_DIR tells the bundled agent where to write
                // memories, agent_input, agent_output, tokens etc.
                .env("AGENT_DATA_DIR", app_data_dir.to_string_lossy().to_string())
                // Don't set AGENT_PROJECT_DIR — it's a compile-time CI path
                // that doesn't exist on the user's machine.
                .stdout(Stdio::piped())
                .stderr(Stdio::piped());
            set_llm_env(&mut cmd, llm_backend, settings);
            #[cfg(target_os = "windows")]
            cmd.as_std_mut().creation_flags(0x08000000);
            return cmd.spawn()
                .map_err(|e| format!("无法启动内置 agent: {}", e));
        }
        log::warn!("内置 agent 不存在 ({:?})，回退到系统 Python", agent_path);
    }

    // ── Fall back to system Python ──
    let python_cmd = find_python();
    let server_dir = manifest_dir.join("py_backend");

    if !server_dir.join("main.py").exists() {
        return Err(format!(
            "Python backend server not found at {}",
            server_dir.display()
        ));
    }

    let mut cmd = tokio::process::Command::new(&python_cmd);
    cmd.arg("-u")
        .arg("-m")
        .arg("py_backend.main")
        .current_dir(manifest_dir)
        .env("AGENT_PORT", port.to_string())
        .env("AGENT_DB_PATH", db_path.to_string_lossy().to_string())
        .env("AGENT_PROJECT_DIR", project_dir.to_string_lossy().to_string())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    set_llm_env(&mut cmd, llm_backend, settings);

    #[cfg(target_os = "windows")]
    cmd.as_std_mut().creation_flags(0x08000000);

    let child = cmd.spawn()
        .map_err(|e| format!("无法启动 Python agent 服务器 ({}): {}", python_cmd, e))?;

    Ok(child)
}

fn set_llm_env(
    cmd: &mut tokio::process::Command,
    llm_backend: &str,
    settings: &std::collections::HashMap<String, String>,
) {
    match llm_backend {
        "online" => {
            cmd.env("LLM_BACKEND", "online")
                .env("ONLINE_BASE_URL", settings.get("agent_online_url")
                    .filter(|s| !s.is_empty())
                    .map(|s| s.as_str())
                    .unwrap_or("https://api.openai.com"))
                .env("ONLINE_MODEL", settings.get("agent_online_model")
                    .filter(|s| !s.is_empty())
                    .map(|s| s.as_str())
                    .unwrap_or("gpt-4o"))
                .env("ONLINE_API_KEY", settings.get("agent_online_key")
                    .filter(|s| !s.is_empty())
                    .map(|s| s.as_str())
                    .unwrap_or(""));
        }
        _ => {
            cmd.env("LLM_BACKEND", "llamacpp")
                .env("LLAMACPP_URL", "http://127.0.0.1:11435")
                .env("LLAMACPP_MODEL", "local");
        }
    }
}

/// Poll /health until the Python server responds or timeout expires.
pub async fn wait_for_healthy(sidecar: &AgentSidecar, timeout: Duration) -> Result<(), String> {
    let start = std::time::Instant::now();
    loop {
        if start.elapsed() > timeout {
            return Err("Agent 服务启动超时".to_string());
        }
        match sidecar
            .get::<serde_json::Value>("/health")
            .await
        {
            Ok(_) => return Ok(()),
            Err(_) => tokio::time::sleep(HEALTH_CHECK_INTERVAL).await,
        }
    }
}

/// Find a working Python command on the system.
/// On Windows, also tries common installation paths to handle GUI-mode PATH issues.
fn find_python() -> String {
    // First try common command names
    for cmd in &["python", "python3", "py"] {
        let mut pycmd = std::process::Command::new(cmd);
        #[cfg(target_os = "windows")]
        pycmd.creation_flags(0x08000000);
        if pycmd
            .arg("--version")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok()
        {
            return cmd.to_string();
        }
    }

    // On Windows, try common installation paths
    if cfg!(target_os = "windows") {
        let username = std::env::var("USERNAME").unwrap_or_default();
        let userprofile = std::env::var("USERPROFILE").unwrap_or_default();
        let home = std::env::var("HOME").unwrap_or_default();
        let candidates = [
            format!(r"C:\Users\{}\AppData\Local\Programs\Python\Python312\python.exe", username),
            format!(r"C:\Users\{}\AppData\Local\Programs\Python\Python313\python.exe", username),
            format!(r"C:\Users\{}\AppData\Local\Programs\Python\Python311\python.exe", username),
            format!(r"{}\AppData\Local\Programs\Python\Python312\python.exe", userprofile),
            format!(r"{}\AppData\Local\Programs\Python\Python313\python.exe", userprofile),
            format!(r"{}\AppData\Local\Programs\Python\Python311\python.exe", userprofile),
            r"C:\Python312\python.exe".to_string(),
            r"C:\Python313\python.exe".to_string(),
            r"C:\Python311\python.exe".to_string(),
        ];
        for path in &candidates {
            if std::path::Path::new(path).exists() {
                return path.to_string();
            }
        }
    }

    "python".to_string()
}

/// Guard that kills the Python child process on drop.
pub struct ProcessGuard {
    child: Arc<tokio::sync::Mutex<Option<tokio::process::Child>>>,
}

impl ProcessGuard {
    pub fn new(child: tokio::process::Child) -> Self {
        Self {
            child: Arc::new(tokio::sync::Mutex::new(Some(child))),
        }
    }

    pub fn arc_clone(&self) -> Arc<tokio::sync::Mutex<Option<tokio::process::Child>>> {
        self.child.clone()
    }
}

impl Drop for ProcessGuard {
    fn drop(&mut self) {
        // We can't do async in Drop, so spawn a blocking kill.
        // In practice Tauri's process exit will clean up child processes.
        if let Ok(mut guard) = self.child.try_lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.start_kill();
            }
        }
    }
}

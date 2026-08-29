// EasyWork - LLM 模型定义（GGUF 格式，用于本地推理）

use serde::Serialize;

/// 单个 GGUF 模型定义（编译期静态）
pub struct ModelDef {
    name: &'static str,
    display_name: &'static str,
    gguf_file: &'static str,
    download_url_mirror: &'static str,
    download_url_primary: &'static str,
    size_bytes: u64,
    is_recommended: bool,
}

static MODELS: &[ModelDef] = &[
    ModelDef {
        name: "qwen3.5:2b",
        display_name: "Qwen 3.5 2B（均衡）",
        gguf_file: "Qwen3.5-2B-Q4_K_M.gguf",
        download_url_mirror: "https://hf-mirror.com/unsloth/Qwen3.5-2B-GGUF/resolve/main/Qwen3.5-2B-Q4_K_M.gguf",
        download_url_primary: "https://huggingface.co/unsloth/Qwen3.5-2B-GGUF/resolve/main/Qwen3.5-2B-Q4_K_M.gguf",
        size_bytes: 1_221_000_000,
        is_recommended: false,
    },
    ModelDef {
        name: "qwen3.5:4b",
        display_name: "Qwen 3.5 4B（高质量）",
        gguf_file: "Qwen3.5-4B-Q4_K_M.gguf",
        download_url_mirror: "https://hf-mirror.com/unsloth/Qwen3.5-4B-GGUF/resolve/main/Qwen3.5-4B-Q4_K_M.gguf",
        download_url_primary: "https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/resolve/main/Qwen3.5-4B-Q4_K_M.gguf",
        size_bytes: 2_614_000_000,
        is_recommended: true,
    },
];

/// 暴露给前端的模型信息
#[derive(Debug, Clone, Serialize)]
pub struct LlmModelInfo {
    pub name: String,
    pub display_name: String,
    pub size_display: String,
    pub downloaded: bool,
    pub is_recommended: bool,
    pub is_loaded: bool,
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

/// 列出所有可用模型及其状态
pub fn list_models(models_dir: &std::path::Path, current_model: Option<&str>) -> Vec<LlmModelInfo> {
    MODELS
        .iter()
        .map(|m| {
            let path = models_dir.join(m.gguf_file);
            LlmModelInfo {
                name: m.name.to_string(),
                display_name: m.display_name.to_string(),
                size_display: format_bytes(m.size_bytes),
                downloaded: path.exists(),
                is_recommended: m.is_recommended,
                is_loaded: current_model == Some(m.name),
            }
        })
        .collect()
}

/// 按名称查找模型定义
pub fn get_model_by_name(name: &str) -> Option<&'static ModelDef> {
    MODELS.iter().find(|m| m.name == name)
}

/// 获取模型 GGUF 文件名
pub fn get_gguf_filename(name: &str) -> Option<&'static str> {
    MODELS.iter().find(|m| m.name == name).map(|m| m.gguf_file)
}

/// 获取模型文件大小（下载源不返回 content-length 时用于进度估算）
pub fn get_size_bytes(name: &str) -> Option<u64> {
    MODELS.iter().find(|m| m.name == name).map(|m| m.size_bytes)
}

/// 获取下载 URL（优先镜像）
pub fn get_download_url(name: &str) -> Option<&'static str> {
    // Use the first URL that's not empty in practice
    // The engine will try both
    MODELS
        .iter()
        .find(|m| m.name == name)
        .map(|m| m.download_url_mirror)
}

/// 获取所有下载 URL（主站 + 镜像）
pub fn get_all_download_urls(name: &str) -> Vec<&'static str> {
    MODELS
        .iter()
        .find(|m| m.name == name)
        .map(|m| vec![m.download_url_primary, m.download_url_mirror])
        .unwrap_or_default()
}

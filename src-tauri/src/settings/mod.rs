pub mod commands;

use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// 从设置中解析路径：优先 data_root_dir，其次单独设置，最后默认
pub fn resolve_path(
    app_dir: &Path,
    settings: &HashMap<String, String>,
    legacy_key: &str,
    subdir: &str,
) -> PathBuf {
    if let Some(root) = settings.get("data_root_dir").filter(|s| !s.is_empty()) {
        PathBuf::from(root).join(subdir)
    } else if let Some(custom) = settings.get(legacy_key).filter(|s| !s.is_empty()) {
        PathBuf::from(custom)
    } else {
        app_dir.join(subdir)
    }
}

// EasyWork - 投递记录命令（前端投递工作台调用，与 OfferSubmit 扩展共享 apply_records 表）

use std::path::{Path, PathBuf};
use tauri::{Manager, State};
use crate::state::{DbState, LlmState};

/// 把内置的 OfferSubmit 扩展（dist）解压到应用数据目录（与 easywork.db 同目录，
/// 避开 OneDrive 重定向的文档目录），返回路径。
/// 幂等：目标已存在则跳过复制（已加载的扩展路径引用不变）。
#[tauri::command]
pub async fn prepare_extension(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let src = extension_source_dir(&app)?;
    let dest = extension_dest_dir(&app)?;

    let already = dest.join("manifest.json").exists();
    if !already {
        copy_dir_recursive(&src, &dest)?;
    }

    Ok(serde_json::json!({
        "path": dest.to_string_lossy(),
        "copied": !already,
        "browser": detect_browser(),
    }))
}

fn extension_source_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    // 开发模式：项目 binaries 目录；发布模式：安装包资源目录
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries").join("offersubmit-dist");
    if dev.join("manifest.json").exists() {
        return Ok(dev);
    }
    let res = app
        .path()
        .resource_dir()
        .map_err(|e| format!("无法定位应用资源目录: {}", e))?
        .join("binaries")
        .join("offersubmit-dist");
    if res.join("manifest.json").exists() {
        return Ok(res);
    }
    Err("扩展资源缺失（offersubmit-dist/manifest.json 不存在）".to_string())
}

fn extension_dest_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法定位应用数据目录: {}", e))?;
    Ok(data_dir.join("OfferSubmit-Extension"))
}

fn copy_dir_recursive(src: &Path, dest: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dest).map_err(|e| format!("创建目录失败: {}", e))?;
    let entries = std::fs::read_dir(src).map_err(|e| format!("读取扩展资源失败: {}", e))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("读取扩展资源失败: {}", e))?;
        let from = entry.path();
        let to = dest.join(entry.file_name());
        if from.is_dir() {
            copy_dir_recursive(&from, &to)?;
        } else {
            std::fs::copy(&from, &to).map_err(|e| format!("复制扩展文件失败: {}", e))?;
        }
    }
    Ok(())
}

// ── 公司库 ──

/// 公司列表（内置 + 自定义）
#[tauri::command]
pub async fn company_list(
    db: State<'_, DbState>,
) -> Result<Vec<crate::database::models::Company>, String> {
    crate::database::repo::company_list(&db.0)
        .await
        .map_err(|e| format!("查询公司列表失败: {}", e))
}

/// 新增公司（返回新记录）
#[tauri::command]
pub async fn company_add(
    db: State<'_, DbState>,
    name: String,
    industry: Option<String>,
    url: Option<String>,
) -> Result<crate::database::models::Company, String> {
    let id = crate::database::repo::company_insert(
        &db.0,
        &name,
        &industry.unwrap_or_default(),
        &url.unwrap_or_default(),
    )
    .await
    .map_err(|e| format!("新增公司失败: {}", e))?;
    let list = crate::database::repo::company_list(&db.0)
        .await
        .map_err(|e| format!("查询公司列表失败: {}", e))?;
    list.into_iter()
        .find(|c| c.id == id)
        .ok_or_else(|| "新增公司后查询失败".to_string())
}

/// 更新公司（None 字段保持不变）
#[tauri::command]
pub async fn company_update(
    db: State<'_, DbState>,
    id: String,
    name: Option<String>,
    industry: Option<String>,
    url: Option<String>,
) -> Result<(), String> {
    crate::database::repo::company_update(
        &db.0,
        &id,
        name.as_deref(),
        industry.as_deref(),
        url.as_deref(),
    )
    .await
    .map_err(|e| format!("更新公司失败: {}", e))
}

/// 删除公司
#[tauri::command]
pub async fn company_delete(
    db: State<'_, DbState>,
    id: String,
) -> Result<(), String> {
    crate::database::repo::company_delete(&db.0, &id)
        .await
        .map_err(|e| format!("删除公司失败: {}", e))
}

fn detect_browser() -> String {
    browser_paths().first().map(|(name, _)| name.to_string()).unwrap_or_else(|| "unknown".to_string())
}

/// 常见浏览器安装路径（顺序即探测优先级）
fn browser_paths() -> Vec<(&'static str, &'static str)> {
    vec![
        ("chrome", r"C:\Program Files\Google\Chrome\Application\chrome.exe"),
        ("chrome", r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"),
        ("edge", r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"),
        ("edge", r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"),
    ]
}

fn browser_exe(which: &str) -> Option<(&'static str, &'static str)> {
    browser_paths().into_iter().find(|(name, p)| {
        *name == which && Path::new(p).exists()
    })
}

/// 打开浏览器扩展管理页（chrome://extensions / edge://extensions）。
/// 先校验浏览器已安装，再用 cmd start（ShellExecute）按系统协议路由打开：
/// 直接调浏览器 exe 传 URL 时，已运行的浏览器实例可能忽略参数（表现为
/// 新开窗口但不导航到扩展页）；协议路由由浏览器注册的 chrome:// / edge://
/// handler 处理，可确保落在扩展管理页。
#[tauri::command]
pub async fn open_extensions_page(browser: String) -> Result<(), String> {
    let _ = browser_exe(&browser)
        .ok_or_else(|| format!("未找到 {} 浏览器，请手动打开浏览器扩展页面", if browser == "edge" { "Edge" } else { "Chrome" }))?;
    let url = if browser == "edge" { "edge://extensions/" } else { "chrome://extensions/" };
    std::process::Command::new("cmd")
        .args(["/c", "start", "", url])
        .spawn()
        .map_err(|e| format!("打开浏览器失败: {}", e))?;
    Ok(())
}

/// 全部投递记录（按最近更新倒序）
#[tauri::command]
pub async fn apply_list_records(
    db: State<'_, DbState>,
) -> Result<Vec<crate::database::models::ApplyRecord>, String> {
    crate::database::repo::apply_list_records(&db.0)
        .await
        .map_err(|e| format!("查询投递记录失败: {}", e))
}

/// 新增一条投递记录（服务端生成 id 与时间戳）
#[tauri::command]
pub async fn apply_add_record(
    db: State<'_, DbState>,
    company: String,
    position: Option<String>,
    url: Option<String>,
    site: Option<String>,
    status: Option<String>,
    notes: Option<String>,
) -> Result<crate::database::models::ApplyRecord, String> {
    let now = chrono::Local::now().timestamp_millis();
    let rec = crate::database::models::ApplyRecord {
        id: uuid::Uuid::new_v4().to_string(),
        company,
        position: position.unwrap_or_default(),
        url: url.unwrap_or_default(),
        site: site.unwrap_or_default(),
        status: status.unwrap_or_else(|| "pending".into()),
        notes: notes.unwrap_or_default(),
        applied_at: now,
        updated_at: now,
    };
    crate::database::repo::apply_insert_record(&db.0, &rec)
        .await
        .map_err(|e| format!("新增投递记录失败: {}", e))?;
    Ok(rec)
}

/// 更新一条投递记录（None 字段保持不变，刷新 updated_at）
#[tauri::command]
pub async fn apply_update_record(
    db: State<'_, DbState>,
    id: String,
    company: Option<String>,
    position: Option<String>,
    url: Option<String>,
    site: Option<String>,
    status: Option<String>,
    notes: Option<String>,
) -> Result<(), String> {
    crate::database::repo::apply_update_record(
        &db.0,
        &id,
        company.as_deref(),
        position.as_deref(),
        url.as_deref(),
        site.as_deref(),
        status.as_deref(),
        notes.as_deref(),
    )
    .await
    .map_err(|e| format!("更新投递记录失败: {}", e))
}

/// 删除一条投递记录（写入删除墓碑，防对端同步复活）
#[tauri::command]
pub async fn apply_delete_record(
    db: State<'_, DbState>,
    id: String,
) -> Result<(), String> {
    crate::database::repo::apply_delete_record(&db.0, &id)
        .await
        .map_err(|e| format!("删除投递记录失败: {}", e))
}

/// 校验新增公司的数据准确性。
/// 一次性后台调用：上下文仅含本条数据（JSON），不落库、不留对话历史。
/// LLM 不可用或返回异常时前端降级为直接添加。
#[tauri::command]
pub async fn validate_company(
    name: String,
    industry: Option<String>,
    url: Option<String>,
    llm_state: State<'_, LlmState>,
) -> Result<serde_json::Value, String> {
    let industry = industry.unwrap_or_default();
    let url = url.unwrap_or_default();

    let system = "你是招聘信息审核助手，只输出 JSON。";
    let user = format!(
        r#"你是招聘信息审核助手。用户正在向共享公司库添加一家公司，请根据你自己的知识判断这条数据是否准确可信。只判断这一条数据，不要参考任何其他信息。

## 待审核数据（JSON）
{{"company": "{name}", "industry": "{industry}", "url": "{url}"}}

## 审核要点
1. 公司名称：是否像真实存在的企业名称（非空、无乱码、无意义字符、不是明显编造的虚假名称）
2. 业务类型：是否与该公司的主营业务相符（明显不符则判为不准确，例如"苹果"对应"机械制造"；此项为空时视为通过）
3. 招聘网址：是否像该公司的真实招聘入口（公司官网招聘页、官方校招平台、知名招聘平台上该公司的官方主页等）；若明显指向无关的其他公司或无关网站则判为不准确
4. 仅凭本条数据无法判断的（如你不认识的公司、不确定的网址）一律不判为错误，不要编造理由

## 输出要求
只输出 JSON，不要任何其他文字：
{{"valid": true 或 false, "reason": "一句话说明不准确之处；valid 为 true 时 reason 为空字符串"}}"#,
    );

    let eng = llm_state.0.read().await;
    let raw = eng
        .generate(system, &user)
        .await
        .map_err(|e| format!("校验调用失败: {}", e))?;

    let mut text = raw.trim().to_string();
    if let Some(start) = text.find("```") {
        let end = text.rfind("```").unwrap_or(start);
        text = text[start + 3..end].trim().to_string();
        if text.starts_with("json") {
            text = text[4..].trim().to_string();
        }
    }
    let start = text.find('{').ok_or_else(|| "AI 校验返回格式异常".to_string())?;
    let end = text.rfind('}').ok_or_else(|| "AI 校验返回格式异常".to_string())?;
    if end <= start {
        return Err("AI 校验返回格式异常".into());
    }
    let v: serde_json::Value = serde_json::from_str(&text[start..=end])
        .map_err(|_| "AI 校验返回格式异常".to_string())?;
    let valid = v["valid"].as_bool().unwrap_or(true);
    let reason = v["reason"].as_str().unwrap_or("").to_string();
    Ok(serde_json::json!({ "valid": valid, "reason": reason }))
}

/// 新增公司：先推送云端共享库（成功后落库，以云端为准），再写入本地。
#[tauri::command]
pub async fn company_add_shared(
    db: State<'_, DbState>,
    name: String,
    industry: Option<String>,
    url: Option<String>,
) -> Result<crate::database::models::Company, String> {
    let industry = industry.unwrap_or_default();
    let url = url.unwrap_or_default();
    let _rid = crate::feishu::create_record(&name, &industry, &url).await?;
    let id = crate::database::repo::company_insert(&db.0, &name, &industry, &url)
        .await
        .map_err(|e| format!("写入本地公司库失败: {}", e))?;
    let list = crate::database::repo::company_list(&db.0)
        .await
        .map_err(|e| format!("查询公司列表失败: {}", e))?;
    list.into_iter()
        .find(|c| c.id == id)
        .ok_or_else(|| "新增公司后查询失败".to_string())
}

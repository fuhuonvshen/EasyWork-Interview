// EasyWork - 飞书多维表格公司库（只读镜像，以在线表格为准）。
// 凭证内置，用户零配置；同步 = 全量拉取 → 整体替换本地 companies 表。
// 表格字段：公司(文本) / 行业(文本) / 网址(文本)，其余列忽略。

use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;
use crate::state::DbState;

const AUTH_URL: &str = "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal";
const BITABLE_BASE: &str = "https://open.feishu.cn/open-apis/bitable/v1";

// ── 内置共享表格凭证（飞书企业自建应用 + 公司库多维表格）──
const APP_ID: &str = "cli_aa1c0538b7b81d18";
const APP_SECRET: &str = "AeOQLU5aoJGIeiMKq7UkHelN7mkPQEpd";
const APP_TOKEN: &str = "EghnbPcxka0GyDsi6PLc6NVgnxh";
const TABLE_ID: &str = "tbl7LJyQDhYFh7yZ";

static TOKEN_CACHE: Mutex<Option<(String, i64)>> = Mutex::new(None);

pub struct FeishuRecord {
    pub name: String,
    pub industry: String,
    pub url: String,
}

fn now_secs() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

/// tenant_access_token（缓存到过期前 5 分钟）
async fn tenant_access_token() -> Result<String, String> {
    {
        let cache = TOKEN_CACHE.lock().unwrap();
        if let Some((tok, exp)) = &*cache {
            if *exp > now_secs() + 300 {
                return Ok(tok.clone());
            }
        }
    }
    let client = reqwest::Client::new();
    let resp = client
        .post(AUTH_URL)
        .json(&serde_json::json!({ "app_id": APP_ID, "app_secret": APP_SECRET }))
        .send()
        .await
        .map_err(|e| format!("连接飞书失败: {}", e))?;
    let data: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("解析飞书响应失败: {}", e))?;
    if data["code"].as_i64() != Some(0) {
        return Err(format!("飞书认证失败: {}", data["msg"].as_str().unwrap_or("未知错误")));
    }
    let tok = data["tenant_access_token"]
        .as_str()
        .ok_or_else(|| "飞书响应缺少 token".to_string())?
        .to_string();
    let expire = data["expire"].as_i64().unwrap_or(7200);
    *TOKEN_CACHE.lock().unwrap() = Some((tok.clone(), now_secs() + expire));
    Ok(tok)
}

/// 多维表格文本字段值：可能是纯字符串或富文本数组 [{"text": "..."}]
fn field_str(v: Option<&serde_json::Value>) -> String {
    let Some(v) = v else { return String::new() };
    if let Some(s) = v.as_str() {
        return s.to_string();
    }
    if let Some(arr) = v.as_array() {
        let joined: Vec<String> = arr
            .iter()
            .filter_map(|x| x["text"].as_str().map(|s| s.to_string()))
            .collect();
        return joined.concat();
    }
    if let Some(o) = v.as_object() {
        if let Some(s) = o.get("text").and_then(|x| x.as_str()) {
            return s.to_string();
        }
    }
    String::new()
}

/// 分页拉取表格全部记录（只取 公司/行业/网址 三列）
async fn list_records(token: &str) -> Result<Vec<FeishuRecord>, String> {
    let client = reqwest::Client::new();
    let mut out = Vec::new();
    let mut page_token: Option<String> = None;
    loop {
        let mut url = format!(
            "{BITABLE_BASE}/apps/{}/tables/{}/records?page_size=500",
            APP_TOKEN, TABLE_ID
        );
        if let Some(pt) = &page_token {
            url.push_str(&format!("&page_token={}", pt));
        }
        let resp = client
            .get(&url)
            .bearer_auth(token)
            .send()
            .await
            .map_err(|e| format!("拉取飞书表格失败: {}", e))?;
        let data: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| format!("解析飞书表格响应失败: {}", e))?;
        if data["code"].as_i64() != Some(0) {
            return Err(format!("飞书表格错误: {}", data["msg"].as_str().unwrap_or("未知错误")));
        }
        let items = data["data"]["items"].as_array().cloned().unwrap_or_default();
        for it in items {
            let fields = it["fields"].as_object().cloned().unwrap_or_default();
            out.push(FeishuRecord {
                name: field_str(fields.get("公司")),
                industry: field_str(fields.get("行业")),
                url: field_str(fields.get("网址")),
            });
        }
        page_token = data["data"]["has_more"].as_bool().unwrap_or(false).then(|| {
            data["data"]["page_token"].as_str().unwrap_or("").to_string()
        });
        if page_token.as_ref().map(|s| s.is_empty()).unwrap_or(true) {
            break;
        }
    }
    Ok(out)
}

/// 推送一家公司到飞书表格，返回 record_id
pub(crate) async fn create_record(
    name: &str,
    industry: &str,
    url: &str,
) -> Result<String, String> {
    let token = tenant_access_token().await?;
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{BITABLE_BASE}/apps/{}/tables/{}/records", APP_TOKEN, TABLE_ID))
        .bearer_auth(&token)
        .json(&serde_json::json!({
            "fields": {
                "公司": name,
                "行业": industry,
                "网址": url,
            }
        }))
        .send()
        .await
        .map_err(|e| format!("推送云端失败: {}", e))?;
    let data: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("解析云端响应失败: {}", e))?;
    if data["code"].as_i64() != Some(0) {
        return Err(format!("云端新建记录失败: {}", data["msg"].as_str().unwrap_or("未知错误")));
    }
    Ok(data["data"]["record"]["record_id"].as_str().unwrap_or("").to_string())
}

/// 同步公司库：全量拉取云端表格 → 整体替换本地 companies 表（以在线表格为准）。
#[tauri::command]
pub async fn feishu_sync_companies(
    db: State<'_, DbState>,
) -> Result<serde_json::Value, String> {
    let token = tenant_access_token().await?;
    let remote = list_records(&token).await?;
    let valid: Vec<FeishuRecord> = remote.into_iter().filter(|r| !r.name.trim().is_empty()).collect();
    crate::database::repo::company_replace_all(&db.0, &valid)
        .await
        .map_err(|e| format!("更新本地公司库失败: {}", e))?;
    log::info!("feishu sync done: {} companies", valid.len());
    Ok(serde_json::json!({ "count": valid.len() }))
}

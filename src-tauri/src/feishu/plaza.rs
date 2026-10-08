// EasyWork - 面经广场：把题库里的一场面试提交到多维表格（人工审核中转）。
// 提交内容不含参考答案；写入时状态为「待审核」，审核通过后广场才可见。

use super::{field_str, tenant_access_token, APP_TOKEN, BITABLE_BASE};

// 「面经分享」表（与公司库同一个多维表格）
const PLAZA_TABLE_ID: &str = "tblUhmk9Ej8yKmOP";

/// 分享的题目：只含题干本身，不带参考答案
#[derive(serde::Serialize, serde::Deserialize)]
pub struct PlazaShareQuestion {
    pub category: String,
    pub difficulty: String,
    pub question: String,
}

/// 把一场面试提交到面经广场（状态=待审核），返回云端记录 id
#[tauri::command]
pub async fn plaza_share_session(
    title: String,
    company: String,
    position: String,
    stage: String,
    questions: Vec<PlazaShareQuestion>,
    shared_at: String,
) -> Result<String, String> {
    let token = tenant_access_token().await?;
    let questions_json =
        serde_json::to_string(&questions).map_err(|e| format!("序列化题目失败: {}", e))?;
    let client = reqwest::Client::new();
    let resp = client
        .post(format!(
            "{BITABLE_BASE}/apps/{}/tables/{}/records",
            APP_TOKEN, PLAZA_TABLE_ID
        ))
        .bearer_auth(&token)
        .json(&serde_json::json!({
            "fields": {
                "标题": title,
                "公司": company,
                "岗位": position,
                "轮次": stage,
                "题目": questions_json,
                "状态": "待审核",
                "收藏数": 0,
                "分享时间": shared_at,
            }
        }))
        .send()
        .await
        .map_err(|e| format!("连接云端失败: {}", e))?;
    let data: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("解析云端响应失败: {}", e))?;
    if data["code"].as_i64() != Some(0) {
        return Err(format!(
            "提交失败: {}",
            data["msg"].as_str().unwrap_or("未知错误")
        ));
    }
    Ok(data["data"]["record"]["record_id"]
        .as_str()
        .unwrap_or("")
        .to_string())
}

// ── 广场浏览与收藏 ──────────────────────────────────────────────

/// 广场里的一份面经（= 云端一行，只含审核通过的）
#[derive(serde::Serialize)]
pub struct PlazaSession {
    pub record_id: String,
    pub title: String,
    pub company: String,
    pub position: String,
    pub stage: String,
    pub questions: Vec<PlazaShareQuestion>,
    pub favorites: i64,
    pub shared_at: String,
}

/// 多维表格的数字字段读回来可能是数字也可能是字符串
fn value_i64(v: Option<&serde_json::Value>) -> i64 {
    match v {
        Some(x) => x
            .as_i64()
            .or_else(|| x.as_str().and_then(|s| s.parse().ok()))
            .unwrap_or(0),
        None => 0,
    }
}

/// 拉取所有「已发布」的面经（待审核/已拒绝不进广场）
async fn list_published() -> Result<Vec<PlazaSession>, String> {
    let token = tenant_access_token().await?;
    let client = reqwest::Client::new();
    let mut out = Vec::new();
    let mut page_token: Option<String> = None;
    loop {
        let mut url = format!(
            "{BITABLE_BASE}/apps/{}/tables/{}/records?page_size=500",
            APP_TOKEN, PLAZA_TABLE_ID
        );
        if let Some(pt) = &page_token {
            url.push_str(&format!("&page_token={}", pt));
        }
        let resp = client
            .get(&url)
            .bearer_auth(&token)
            .send()
            .await
            .map_err(|e| format!("连接云端失败: {}", e))?;
        let data: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| format!("解析云端响应失败: {}", e))?;
        if data["code"].as_i64() != Some(0) {
            return Err(format!(
                "拉取广场失败: {}",
                data["msg"].as_str().unwrap_or("未知错误")
            ));
        }
        for it in data["data"]["items"].as_array().cloned().unwrap_or_default() {
            let fields = it["fields"].as_object().cloned().unwrap_or_default();
            if field_str(fields.get("状态")) != "已发布" {
                continue;
            }
            let questions: Vec<PlazaShareQuestion> =
                serde_json::from_str(&field_str(fields.get("题目"))).unwrap_or_default();
            // 题目解析不出来（人工在表格里改坏了）就跳过，别让一张坏卡砸了整个广场
            if questions.is_empty() {
                continue;
            }
            out.push(PlazaSession {
                record_id: it["record_id"].as_str().unwrap_or("").to_string(),
                title: field_str(fields.get("标题")),
                company: field_str(fields.get("公司")),
                position: field_str(fields.get("岗位")),
                stage: field_str(fields.get("轮次")),
                questions,
                favorites: value_i64(fields.get("收藏数")),
                shared_at: field_str(fields.get("分享时间")),
            });
        }
        page_token = data["data"]["has_more"].as_bool().unwrap_or(false).then(|| {
            data["data"]["page_token"].as_str().unwrap_or("").to_string()
        });
        if page_token.as_ref().map(|s| s.is_empty()).unwrap_or(true) {
            break;
        }
    }
    // 新的在前
    out.sort_by(|a, b| b.shared_at.cmp(&a.shared_at));
    Ok(out)
}

/// 广场列表：所有已发布的面经
#[tauri::command]
pub async fn plaza_list_sessions() -> Result<Vec<PlazaSession>, String> {
    list_published().await
}

/// 收藏 / 取消收藏：云端计数 ±1（先读后写，返回新计数）
#[tauri::command]
pub async fn plaza_set_favorite(record_id: String, favorited: bool) -> Result<i64, String> {
    let token = tenant_access_token().await?;
    let client = reqwest::Client::new();
    let record_url = format!(
        "{BITABLE_BASE}/apps/{}/tables/{}/records/{}",
        APP_TOKEN, PLAZA_TABLE_ID, record_id
    );

    let resp = client
        .get(&record_url)
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("连接云端失败: {}", e))?;
    let data: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("解析云端响应失败: {}", e))?;
    if data["code"].as_i64() != Some(0) {
        return Err(format!(
            "读取收藏数失败: {}",
            data["msg"].as_str().unwrap_or("未知错误")
        ));
    }
    let current = value_i64(data["data"]["record"]["fields"].get("收藏数"));
    let next = if favorited { current + 1 } else { (current - 1).max(0) };

    let resp = client
        .put(&record_url)
        .bearer_auth(&token)
        .json(&serde_json::json!({ "fields": { "收藏数": next } }))
        .send()
        .await
        .map_err(|e| format!("连接云端失败: {}", e))?;
    let data: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("解析云端响应失败: {}", e))?;
    if data["code"].as_i64() != Some(0) {
        return Err(format!(
            "更新收藏数失败: {}",
            data["msg"].as_str().unwrap_or("未知错误")
        ));
    }
    Ok(next)
}

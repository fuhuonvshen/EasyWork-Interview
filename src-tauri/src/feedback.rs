// EasyWork - 意见反馈：通过飞书群机器人 webhook 推送反馈到开发者手机。
// 开启签名校验：timestamp\nsecret 的 HMAC-SHA256（空消息）base64。
// webhook/secret 硬编码随客户端分发是可接受风险（机器人权限受限，
// 只能往固定群发消息，且可随时删除重建）。

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use hmac::{Hmac, Mac};
use sha2::Sha256;

const FEISHU_WEBHOOK: &str = "https://open.feishu.cn/open-apis/bot/v2/hook/a07c8c66-4881-43da-88a8-b382ed0cf5d3";
const FEISHU_SECRET: &str = "FULjRO5IR96tecwApiqDrb";

const MAX_BODY_CHARS: usize = 3000;

fn sign(timestamp: i64) -> String {
    let string_to_sign = format!("{}\n{}", timestamp, FEISHU_SECRET);
    let mut mac = Hmac::<Sha256>::new_from_slice(string_to_sign.as_bytes())
        .expect("HMAC key 长度有效");
    mac.update(b"");
    BASE64.encode(mac.finalize().into_bytes())
}

#[tauri::command]
pub async fn send_feedback(from: String, subject: String, body: String) -> Result<(), String> {
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    let body = if body.chars().count() > MAX_BODY_CHARS {
        let cut: String = body.chars().take(MAX_BODY_CHARS).collect();
        format!("{}…（已截断）", cut)
    } else {
        body
    };

    let text = format!(
        "发件人：{}\n主题：{}\n\n{}",
        from.trim(),
        subject.trim(),
        body
    );

    let payload = serde_json::json!({
        "timestamp": timestamp,
        "sign": sign(timestamp),
        "msg_type": "post",
        "content": {
            "post": {
                "zh_cn": {
                    "title": "【EasyWork 意见反馈】",
                    "content": [[{ "tag": "text", "text": text }]],
                }
            }
        }
    });

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    let resp = client
        .post(FEISHU_WEBHOOK)
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("发送失败: {}", e))?;

    let resp_json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("解析响应失败: {}", e))?;

    if resp_json["code"] == 0 {
        log::info!("反馈已推送飞书 (from: {})", from.trim());
        Ok(())
    } else {
        let msg = resp_json["msg"].as_str().unwrap_or("未知错误");
        Err(format!("飞书返回错误: {}", msg))
    }
}

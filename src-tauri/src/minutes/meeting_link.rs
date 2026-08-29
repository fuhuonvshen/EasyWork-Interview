// EasyWork - 会议链接启动：深链优先，退化到系统默认打开
//
// 分层策略：
//   1. 已带会议客户端深链协议 (zoommtg:// / wemeet:// / msteams:// …) → 原样打开
//   2. Zoom 网页链接 → 转 zoommtg:// 深链（跳过浏览器引导页，直接进客户端）
//   3. 腾讯会议网页链接 → 尽力解析出纯数字会议号转 wemeet:// 深链，失败退化
//   4. 其他（Teams / 飞书 / 钉钉 / Meet / 任意链接）→ 系统默认打开。
//      这类软件的邀请链接本身就是"网页自动拉起客户端"模式，无需特判。

/// 已是深链协议的链接直接放行（防止用户粘贴深链时被误判）
const DEEP_LINK_SCHEMES: &[&str] = &[
    "zoommtg://",
    "wemeet://",
    "msteams://",
    "dingtalk://",
    "feishu://",
    "lark://",
];

#[tauri::command]
pub fn launch_meeting_link(url: String) -> Result<(), String> {
    let target = convert_to_deep_link(&url).unwrap_or(url);
    open::that(&target).map_err(|e| format!("无法打开会议链接: {}", e))
}

fn convert_to_deep_link(url: &str) -> Option<String> {
    if DEEP_LINK_SCHEMES.iter().any(|s| url.starts_with(s)) {
        return Some(url.to_string());
    }
    convert_zoom(url)
        .or_else(|| convert_tencent_meeting(url))
        .or_else(|| convert_meeting_code(url))
}

/// Zoom 网页链接 → zoommtg:// 深链；非 join 链接（无 `/j/`）返回 None 走通用打开。
fn convert_zoom(url: &str) -> Option<String> {
    if !url.contains("zoom.us") {
        return None;
    }
    let confno = url.split("/j/").nth(1)?.split('?').next().unwrap_or("");
    if confno.is_empty() {
        return None;
    }
    let pwd = url
        .split("pwd=")
        .nth(1)
        .and_then(|s| s.split('&').next())
        .filter(|p| !p.is_empty());
    match pwd {
        Some(p) => Some(format!(
            "zoommtg://zoom.us/join?action=join&confno={}&pwd={}",
            confno, p
        )),
        None => Some(format!("zoommtg://zoom.us/join?action=join&confno={}", confno)),
    }
}

/// 腾讯会议网页链接 → wemeet:// 深链。
/// 会议号必须解析为纯数字才转换，否则返回 None 走通用打开
/// （腾讯会议 /dm/ /p/ 短码可能是加密串，网页打开也会引导拉起客户端）。
fn convert_tencent_meeting(url: &str) -> Option<String> {
    if !url.contains("meeting.tencent.com") {
        return None;
    }
    let code = param(url, "meeting_code")
        .or_else(|| param(url, "meeting_id"))
        .or_else(|| {
            for prefix in ["/dm/", "/p/"] {
                if let Some(rest) = url.split(prefix).nth(1) {
                    let seg = rest.split(['?', '/']).next().unwrap_or("");
                    if !seg.is_empty() && seg.chars().all(|c| c.is_ascii_digit()) {
                        return Some(seg.to_string());
                    }
                }
            }
            None
        })?;
    if code.is_empty() || !code.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    let pwd = param(url, "pwd").or_else(|| param(url, "password"));
    match pwd {
        Some(p) if !p.is_empty() => Some(format!(
            "wemeet://page/inmeeting?meeting_code={}&password={}",
            code, p
        )),
        _ => Some(format!("wemeet://page/inmeeting?meeting_code={}", code)),
    }
}

/// 纯腾讯会议号（如 "858-685-177"）→ wemeet:// 深链。
/// 腾讯会议号是 9-15 位数字；只接受"数字 + 连字符/空格"组成的串，
/// 避免把普通文本误判成会议号。
fn convert_meeting_code(url: &str) -> Option<String> {
    if url.contains('/') || url.contains(':') {
        return None; // 是 URL，交给其他分支
    }
    if !url.chars().all(|c| c.is_ascii_digit() || c == '-' || c == ' ') {
        return None;
    }
    let digits: String = url.chars().filter(|c| c.is_ascii_digit()).collect();
    if digits.len() < 9 || digits.len() > 15 {
        return None;
    }
    Some(format!("wemeet://page/inmeeting?meeting_code={}", digits))
}

/// 提取 URL query 参数值。
fn param(url: &str, key: &str) -> Option<String> {
    let query = url.split('?').nth(1)?;
    query.split('&').find_map(|kv| {
        let (k, v) = kv.split_once('=')?;
        (k == key && !v.is_empty()).then(|| v.to_string())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zoom_join_with_pwd() {
        let out = convert_to_deep_link("https://zoom.us/j/123456789?pwd=abcDEF")
            .unwrap();
        assert_eq!(
            out,
            "zoommtg://zoom.us/join?action=join&confno=123456789&pwd=abcDEF"
        );
    }

    #[test]
    fn zoom_join_without_pwd() {
        let out = convert_to_deep_link("https://zoom.us/j/123456789").unwrap();
        assert_eq!(
            out,
            "zoommtg://zoom.us/join?action=join&confno=123456789"
        );
    }

    #[test]
    fn zoom_pwd_truncated_at_ampersand() {
        let out = convert_to_deep_link("https://zoom.us/j/123456789?pwd=abc&x=1").unwrap();
        assert_eq!(
            out,
            "zoommtg://zoom.us/join?action=join&confno=123456789&pwd=abc"
        );
    }

    #[test]
    fn zoom_non_join_url_falls_through() {
        assert_eq!(convert_to_deep_link("https://zoom.us/signin"), None);
    }

    #[test]
    fn tencent_dm_digits() {
        let out = convert_to_deep_link("https://meeting.tencent.com/dm/123456789?pwd=xyz")
            .unwrap();
        assert_eq!(
            out,
            "wemeet://page/inmeeting?meeting_code=123456789&password=xyz"
        );
    }

    #[test]
    fn tencent_dm_shortcode_falls_through() {
        // 短码不是纯数字 → 无法解析会议号 → 通用打开
        assert_eq!(
            convert_to_deep_link("https://meeting.tencent.com/dm/AbCdEf123"),
            None
        );
    }

    #[test]
    fn tencent_meeting_code_param() {
        let out = convert_to_deep_link(
            "https://meeting.tencent.com/detail.html?meeting_id=987654321&pwd=ppp",
        )
        .unwrap();
        assert_eq!(
            out,
            "wemeet://page/inmeeting?meeting_code=987654321&password=ppp"
        );
    }

    #[test]
    fn meeting_code_with_dashes() {
        let out = convert_to_deep_link("858-685-177").unwrap();
        assert_eq!(out, "wemeet://page/inmeeting?meeting_code=858685177");
    }

    #[test]
    fn meeting_code_plain_digits() {
        let out = convert_to_deep_link("858685177").unwrap();
        assert_eq!(out, "wemeet://page/inmeeting?meeting_code=858685177");
    }

    #[test]
    fn meeting_code_too_short_falls_through() {
        assert_eq!(convert_to_deep_link("123456"), None);
    }

    #[test]
    fn meeting_code_with_letters_falls_through() {
        assert_eq!(convert_to_deep_link("858685177abc"), None);
    }

    #[test]
    fn deep_link_passthrough() {
        let url = "zoommtg://zoom.us/join?action=join&confno=1";
        assert_eq!(convert_to_deep_link(url), Some(url.to_string()));
    }

    #[test]
    fn teams_and_meet_fall_through() {
        assert_eq!(
            convert_to_deep_link("https://teams.microsoft.com/l/meetup-join/abc"),
            None
        );
        assert_eq!(
            convert_to_deep_link("https://meet.google.com/abc-def-ghi"),
            None
        );
        assert_eq!(
            convert_to_deep_link("https://vc.feishu.cn/j/123456789"),
            None
        );
    }
}

// EasyWork - 简历结构化字段提取（AI，支持本地/在线 LLM）

use tauri::State;
use crate::state::LlmState;

fn extract_prompt(content: &str) -> String {
    format!(
        r#"你是专业的简历信息提取器。从下面的简历文本中提取结构化信息，输出 JSON 对象。

## 输出格式（严格遵循，只输出 JSON，不要任何其他文字）：
```json
{{
  "name": "…",
  "phone": "…",
  "email": "…",
  "gender": "…",
  "age": "…",
  "education": [{{"school": "…", "major": "…", "degree": "…", "start_time": "…", "end_time": "…"}}],
  "work_experience": [{{"company": "…", "position": "…", "start_time": "…", "end_time": "…", "description": "…"}}],
  "projects": [{{"name": "…", "role": "…", "start_time": "…", "end_time": "…", "description": "…"}}],
  "skills": ["…"],
  "job_intention": {{"position": "…", "salary_expectation": "…", "location": "…"}},
  "summary": "…"
}}
```

## 规则
- 简历中没有的信息填空字符串或空数组，不要编造
- 时间统一保留原文格式（如"2020.09-2024.06"或"2020年9月 - 2024年6月"）
- 描述类字段保留关键信息（技术栈、职责、量化成果），精简但完整
- 技能拆成单个技能词条数组

## 简历文本
{content}"#,
        content = content
    )
}

/// 从 LLM 输出中提取 JSON 对象（容忍 markdown 代码块包裹）
fn parse_object_json(raw: &str) -> anyhow::Result<serde_json::Value> {
    let mut text = raw.trim().to_string();
    if let Some(start) = text.find("```") {
        let end = text.rfind("```").unwrap_or(start);
        text = text[start + 3..end].trim().to_string();
        if text.starts_with("json") {
            text = text[4..].trim().to_string();
        }
    }
    let start = text.find('{').ok_or_else(|| anyhow::anyhow!("输出中没有 JSON 对象"))?;
    let end = text.rfind('}').ok_or_else(|| anyhow::anyhow!("JSON 对象不完整"))?;
    if end <= start {
        return Err(anyhow::anyhow!("JSON 对象为空"));
    }
    let slice = &text[start..=end];
    let v: serde_json::Value = serde_json::from_str(slice)?;
    if !v.is_object() {
        return Err(anyhow::anyhow!("输出不是 JSON 对象"));
    }
    Ok(v)
}

/// 用 LLM 从简历文本提取结构化字段（返回规范化 JSON 字符串）。
/// 本地/在线后端均可（读取设置中配置）。
#[tauri::command]
pub async fn extract_resume_fields(
    content: String,
    llm_state: State<'_, LlmState>,
) -> Result<String, String> {
    if content.trim().is_empty() {
        return Err("简历内容为空".into());
    }
    // 截断超长简历（防止超出模型上下文）
    let clipped: String = content.chars().take(20000).collect();

    let system = "你是简历信息提取器，只输出 JSON。";
    let user = extract_prompt(&clipped);

    let eng = llm_state.0.read().await;
    let raw = eng
        .generate(&system, &user)
        .await
        .map_err(|e| format!("字段提取失败: {}", e))?;

    match parse_object_json(&raw) {
        Ok(v) => serde_json::to_string(&v).map_err(|e| format!("序列化失败: {}", e)),
        Err(e) => Err(format!("AI 返回格式异常（{}），可重试或手动填写", e)),
    }
}

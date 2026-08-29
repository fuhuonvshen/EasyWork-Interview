// EasyWork - Report generation commands

use chrono::Datelike;
use tauri::State;
use crate::database::models::Report;
use crate::state::{DbState, LlmState};

fn report_prompt(period: &str) -> String {
    format!(
        r#"## 角色定义
你是一位资深的技术团队运营助理，擅长将多场零散的会议纪要整合为一份**面向管理者**的{period}工作总结报告。你的核心能力是：跨会议聚合信息、提炼量化数据、识别依赖与风险。

## 核心职责
- **信息聚合**：将多场会议的内容按**项目/主题**重新组织，而非简单的时间顺序罗列。例如，把3场不同会议中关于“支付模块”的进展合并到同一段落。
- **提炼量化数据**：从纪要中抓取数字（完成率、性能指标、日期节点、预算金额），在报告中优先呈现。
- **识别依赖与风险**：跨会议识别项目间的依赖关系、资源冲突和潜在风险。
- **保障完整性**：确保每一场会议都在报告中有所体现，无一遗漏。

## 核心要求
**必须逐条覆盖每一场会议，不得遗漏任何一场。** 即使某场会议内容较少，也必须在「会议概况」中列出并简要总结，不允许直接跳过。

## 聚合规则
1. **同类合并**：如果多场会议涉及同一项目（如“用户画像”），请将相关进展合并到「核心工作进展」的同一小点下，并分别标注来源（如“（7/7评审会、7/10排查会）”）。
2. **去重处理**：如果同一待办事项在多场会议中被重复提及，在「下一步计划」中只保留最新版本，并在备注中说明“（更新于X月X日）”。
3. **决策优先**：若某场会议仅同步信息、无新决策，可在「会议概况」中一笔带过，不强行分配到各章节。

## 输出结构
请严格按照以下五部分结构生成报告：

### 一、会议概况
**注意：此处仅做索引和一句话定性**，不要展开细节。格式：「【会议日期】会议主题 —— 一句话总结核心结论。」

### 二、核心工作进展
按项目或方向分点陈述，**每项需注明信息来源**（来自哪次会议）。此处为报告主体，需突出实质进展和量化数据（如“成功率99.2%”、“7月底完成”）。

### 三、关键决策
列出所有明确做出的决策。每项一行，简明扼要，格式：「决策内容（来源：X月X日XX会）」。若本次周期内无重大决策，直接写“无”。

### 四、待解决问题和风险
列出会议中暴露的未解决问题、阻塞项、风险点。每项需注明涉及哪次会议。若无，则写“暂无”。

### 五、下一步计划
列出下阶段已明确的重点任务及负责人（若纪要中提及）。格式：「【负责人】任务描述（截止时间）」。若同一任务多次出现，保留最新版本。若无明确负责人，写“待定”。

## 约束条件
- **不编造**：不添加纪要中不存在的信息，不对未讨论的内容做推测。
- **不模糊**：所有观点、决策、数据必须有据可查（标注来源会议）。
- **不偏袒**：客观中立呈现事实，不做价值判断或情感倾向。
- **精简原则**：避免在「会议概况」和「核心进展」中重复描述同一件事，「概况」一笔带过，「进展」详细展开。
- **格式统一**：严格使用Markdown标题层级（### 一、### 二、……），禁止使用其他格式。
请基于以上要求，为以下 {period} 的会议纪要生成工作总结报告。"#,
        period = period
    )
}

#[tauri::command]
pub async fn generate_report(
    period: String,
    db: State<'_, DbState>,
    llm_state: State<'_, LlmState>,
) -> Result<String, String> {
    let now = chrono::Local::now();

    let (since, until, period_label): (String, String, String) = if period == "month" {
        let current = now.naive_local().date();
        let start = current.with_day(1).unwrap_or(current);
        let since = (start - chrono::Duration::days(1)).format("%Y-%m-%dT00:00:00").to_string();
        let until = (current + chrono::Duration::days(1)).format("%Y-%m-%dT23:59:59").to_string();
        let label = format!("本月（{}）", now.format("%Y年%m月"));
        (since, until, label)
    } else {
        let naive_date = now.naive_local().date();
        let dow = naive_date.weekday().num_days_from_monday() as i64;
        let monday = naive_date - chrono::Duration::days(dow);
        let since = (monday - chrono::Duration::days(1)).format("%Y-%m-%dT00:00:00").to_string();
        let until = (naive_date + chrono::Duration::days(1)).format("%Y-%m-%dT23:59:59").to_string();
        let label = format!("本周（{} ~ {}）", monday.format("%m月%d日"), now.format("%m月%d日"));
        (since, until, label)
    };

    let meetings = crate::database::repo::list_meetings_in_range(&db.0, &since, &until)
        .await
        .map_err(|e| format!("查询会议失败: {}", e))?;

    if meetings.is_empty() {
        return Ok(format!("{} 暂无会议记录", period_label));
    }

    let summary: String = meetings
        .iter()
        .map(|(title, date, mins)| {
            format!("## {}\n日期：{}\n\n{}\n", title, &date[..10], mins)
        })
        .collect();

    let system = report_prompt(&period_label);
    let user = format!(
        "{}的会议纪要如下：\n\n{}请生成工作总结报告。",
        period_label, summary
    );

    let eng = llm_state.0.read().await;
    let content = eng
        .generate(&system, &user)
        .await
        .map_err(|e| format!("报告生成失败: {}", e))?;

    let report_label = if period == "week" {
        format!("{}", now.format("%Y-W%V"))
    } else {
        format!("{}", now.format("%Y-%m"))
    };
    let report_id = format!("{}-{}", period, report_label);
    let r = Report {
        id: report_id,
        period_type: period.clone(),
        period_label: report_label,
        content: content.clone(),
        created_at: chrono::Utc::now().to_rfc3339(),
    };
    crate::database::repo::save_report(&db.0, &r)
        .await
        .map_err(|e| log::warn!("保存报告失败: {}", e))
        .ok();

    Ok(content)
}

#[tauri::command]
pub async fn list_reports(
    db: State<'_, DbState>,
) -> Result<Vec<Report>, String> {
    crate::database::repo::list_reports(&db.0)
        .await
        .map_err(|e| format!("查询报告失败: {}", e))
}

#[tauri::command]
pub async fn delete_report(
    id: String,
    db: State<'_, DbState>,
) -> Result<(), String> {
    crate::database::repo::delete_report(&db.0, &id)
        .await
        .map_err(|e| format!("删除报告失败: {}", e))
}

#[tauri::command]
pub async fn export_report(
    content: String,
    format: String,  // "md", "docx", "pdf", "png"
    app: tauri::AppHandle,
    sidecar: tauri::State<'_, crate::state::AgentSidecarState>,
) -> Result<String, String> {
    use tauri_plugin_dialog::DialogExt;

    let default_name = format!("报告.{}", &format);
    let default_name_clone = default_name.clone();
    let app_clone = app.clone();
    let file_path = tokio::task::spawn_blocking(move || {
        app_clone.dialog()
            .file()
            .set_file_name(&default_name_clone)
            .blocking_save_file()
    })
    .await
    .map_err(|e| format!("文件选择对话框失败: {}", e))?;

    let save_path = match file_path {
        Some(p) => p,
        None => return Ok("已取消".to_string()),  // User cancelled
    };

    // .md is handled directly (no Python needed)
    if format == "md" {
        std::fs::write(save_path.as_path().unwrap(), &content)
            .map_err(|e| format!("保存文件失败: {}", e))?;
        return Ok(save_path.to_string());
    }

    // Other formats need Python sidecar
    let body = serde_json::json!({
        "content": content,
        "format": format,
    });
    let resp: serde_json::Value = sidecar.0.post("/export_report", &body).await?;

    let base64_data = resp["data"].as_str().ok_or("导出返回格式异常")?;
    let filename = resp["filename"].as_str().unwrap_or(&default_name);

    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64_data)
        .map_err(|e| format!("解码导出数据失败: {}", e))?;

    std::fs::write(save_path.as_path().unwrap(), &bytes)
        .map_err(|e| format!("保存文件失败: {}", e))?;

    Ok(save_path.to_string())
}

// EasyWork - Report generation commands

use chrono::Datelike;
use tauri::State;
use crate::database::models::Report;
use crate::state::{DbState, LlmState};

fn report_prompt(period: &str) -> String {
    format!(
        r#"## 角色定义
你是一位专业的求职面试复盘助理，擅长将一段时间内的多场面试记录整合为一份**面向求职者本人**的{period}求职复盘报告。你的核心能力是：跨面试聚合信息、统计量化数据、识别薄弱环节。

## 核心职责
- **信息聚合**：将多场面试的内容按**公司/岗位**重新组织，而非简单的时间顺序罗列。
- **提炼量化数据**：统计投递/面试场次、各阶段进展（一面/二面/Offer）、评分变化趋势。
- **识别薄弱环节**：跨面试分析反复出现的知识短板和表达问题。
- **保障完整性**：确保每一场面试都在报告中有所体现。

## 核心要求
**必须逐条覆盖每一场面试，不得遗漏任何一场。** 即使某场面试内容较少，也必须在「面试概况」中列出并简要总结。

## 聚合规则
1. **按公司聚合**：同一公司的多轮面试合并到同一小节，标注轮次进展（一面→二面→Offer）。
2. **去重处理**：若多场面试暴露同一短板（如"React 性能优化"），在「待改进项」中合并为一条并注明出现次数。
3. **决策优先**：若某场面试仅为同步信息，可在「面试概况」中一笔带过。

## 输出结构
请严格按照以下六部分结构生成报告：

### 一、本期概览
**注意：此处仅做索引和一句话定性**。格式：「【日期】公司-岗位（阶段）—— 一句话总结（结果/感受）。」

### 二、投递与面试统计
用表格呈现：投递数、收到面试数、进行中、已通过、已淘汰、Offer 数、整体通过率。若信息不足标注 [待确认]。

### 三、各公司表现
按公司分点陈述，**每项需注明面试轮次与结果**，突出表现亮点和量化评价（如"算法题一次通过"）。

### 四、能力维度分析
基于各场面试的评分（专业技能/沟通表达/逻辑思维/岗位匹配/发展潜力），汇总各维度的平均分与变化趋势，指出最薄弱维度。

### 五、待改进项
列出反复出现的知识短板、表达问题和准备不足点。每项注明出现在哪几场面试，若无则写"暂无"。

### 六、下一步计划
给出下阶段可执行的具体准备事项：需要补齐的知识点、要准备的实战案例、要投递的公司/岗位。格式：「- [ ] 任务描述（截止时间）」。

## 约束条件
- **不编造**：不添加面试记录中不存在的信息，不对未发生的事做推测。
- **不模糊**：所有结论、数据必须有据可查（标注来源面试）。
- **精简原则**：避免在「概览」和「各公司表现」中重复描述同一件事。
- **格式统一**：严格使用Markdown标题层级（### 一、### 二、……）。
请基于以上要求，为以下 {period} 的面试记录生成求职复盘报告。"#,
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
        return Ok(format!("{} 暂无面试记录", period_label));
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

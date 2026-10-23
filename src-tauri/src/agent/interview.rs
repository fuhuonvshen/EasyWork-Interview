// EasyWork - 实时辅助答题：把在线模型的 SSE 流转发为 Tauri 事件。
// 与 agent_chat_stream 不同，这个通道不经过场景/工具/数据库，且支持被新问题取消。

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::{Emitter, State};

use super::sidecar::AgentSidecar;
use crate::state::{AgentSidecarState, InterviewAssistState, InterviewAssistTask};

const EVENT_NAME: &str = "interview-assist-stream";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssistMessage {
    pub role: String,
    pub content: String,
}

#[tauri::command]
pub fn interview_assist_start(
    request_id: String,
    question: String,
    history: Vec<AssistMessage>,
    company: Option<String>,
    position: Option<String>,
    app: tauri::AppHandle,
    sidecar: State<'_, AgentSidecarState>,
    state: State<'_, InterviewAssistState>,
) -> Result<(), String> {
    let mut guard = state
        .0
        .lock()
        .map_err(|e| format!("实时辅助状态锁失败: {}", e))?;
    if let Some(previous) = guard.take() {
        previous.handle.abort();
    }

    let sidecar = sidecar.0.clone();
    let rid = request_id.clone();
    let handle = tauri::async_runtime::spawn(async move {
        if let Err(e) =
            stream_assist(sidecar, app.clone(), &rid, question, history, company, position).await
        {
            let _ = app.emit(
                EVENT_NAME,
                serde_json::json!({
                    "request_id": rid,
                    "type": "error",
                    "message": e,
                }),
            );
        }
    });
    *guard = Some(InterviewAssistTask { request_id, handle });
    Ok(())
}

#[tauri::command]
pub fn interview_assist_cancel(
    request_id: String,
    state: State<'_, InterviewAssistState>,
) -> Result<(), String> {
    let mut guard = state
        .0
        .lock()
        .map_err(|e| format!("实时辅助状态锁失败: {}", e))?;
    let matches = guard
        .as_ref()
        .map(|task| task.request_id == request_id)
        .unwrap_or(false);
    if matches {
        if let Some(task) = guard.take() {
            task.handle.abort();
        }
    }
    Ok(())
}

async fn stream_assist(
    sidecar: AgentSidecar,
    app: tauri::AppHandle,
    request_id: &str,
    question: String,
    history: Vec<AssistMessage>,
    company: Option<String>,
    position: Option<String>,
) -> Result<(), String> {
    let body = serde_json::json!({
        "question": question,
        "history": history,
        "company": company,
        "position": position,
    });
    let resp = sidecar
        .stream_post("/interview_assist/stream", &body)
        .await?;

    let mut stream = resp.bytes_stream();
    let mut buf: Vec<u8> = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("读取实时辅助流失败: {}", e))?;
        buf.extend_from_slice(&chunk);
        while let Some(pos) = buf.windows(2).position(|w| w == b"\n\n") {
            let frame: Vec<u8> = buf.drain(..=pos).collect();
            let text = String::from_utf8_lossy(&frame);
            let mut data: Option<&str> = None;
            for line in text.lines() {
                let line = line.trim_end_matches('\r');
                if let Some(v) = line.strip_prefix("data: ") {
                    data = Some(v);
                }
            }
            if let Some(d) = data {
                if let Ok(mut payload) = serde_json::from_str::<serde_json::Value>(d) {
                    if let Some(obj) = payload.as_object_mut() {
                        obj.insert("request_id".to_string(), serde_json::json!(request_id));
                    }
                    let _ = app.emit(EVENT_NAME, payload);
                }
            }
        }
    }

    // Python 正常会先发 done；兜底一次，前端对重复 done 幂等。
    let _ = app.emit(
        EVENT_NAME,
        serde_json::json!({
            "request_id": request_id,
            "type": "done",
        }),
    );
    Ok(())
}

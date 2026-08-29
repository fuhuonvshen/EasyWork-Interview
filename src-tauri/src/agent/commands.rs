// EasyWork - Agent Tauri commands (thin HTTP proxies to Python agent server).
//
// All LLM logic (Ollama calls, context building, memory management,
// ReAct loop, skill system) runs in the Python sidecar.
// These commands only forward requests and return responses.

use tauri::{Emitter, State};
use crate::state::AgentSidecarState;
use crate::state::DbState;
use crate::database::repo;
use crate::database::models::TodoItem;

/// Forward a chat message to the Python agent server and return the AI response.
#[tauri::command]
pub async fn agent_chat(
    conversation_id: String,
    message: String,
    sidecar: State<'_, AgentSidecarState>,
) -> Result<String, String> {
    let body = serde_json::json!({
        "conversation_id": conversation_id,
        "message": message,
    });
    let resp: serde_json::Value = sidecar.0.post("/chat", &body).await?;
    resp["content"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "响应缺少 content 字段".to_string())
}

/// Stream agent chat via SSE. Emits "agent-stream" events (payloads have a
/// "type" field: plan/answer/tool/tool_result/error/done) and returns when
/// the stream ends. Uses a dedicated client without the 180s global timeout.
#[tauri::command]
pub async fn agent_chat_stream(
    conversation_id: String,
    message: String,
    app: tauri::AppHandle,
    sidecar: State<'_, AgentSidecarState>,
) -> Result<(), String> {
    let body = serde_json::json!({
        "conversation_id": conversation_id,
        "message": message,
    });
    let resp = sidecar.0.stream_post("/chat/stream", &body).await?;

    use futures_util::StreamExt;
    let mut stream = resp.bytes_stream();
    let mut buf: Vec<u8> = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("读取 Agent 流失败: {}", e))?;
        buf.extend_from_slice(&chunk);
        // Drain complete SSE frames (Python emits plain-\n frames ending in \n\n)
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
                if let Ok(payload) = serde_json::from_str::<serde_json::Value>(d) {
                    let _ = app.emit("agent-stream", &payload);
                }
            }
        }
    }
    Ok(())
}

/// Forward a file attachment request to the Python agent server.
#[tauri::command]
pub async fn agent_attach_file(
    conversation_id: String,
    file_path: String,
    sidecar: State<'_, AgentSidecarState>,
) -> Result<String, String> {
    let body = serde_json::json!({
        "conversation_id": conversation_id,
        "file_path": file_path,
    });
    let resp: serde_json::Value = sidecar.0.post("/attach_file", &body).await?;
    if let Some(err) = resp["error"].as_str() {
        return Err(err.to_string());
    }
    resp["content"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "响应缺少 content 字段".to_string())
}

/// List all conversations.
#[tauri::command]
pub async fn agent_list_conversations(
    sidecar: State<'_, AgentSidecarState>,
) -> Result<Vec<crate::database::models::AgentConversationSummary>, String> {
    sidecar.0.get("/list_conversations").await
}

/// Create a new conversation, returns its id.
#[tauri::command]
pub async fn agent_create_conversation(
    sidecar: State<'_, AgentSidecarState>,
) -> Result<String, String> {
    let resp: serde_json::Value = sidecar.0.post("/create_conversation", &serde_json::json!({})).await?;
    resp["id"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "响应缺少 id 字段".to_string())
}

/// Delete a conversation and its messages.
#[tauri::command]
pub async fn agent_delete_conversation(
    id: String,
    sidecar: State<'_, AgentSidecarState>,
) -> Result<(), String> {
    let body = serde_json::json!({ "id": id });
    let _: serde_json::Value = sidecar.0.post("/delete_conversation", &body).await?;
    Ok(())
}

/// Rename a conversation.
#[tauri::command]
pub async fn agent_rename_conversation(
    id: String,
    title: String,
    sidecar: State<'_, AgentSidecarState>,
) -> Result<(), String> {
    let body = serde_json::json!({ "id": id, "title": title });
    let _: serde_json::Value = sidecar.0.post("/rename_conversation", &body).await?;
    Ok(())
}

/// Forward file content (from file picker) to the Python server.
#[tauri::command]
pub async fn agent_attach_content(
    conversation_id: String,
    file_name: String,
    content: String,
    is_binary: bool,
    sidecar: State<'_, AgentSidecarState>,
) -> Result<String, String> {
    let body = serde_json::json!({
        "conversation_id": conversation_id,
        "file_name": file_name,
        "content": content,
        "is_binary": is_binary,
    });
    let resp: serde_json::Value = sidecar.0.post("/attach_content", &body).await?;
    if let Some(err) = resp["error"].as_str() {
        return Err(err.to_string());
    }
    resp["content"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "响应缺少 content 字段".to_string())
}

/// Get all messages for a conversation.
#[tauri::command]
pub async fn agent_get_messages(
    conversation_id: String,
    sidecar: State<'_, AgentSidecarState>,
) -> Result<Vec<crate::database::models::AgentMessage>, String> {
    sidecar.0.get(&format!("/get_messages?conversation_id={}", &conversation_id)).await
}

// ── Todo CRUD ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn todo_create(
    db: State<'_, DbState>,
    title: String,
    deadline: Option<String>,
    priority: Option<String>,
    source: Option<String>,
) -> Result<String, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
    let todo = TodoItem {
        id: id.clone(),
        title,
        status: "pending".to_string(),
        priority: priority.unwrap_or_else(|| "medium".to_string()),
        deadline,
        source: source.unwrap_or_else(|| "manual".to_string()),
        created_at: now,
        schedule_id: None,
    };
    repo::todo_create(&db.0, &todo)
        .await
        .map_err(|e| format!("创建待办失败: {}", e))?;
    Ok(id)
}

#[tauri::command]
pub async fn todo_list(
    db: State<'_, DbState>,
) -> Result<Vec<TodoItem>, String> {
    repo::todo_list(&db.0)
        .await
        .map_err(|e| format!("查询待办列表失败: {}", e))
}

#[tauri::command]
pub async fn todo_update_status(
    db: State<'_, DbState>,
    id: String,
    status: String,
) -> Result<(), String> {
    repo::todo_update_status(&db.0, &id, &status)
        .await
        .map_err(|e| format!("更新待办状态失败: {}", e))
}

#[tauri::command]
pub async fn todo_delete(
    db: State<'_, DbState>,
    id: String,
) -> Result<(), String> {
    repo::todo_delete(&db.0, &id)
        .await
        .map_err(|e| format!("删除待办失败: {}", e))
}

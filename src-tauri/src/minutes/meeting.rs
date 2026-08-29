// EasyWork - Meeting & minutes database commands

use tauri::State;
use crate::database::models::{Meeting, Minutes, Transcript};
use crate::state::{DbState, LlmState, SenseVoiceState, WhisperState};

#[tauri::command]
pub async fn generate_minutes(
    wav_path: String,
    meeting_title: String,
    live_text: Option<String>,
    live_transcript_json: Option<String>,  // JSON array of {speaker, text} chunks
    schedule_id: Option<String>,
    meeting_type: Option<String>,
    is_interview: Option<bool>,
    company: Option<String>,
    position: Option<String>,
    stage: Option<String>,
    whisper_state: State<'_, WhisperState>,
    sensevoice_state: State<'_, SenseVoiceState>,
    db: State<'_, DbState>,
    llm_state: State<'_, LlmState>,
) -> Result<String, String> {
    // 1. Transcribe WAV (system audio)
    let mut reader = hound::WavReader::open(&wav_path)
        .map_err(|e| format!("无法打开 WAV 文件: {}", e))?;
    let spec = reader.spec();
    let samples: Vec<f32> = reader.samples::<f32>().filter_map(|s| s.ok()).collect();
    if samples.is_empty() {
        return Err("WAV 文件中没有有效的音频采样".into());
    }
    let audio =
        crate::whisper::engine::convert_audio_for_whisper(&samples, spec.channels, spec.sample_rate);

    let sv_engine = {
        let sv = sensevoice_state.0.lock().map_err(|e| format!("状态锁失败: {}", e))?;
        sv.clone()
    };

    let whisper_engine = {
        let guard = whisper_state.0.lock().map_err(|e| format!("状态锁失败: {}", e))?;
        guard.clone()
    };

    // Prefer SenseVoice for final transcription; fallback to Whisper on any failure.
    // SenseVoice (ONNX) has O(n²) memory on long audio, so we fall back to Whisper
    // which processes audio in chunks and handles long recordings gracefully.
    // Both return segments with timestamps for click-to-seek audio playback.
    let (wav_transcript, segments) = if let Some(ref sv) = sv_engine {
        let sv_result = match sv.ensure_model_loaded().await {
            Ok(()) => {
                sv.transcribe_segments(&audio).await.map_err(|e| format!("SenseVoice 转写失败: {}", e))
            }
            Err(e) => Err(format!("SenseVoice 模型加载失败: {}", e)),
        };
        match sv_result {
            Ok(segs) if !segs.is_empty() => {
                log::info!("generate_minutes: using SenseVoice for final transcription");
                let text = segs.iter().map(|s| s.text.as_str()).collect::<Vec<_>>().join("\n");
                (text, segs)
            }
            Ok(_) | Err(_) => {
                log::warn!("SenseVoice failed with empty/error result, falling back to Whisper");
                if let Some(ref w) = whisper_engine {
                    w.ensure_model_loaded().await.map_err(|err| format!("Whisper 模型加载失败: {}", err))?;
                    log::info!("generate_minutes: using Whisper for final transcription");
                    let segs = w.transcribe_segments(&audio).await.map_err(|err| format!("Whisper 转写失败: {}", err))?;
                    let text = segs.iter().map(|s| s.text.as_str()).collect::<Vec<_>>().join("\n");
                    (text, segs)
                } else {
                    return Err(
                        "没有可用的语音识别模型。请在「模型管理」中下载 SenseVoice 或 ggml-small 模型。".into(),
                    );
                }
            }
        }
    } else if let Some(ref w) = whisper_engine {
        w.ensure_model_loaded().await.map_err(|e| format!("Whisper 模型加载失败: {}", e))?;
        log::info!("generate_minutes: using Whisper for final transcription");
        let segs = w.transcribe_segments(&audio)
            .await
            .map_err(|e| format!("Whisper 转写失败: {}", e))?;
        let text = segs.iter().map(|s| s.text.as_str()).collect::<Vec<_>>().join("\n");
        (text, segs)
    } else {
        return Err(
            "没有可用的语音识别模型。请在「模型管理」中下载 SenseVoice 或 ggml-small 模型。".into(),
        );
    };

    let segments_json = if segments.is_empty() {
        None
    } else {
        serde_json::to_string(&segments).ok()
    };

    let mut full_transcript = wav_transcript;
    if let Some(live) = live_text {
        if !live.trim().is_empty() {
            full_transcript = format!(
                "【系统音频转写】\n{}\n\n【实时麦克风转写】\n{}",
                full_transcript, live
            );
        }
    }

    if full_transcript.trim().is_empty() {
        return Err("转写内容为空，请确认录制时有声音输入".into());
    }

    log::info!("Combined transcript: {} chars", full_transcript.len());

    // 2. Generate minutes via local LLM
    let is_interview = is_interview.unwrap_or(false);
    let meeting_type = meeting_type.as_deref().unwrap_or(if is_interview { "面试" } else { "其他" });
    let minutes = if is_interview {
        crate::summary::gen::generate_interview_minutes(
            &full_transcript, &meeting_title, company.as_deref().unwrap_or(""), position.as_deref().unwrap_or(""),
            &llm_state.0,
        )
        .await
        .map_err(|e| format!("面试纪要生成失败: {}", e))?
    } else {
        crate::summary::gen::generate_minutes(&full_transcript, &meeting_title, meeting_type, &llm_state.0)
            .await
            .map_err(|e| format!("纪要生成失败: {}", e))?
    };

    // 3. Save to database
    let meeting_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Local::now().to_rfc3339();
    let duration_secs = (samples.len() as f64 / spec.sample_rate as f64) as i64;

    let meeting = Meeting {
        id: meeting_id.clone(),
        title: meeting_title.clone(),
        created_at: now.clone(),
        duration_secs,
        wav_path,
        schedule_id: schedule_id.clone(),
        pinned: false,
        kind: if is_interview { "interview".into() } else { "meeting".into() },
        company,
        position,
        stage,
        score: None,
    };
    crate::database::repo::insert_meeting(&db.0, &meeting)
        .await
        .map_err(|e| format!("保存会议失败: {}", e))?;

    crate::database::repo::insert_transcript(
        &db.0,
        &Transcript {
            id: uuid::Uuid::new_v4().to_string(),
            meeting_id: meeting_id.clone(),
            content: full_transcript.clone(),
            created_at: now.clone(),
            live_transcript: live_transcript_json.map(|s| {
                if s.trim().is_empty() || s == "[]" { None } else { Some(s) }
            }).flatten(),
            segments: segments_json,
        },
    )
    .await
    .map_err(|e| format!("保存转写失败: {}", e))?;

    crate::database::repo::insert_minutes(
        &db.0,
        &Minutes {
            id: uuid::Uuid::new_v4().to_string(),
            meeting_id: meeting_id.clone(),
            content: minutes.clone(),
            created_at: now,
        },
    )
    .await
    .map_err(|e| format!("保存纪要失败: {}", e))?;

    // 4. 面试模式：LLM 提取面试官问题（JSON），存为"待确认"（in_bank=0）
    let mut questions_json: Vec<serde_json::Value> = Vec::new();
    if is_interview {
        let extracted = crate::summary::gen::extract_interview_questions(&full_transcript, &llm_state.0).await;
        for q in extracted {
            let qid = uuid::Uuid::new_v4().to_string();
            let question = crate::database::models::InterviewQuestion {
                id: qid.clone(),
                category: if q.category.trim().is_empty() { "其他".into() } else { q.category },
                difficulty: "medium".into(),
                question: q.question,
                expected_answer: q.expected_answer.filter(|s| !s.trim().is_empty()),
                created_at: chrono::Local::now().to_rfc3339(),
                source_meeting_id: Some(meeting_id.clone()),
                in_bank: false,
            };
            if crate::database::repo::insert_interview_question(&db.0, &question).await.is_ok() {
                questions_json.push(serde_json::json!({
                    "id": qid,
                    "category": question.category,
                    "question": question.question,
                    "expected_answer": question.expected_answer,
                    "in_bank": false,
                }));
            }
        }
    }

    Ok(serde_json::json!({
        "meetingId": meeting_id,
        "content": minutes,
        "questions": questions_json,
    })
    .to_string())
}

#[tauri::command]
pub async fn update_meeting_minutes(
    meeting_id: String,
    content: String,
    db: State<'_, DbState>,
) -> Result<(), String> {
    crate::database::repo::update_minutes(&db.0, &meeting_id, &content)
        .await
        .map_err(|e| format!("更新纪要失败: {}", e))
}

#[tauri::command]
pub async fn list_meetings(
    page: Option<i64>,
    page_size: Option<i64>,
    query: Option<String>,
    date_from: Option<String>,
    date_to: Option<String>,
    db: State<'_, DbState>,
) -> Result<crate::database::models::PaginatedMeetings, String> {
    let page = page.unwrap_or(1).max(1);
    let page_size = page_size.unwrap_or(10).max(1).min(100);
    let from = date_from.filter(|s| !s.is_empty());
    let to = date_to.filter(|s| !s.is_empty());
    let (items, total) = if let Some(ref q) = query.filter(|s| !s.trim().is_empty()) {
        crate::database::repo::search_meetings_paginated(
            &db.0, q, page, page_size,
            from.as_deref(), to.as_deref(),
        )
        .await
        .map_err(|e| format!("搜索失败: {}", e))?
    } else {
        crate::database::repo::list_meetings_paginated(
            &db.0, page, page_size,
            from.as_deref(), to.as_deref(),
        )
        .await
        .map_err(|e| format!("查询失败: {}", e))?
    };
    Ok(crate::database::models::PaginatedMeetings {
        items,
        total,
        page,
        page_size,
    })
}

#[tauri::command]
pub async fn toggle_pin_meeting(
    id: String,
    pinned: bool,
    db: State<'_, DbState>,
) -> Result<(), String> {
    sqlx::query("UPDATE meetings SET pinned = ? WHERE id = ?")
        .bind(pinned as i32)
        .bind(&id)
        .execute(&db.0)
        .await
        .map_err(|e| format!("置顶失败: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn delete_meeting(
    id: String,
    delete_audio: Option<bool>,
    db: State<'_, DbState>,
) -> Result<(), String> {
    crate::database::repo::delete_meeting(&db.0, &id, delete_audio.unwrap_or(false))
        .await
        .map_err(|e| format!("删除会议失败: {}", e))
}

#[tauri::command]
pub async fn delete_meetings(
    ids: Vec<String>,
    delete_audio: Option<bool>,
    db: State<'_, DbState>,
) -> Result<(), String> {
    crate::database::repo::delete_meetings(&db.0, &ids, delete_audio.unwrap_or(false))
        .await
        .map_err(|e| format!("批量删除会议失败: {}", e))
}

/// Delete only the meeting's audio file(s), keeping the meeting record
/// and its minutes/transcript. Returns whether a file was removed.
#[tauri::command]
pub async fn delete_meeting_audio(
    meeting_id: String,
    db: State<'_, DbState>,
) -> Result<bool, String> {
    crate::database::repo::delete_meeting_audio(&db.0, &meeting_id)
        .await
        .map_err(|e| format!("删除音频失败: {}", e))
}

#[tauri::command]
pub async fn get_meeting_minutes(
    meeting_id: String,
    db: State<'_, DbState>,
) -> Result<String, String> {
    let m = crate::database::repo::get_minutes(&db.0, &meeting_id)
        .await
        .map_err(|e| format!("查询纪要失败: {}", e))?;
    m.map(|m| m.content)
        .ok_or("该会议没有纪要".into())
}

#[tauri::command]
pub async fn get_meeting(
    meeting_id: String,
    db: State<'_, DbState>,
) -> Result<crate::database::models::MeetingDetail, String> {
    crate::database::repo::get_meeting_detail(&db.0, &meeting_id)
        .await
        .map_err(|e| format!("查询会议失败: {}", e))?
        .ok_or_else(|| "会议不存在".into())
}

#[tauri::command]
pub async fn get_meeting_transcript(
    meeting_id: String,
    db: State<'_, DbState>,
) -> Result<serde_json::Value, String> {
    let transcript = crate::database::repo::get_transcript(&db.0, &meeting_id)
        .await
        .map_err(|e| format!("查询转写失败: {}", e))?
        .ok_or_else(|| "该会议没有转写记录".to_string())?;

    let chunks: Vec<serde_json::Value> = transcript.live_transcript
        .and_then(|s| serde_json::from_str::<Vec<serde_json::Value>>(&s).ok())
        .unwrap_or_default();

    let segments: Vec<serde_json::Value> = transcript.segments
        .and_then(|s| serde_json::from_str::<Vec<serde_json::Value>>(&s).ok())
        .unwrap_or_default();

    Ok(serde_json::json!({
        "chunks": chunks,
        "segments": segments,
        "rawContent": transcript.content,
    }))
}

#[tauri::command]
pub async fn update_meeting_title(
    meeting_id: String,
    title: String,
    db: State<'_, DbState>,
) -> Result<(), String> {
    crate::database::repo::update_meeting_title(&db.0, &meeting_id, &title)
        .await
        .map_err(|e| format!("更新会议标题失败: {}", e))
}

// ── 面试（Interview）命令 ─────────────────────────────────────────

/// 把已有 meeting 标记为面试记录并写入公司/岗位/阶段
#[tauri::command]
pub async fn update_meeting_interview_info(
    meeting_id: String,
    company: Option<String>,
    position: Option<String>,
    stage: Option<String>,
    db: State<'_, DbState>,
) -> Result<(), String> {
    crate::database::repo::update_meeting_interview_info(
        &db.0, &meeting_id, company.as_deref(), position.as_deref(), stage.as_deref(),
    )
    .await
    .map_err(|e| format!("更新面试信息失败: {}", e))
}

/// 保存 AI 面试评估（结构化维度 JSON + 总分 + 总结）
#[tauri::command]
pub async fn save_interview_assessment(
    interview_id: String,
    dimensions: String,
    score: Option<i64>,
    summary: Option<String>,
    db: State<'_, DbState>,
) -> Result<(), String> {
    use crate::database::models::InterviewAssessment;
    let now = chrono::Local::now().to_rfc3339();
    let a = InterviewAssessment {
        id: uuid::Uuid::new_v4().to_string(),
        interview_id,
        dimensions,
        score,
        summary,
        created_at: now,
    };
    crate::database::repo::save_interview_assessment(&db.0, &a)
        .await
        .map_err(|e| format!("保存面试评估失败: {}", e))?;
    if let Some(s) = a.score {
        crate::database::repo::update_meeting_score(&db.0, &a.interview_id, Some(s))
            .await
            .map_err(|e| format!("更新面试评分失败: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn get_interview_assessment(
    interview_id: String,
    db: State<'_, DbState>,
) -> Result<Option<crate::database::models::InterviewAssessment>, String> {
    crate::database::repo::get_interview_assessment(&db.0, &interview_id)
        .await
        .map_err(|e| format!("查询面试评估失败: {}", e))
}

// ── 面试题库命令（AI 提取的面试官问题）───────────────────────────

#[tauri::command]
pub async fn interview_question_create(
    category: String,
    difficulty: String,
    question: String,
    expected_answer: Option<String>,
    db: State<'_, DbState>,
) -> Result<(), String> {
    use crate::database::models::InterviewQuestion;
    let q = InterviewQuestion {
        id: uuid::Uuid::new_v4().to_string(),
        category,
        difficulty: if difficulty.is_empty() { "medium".into() } else { difficulty },
        question,
        expected_answer,
        source_meeting_id: None,
        in_bank: true,
        created_at: chrono::Local::now().to_rfc3339(),
    };
    crate::database::repo::insert_interview_question(&db.0, &q)
        .await
        .map_err(|e| format!("保存面试题失败: {}", e))
}

#[tauri::command]
pub async fn interview_question_list(
    category: Option<String>,
    limit: Option<i64>,
    db: State<'_, DbState>,
) -> Result<Vec<crate::database::models::InterviewQuestion>, String> {
    crate::database::repo::list_interview_questions(&db.0, category.as_deref(), limit.unwrap_or(200))
        .await
        .map_err(|e| format!("查询面试题失败: {}", e))
}

#[tauri::command]
pub async fn interview_question_delete(
    id: String,
    db: State<'_, DbState>,
) -> Result<(), String> {
    crate::database::repo::delete_interview_question(&db.0, &id)
        .await
        .map_err(|e| format!("删除面试题失败: {}", e))
}

/// 查询某场面试提取出的全部题目（含未入题库的待确认项）— 纪要弹窗/历史记录用
#[tauri::command]
pub async fn get_meeting_questions(
    meeting_id: String,
    db: State<'_, DbState>,
) -> Result<Vec<crate::database::models::InterviewQuestion>, String> {
    crate::database::repo::list_meeting_questions(&db.0, &meeting_id)
        .await
        .map_err(|e| format!("查询面试题目失败: {}", e))
}

/// 将选中的题目加入题库（in_bank = 1）
#[tauri::command]
pub async fn add_questions_to_bank(
    ids: Vec<String>,
    db: State<'_, DbState>,
) -> Result<usize, String> {
    crate::database::repo::add_questions_to_bank(&db.0, &ids)
        .await
        .map_err(|e| format!("加入题库失败: {}", e))
}

/// 保存我的简历（全局资产，最新一条生效）
#[tauri::command]
pub async fn save_resume(
    file_name: String,
    content: String,
    db: State<'_, DbState>,
) -> Result<String, String> {
    if content.trim().is_empty() {
        return Err("简历内容为空".into());
    }
    crate::database::repo::save_resume(&db.0, &file_name, &content)
        .await
        .map_err(|e| format!("保存简历失败: {}", e))
}

/// 获取最新简历
#[tauri::command]
pub async fn get_resume(
    db: State<'_, DbState>,
) -> Result<Option<crate::database::models::Resume>, String> {
    crate::database::repo::get_resume(&db.0)
        .await
        .map_err(|e| format!("查询简历失败: {}", e))
}

// EasyWork - Shared state types used across command modules.

use std::sync::Mutex;
use sqlx::sqlite::SqlitePool;
use crate::audio::capture::AudioCapture;
use crate::whisper::engine::WhisperEngine;
use crate::sensevoice::engine::SenseVoiceEngine;
use crate::diarization::DiarizationEngine;
use crate::llm::engine::LlmEngine;
use crate::agent::sidecar::AgentSidecar;

pub struct CaptureState(pub Mutex<Option<AudioCapture>>);
pub struct WhisperState(pub Mutex<Option<std::sync::Arc<WhisperEngine>>>);
pub struct SenseVoiceState(pub Mutex<Option<std::sync::Arc<SenseVoiceEngine>>>);
pub struct DiarizationState(pub Mutex<Option<std::sync::Arc<DiarizationEngine>>>);
pub struct LlmState(pub std::sync::Arc<tokio::sync::RwLock<LlmEngine>>);
pub struct DbState(pub SqlitePool);
pub struct TranscriptBufState(pub std::sync::Arc<std::sync::Mutex<Vec<serde_json::Value>>>);
pub struct ReminderState(pub std::sync::Arc<std::sync::Mutex<Option<serde_json::Value>>>);
pub struct TranscriptTaskState(pub Mutex<Vec<tauri::async_runtime::JoinHandle<()>>>);
/// Agent sidecar HTTP proxy for communicating with the Python agent server.
pub struct AgentSidecarState(pub AgentSidecar);
/// Handle to the Python agent server child process (for lifecycle management).
/// Wrapped in KillOnDrop so the process is killed when the app exits.
pub struct KillOnDrop(pub Option<tokio::process::Child>);

impl Drop for KillOnDrop {
    fn drop(&mut self) {
        if let Some(mut child) = self.0.take() {
            let _ = child.start_kill();
        }
    }
}
pub struct AgentProcessState(pub std::sync::Arc<std::sync::Mutex<KillOnDrop>>);
/// Registry of all child process PIDs for reliable cleanup on exit.
pub struct ChildProcesses(pub std::sync::Arc<std::sync::Mutex<Vec<u32>>>);

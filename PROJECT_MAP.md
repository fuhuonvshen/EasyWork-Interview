# EasyWork 项目地图

> 三层架构：React 前端 → Rust/Tauri 后端 + Python Agent 侧边服务 → SQLite 数据库
>
> 更新说明：本文档与当前代码同步（2026-08）。

---

## 导航与入口

| 文件 | 说明 |
|------|------|
| [App.tsx](src/App.tsx) | 顶层视图切换：workbench / minutes / agent / feedback 四视图 + 会议提醒弹窗(ReminderModal) + 托盘导航事件(tray-navigate) + 更新检查 |
| [main.tsx](src/main.tsx) | React 入口 |
| [main.rs](src-tauri/src/main.rs) | Rust 入口（release 模式禁止控制台窗口 + 启动 Tauri） |
| [lib.rs](src-tauri/src/lib.rs) | Tauri 应用主入口：模块声明、状态注册、`generate_handler!` 命令注册、系统托盘(build_tray)、后台初始化编排(init_background)、退出清理(cleanup_child_process)、Silero VAD 模型下载(ensure_vad_model) |

---

## 一、会议系统

### 录制 → 转写 → AI 纪要 → 查看/编辑/导出

#### 前端

| 文件 | 说明 |
|------|------|
| [minutes/index.tsx](src/minutes/index.tsx) | MinutesApp 主布局：MinutesSidebar + 内容区；today / history / schedule 三 tab；history 子标签 meetings / week / month；报告查看弹窗 |
| [minutes/components/MinutesSidebar.tsx](src/minutes/components/MinutesSidebar.tsx) | 会议模块侧边栏导航 |
| [minutes/components/MeetingModelCheck.tsx](src/minutes/components/MeetingModelCheck.tsx) | 进入会议模块时检查 VAD + 声纹模型就绪状态，未就绪显示下载进度 |
| [minutes/recording/TodayView.tsx](src/minutes/recording/TodayView.tsx) | 录制面板：选设备 → 填标题/类型 → 开始/停止录制 → 实时转写展示 → 导入已有音频文件 → 生成纪要弹窗(会议总结/转写记录) |
| [minutes/history/MeetingListView.tsx](src/minutes/history/MeetingListView.tsx) | 历史会议列表：搜索 + 筛选 + 分页 + 置顶 + 管理模式批量删除 |
| [minutes/history/HistoryDetail.tsx](src/minutes/history/HistoryDetail.tsx) | 查看/编辑单条纪要 + 导出下拉(ExportDropdown: md/docx/pdf/png) |
| [minutes/reports/ReportList.tsx](src/minutes/reports/ReportList.tsx) | 周报/月报列表 |
| [minutes/reports/ReportViewModal.tsx](src/minutes/reports/ReportViewModal.tsx) | 报告内容查看弹窗 |
| [schedule/index.tsx](src/schedule/index.tsx) | ScheduleView：日历视图 + 日程 CRUD + 生成周报/月报(ReportModal) + 详情面板 + 一键进入录制 |
| [schedule/useSchedule.ts](src/schedule/useSchedule.ts) | 日程数据加载/CRUD hook |
| [schedule/CalendarGrid.tsx](src/schedule/CalendarGrid.tsx)、[CalendarDayCell.tsx](src/schedule/CalendarDayCell.tsx) | 月历网格渲染 |
| [schedule/DayDetailPanel.tsx](src/schedule/DayDetailPanel.tsx) | 某天日程详情面板（编辑/删除/跳转历史纪要） |
| [schedule/ScheduleForm.tsx](src/schedule/ScheduleForm.tsx) | 新建/编辑日程表单（标题/起止时间/会议链接） |
| [schedule/ReportModal.tsx](src/schedule/ReportModal.tsx) | 周报/月报生成弹窗 |

#### 后端 (Rust)

| 文件 | 说明 |
|------|------|
| [minutes/meeting.rs](src-tauri/src/minutes/meeting.rs) | `generate_minutes`(转写+LLM纪要), `list_meetings`(分页搜索), `get_meeting`, `get_meeting_minutes`, `get_meeting_transcript`, `update_meeting_minutes`, `update_meeting_title`, `delete_meeting/s`, `delete_meeting_audio`, `toggle_pin_meeting` |
| [minutes/schedule.rs](src-tauri/src/minutes/schedule.rs) | `add/list/update/delete_scheduled_meeting`, `find_meeting_by_schedule` |
| [minutes/reminder.rs](src-tauri/src/minutes/reminder.rs) | `get_pending_reminder`, `dismiss_reminder`（配合 mod.rs 的 30s 轮询 spawn_reminder） |
| [minutes/report.rs](src-tauri/src/minutes/report.rs) | `generate_report`(周/月), `list_reports`, `delete_report`, `export_report`(转发 Python) |
| [minutes/meeting_link.rs](src-tauri/src/minutes/meeting_link.rs) | `launch_meeting_link`：会议链接深链转换（zoommtg:// wemeet:// 优先，Web 链接尽力解析，其他系统默认打开） |

#### 后端 (Python Agent — 导出)

- [export.py](src-tauri/py_backend/export.py) — markdown → docx/PDF/PNG 渲染（经 `export_report` 路由）

---

## 二、AI 办公助手 (Agent)

### 对话式 AI + 待办管理（流式响应）

#### 前端

| 文件 | 说明 |
|------|------|
| [agent/AgentApp.tsx](src/agent/AgentApp.tsx) | 主布局：对话/待办 tab 切换(agentSubView)，列表加载，CRUD 透传，LLM 就绪状态监听(init-status) |
| [agent/AgentSidebar.tsx](src/agent/AgentSidebar.tsx) | 左侧边栏：对话列表(新建/重命名/删除) + 待办列表(checkbox/优先级徽标/截止日期/待办数量角标) |
| [agent/AgentChat.tsx](src/agent/AgentChat.tsx) | 聊天区域：消息气泡(含 plan/thinking/tool 流式事件) + 输入框(Enter 发送) + 文件拖拽/选择上传(Excel/CSV/TXT) |
| [agent/AgentTodo.tsx](src/agent/AgentTodo.tsx) | 待办完整视图：待完成/已完成分组 + 新建表单(标题/截止日期/优先级) + 空状态提示 |
| [agent/memories/MEMORY.md](src/agent/memories/MEMORY.md) | Agent 长期记忆文件（由 Python 侧维护） |

#### 后端 (Rust)

| 文件 | 说明 |
|------|------|
| [agent/commands.rs](src-tauri/src/agent/commands.rs) | `agent_chat`(流式), `agent_chat_stream`, `agent_attach_file`, `agent_attach_content`, `agent_list/create/delete/rename_conversation`, `agent_get_messages` + `todo_create/list/update_status/delete` |
| [agent/sidecar.rs](src-tauri/src/agent/sidecar.rs) | Python FastAPI sidecar 进程管理：动态端口(默认 9876)、开发/发布双路径查找(binaries/easywork-agent)、HTTP 代理 |
| [agent/mod.rs](src-tauri/src/agent/mod.rs) | 模块组织 + `init()` 初始化 sidecar |

#### 后端 (Python Agent — LLM 业务逻辑)

| 文件 | 说明 |
|------|------|
| [main.py](src-tauri/py_backend/main.py) | FastAPI 入口：日志(request_id)、lifespan、路由注册、skill 注册表加载、记忆文件确保 |
| [routes.py](src-tauri/py_backend/routes.py) | API 路由：/chat(ReAct+Plan-then-Execute), /attach_file, /export_report + Docker 镜像检查 |
| [config.py](src-tauri/py_backend/config.py) | 配置：AGENT_PORT, DB_PATH, LOG_FILE, MEMORIES_DIR 等 |
| [llm/chat.py](src-tauri/py_backend/llm/chat.py) | 对话主逻辑（ReAct + Plan-then-Execute + Skill 系统 + 流式事件） |
| [llm/client.py](src-tauri/py_backend/llm/client.py) | LLM API 通信（OpenAI 兼容 / Ollama） |
| [llm/context.py](src-tauri/py_backend/llm/context.py) | 对话上下文构建 |
| [llm/prompt.py](src-tauri/py_backend/llm/prompt.py) | 系统提示词 |
| [llm/memory.py](src-tauri/py_backend/llm/memory.py) | 短期对话摘要 + 长期记忆文件(MEMORY.md) |
| [data/database.py](src-tauri/py_backend/data/database.py)、[db_config.py](src-tauri/py_backend/data/db_config.py)、[models.py](src-tauri/py_backend/data/models.py) | Python 侧 SQLite 访问（aiosqlite，共享 easywork.db） |
| [tools/registry.py](src-tauri/py_backend/tools/registry.py) | Skill/工具注册表（从 SKILL.md / handlers 加载） |
| [tools/handlers/](src-tauri/py_backend/tools/handlers/) | 工具实现：email(发邮件), execute_python(沙箱执行), todo(待办), xlsx(Excel 处理) |
| [tools/sandbox.py](src-tauri/py_backend/tools/sandbox.py) | Docker 沙箱执行 |
| [tools/file_preview.py](src-tauri/py_backend/tools/file_preview.py)、[executor.py](src-tauri/py_backend/tools/executor.py)、[email.py](src-tauri/py_backend/tools/email.py) | 文件预览 / 工具执行编排 / 邮件工具 |
| [Dockerfile](src-tauri/py_backend/Dockerfile) | 沙箱镜像 |

---

## 三、语音识别引擎（双引擎 + VAD + 降噪 + 说话人区分）

| 文件 | 说明 |
|------|------|
| [audio/capture.rs](src-tauri/src/audio/capture.rs) | WASAPI 系统音频环回捕获 + 麦克风同步录制 + 混合输出 |
| [audio/device.rs](src-tauri/src/audio/device.rs) | 音频设备枚举 |
| [audio/denoise.rs](src-tauri/src/audio/denoise.rs) | 实时降噪：RNNoise 纯 Rust 移植(nnnoiseless)，trait `Denoiser` 可替换 |
| [audio/commands.rs](src-tauri/src/audio/commands.rs) | `list_devices`, `start_capture`, `stop_capture`, `get_transcript_chunks`, `check_meeting_models`, `prepare_playback_audio` |
| [asr/mod.rs](src-tauri/src/asr/mod.rs) | 引擎统一入口：`asr_check_model`, `asr_list_models`（Whisper/SenseVoice 自动选择） |
| [whisper/](src-tauri/src/whisper/) | Whisper.cpp 封装：engine.rs + commands.rs（模型下载/加载/卸载/删除/转写） |
| [sensevoice/](src-tauri/src/sensevoice/) | SenseVoice 封装：engine.rs + commands.rs + noise.rs |
| [diarization/mod.rs](src-tauri/src/diarization/mod.rs) | 说话人区分：sherpa-onnx 声纹提取(eres2net 中文模型，缺失自动下载)，比对标注"我/发言人/参会者_N" |

---

## 四、本地 LLM 引擎

| 文件 | 说明 |
|------|------|
| [llm/engine.rs](src-tauri/src/llm/engine.rs) | llama.cpp 服务(llama-server)封装：下载二进制 + 模型加载，用于纪要/报告生成(Rust 侧本地推理)，暴露 server_pid 供退出清理 |
| [llm/commands.rs](src-tauri/src/llm/commands.rs) | 模型管理：`llm_list_models`, `llm_download_model`, `llm_download_status`, `llm_cancel_download`, `llm_delete_model`, `llm_load/unload_model`, `llm_server_status`, `llm_download_binary`, `agent_prepare_llm` |
| [llm/models.rs](src-tauri/src/llm/models.rs) | 模型信息定义 |
| [summary/gen.rs](src-tauri/src/summary/gen.rs) | 纪要生成 prompt |
| [summary/template.rs](src-tauri/src/summary/template.rs) | 纪要格式化模板 |

> **两个 LLM 入口**：Rust 侧(llama.cpp)用于纪要/报告生成，Python 侧(OpenAI 兼容/Ollama)用于对话 Agent

---

## 五、数据库层

| 文件 | 说明 |
|------|------|
| [database/mod.rs](src-tauri/src/database/mod.rs) | 初始化连接池 |
| [database/models.rs](src-tauri/src/database/models.rs) | 数据模型（meetings, transcripts, minutes, scheduled_meetings, reports, agent_conversations, agent_messages, agent_todos, settings 等） |
| [database/repo.rs](src-tauri/src/database/repo.rs) | 所有 CRUD + 自动建表/迁移 |

### 表结构

```
meetings              — 会议记录（含 pin 置顶、音频文件路径）
transcripts           — 语音转写 (FK→meetings)
minutes               — AI 纪要 (FK→meetings)
scheduled_meetings    — 日程安排（含会议链接）
reports               — 周报/月报
agent_conversations   — Agent 对话
agent_messages        — 对话消息（含 tool_calls）
agent_todos           — 待办事项（含 priority/deadline/source）
settings              — 设置键值对
```

Rust 和 Python **共享同一个 SQLite 文件**(WAL 模式保障并发安全)。

---

## 六、设置 / 更新 / 反馈

| 文件 | 说明 |
|------|------|
| [settings/commands.rs](src-tauri/src/settings/commands.rs) | `get_settings`, `update_setting`, `select_folder`, `get_default_paths`, `pick_audio_file` |
| [update.rs](src-tauri/src/update.rs) | 更新全流程：`update_check`(GitHub update.json) → `update_download`(MSI + update-progress 事件) → `install_update`(清理 sidecar → msiexec → 退出) + `exit_for_update` |
| [feedback.rs](src-tauri/src/feedback.rs) | `send_feedback`：飞书群机器人 webhook（HMAC-SHA256 签名）推送反馈 |
| [settings/ModelDownloadDialog.tsx](src/settings/ModelDownloadDialog.tsx) | 模型下载对话框（语音 Whisper/SenseVoice + LLM） |
| [settings/ModelCard.tsx](src/settings/ModelCard.tsx)、[useModelDownload.ts](src/settings/useModelDownload.ts) | 模型卡片 / 下载 hook |

---

## 七、通用组件与全局状态

### 通用组件 [components/](src/components/)

| 文件 | 说明 |
|------|------|
| ConfirmDialog.tsx | 确认弹窗（危险操作） |
| ExportDropdown.tsx | 复用导出下拉（MD / DOCX / PDF / PNG） |
| Markdown.tsx | Markdown 渲染组件 |
| Select.tsx | 下拉选择 |
| TitleBar.tsx | 自绘标题栏（无边框窗口；Win/Linux 自绘按钮，macOS Overlay） |
| Toast.tsx | 轻提示 |
| UpdateDialog.tsx | 更新提示弹窗（含下载进度） |

### 其他

| 文件 | 说明 |
|------|------|
| [errors.ts](src/errors.ts) | 错误码 → 用户友好文案映射(ERRORS, toUserError) |
| [utils/calendar.ts](src/utils/calendar.ts) | 日历工具函数 |
| [workbench/Workbench.tsx](src/workbench/Workbench.tsx) | 工作台首页（功能入口卡片 + 版本号） |
| [workbench/FeedbackView.tsx](src/workbench/FeedbackView.tsx) | 意见反馈（邮件形式 → 飞书 webhook） |
| [ReminderModal.tsx](src/ReminderModal.tsx) | 会议提醒弹窗（轮询 get_pending_reminder） |

### 全局状态 [state.rs](src-tauri/src/state.rs)

`DbState`(连接池), `CaptureState`, `WhisperState`, `SenseVoiceState`, `DiarizationState`, `LlmState`, `TranscriptBufState`(转写缓冲), `TranscriptTaskState`(转写任务句柄), `ReminderState`, `AgentSidecarState`(端口), `AgentProcessState`(KillOnDrop), `ChildProcesses`(PID 注册表，退出清理)

---

## 八、类型定义（前后端契约）

- [types.ts](src/types.ts) — `AudioDevice`, `MeetingRow`, `ScheduledMeeting`, `ModelStatus/ModelInfo`, `MinutesTab`, `AgentConversationSummary`, `AgentMessage`, `AgentStreamEvent`(plan/thinking/answer/tool/tool_result/error/done), `ToolCall`, `TodoItem`, `ReportItem`, `SpeechModelEntry`, `LlmModelEntry`

---

## 关键数据流图解

### 会议录制流程

```
[TodayView] start_capture → Rust WASAPI 捕获系统音频 + RNNoise 实时降噪
    → Silero VAD 切分语音片段 → Whisper/SenseVoice 转写
    → 声纹说话人区分(标注"我/发言人/参会者_N") → TranscriptBufState 缓冲
    → 前端 get_transcript_chunks 轮询实时展示
    → 用户点结束 → stop_capture + generate_minutes
    → Rust 调本地 LLM(llama.cpp) 生成纪要 → 存库
    → TodayView 显示纪要弹窗（会议总结/转写记录）
    → 历史记录: MinutesApp → MeetingListView → HistoryDetail
    → 导出: export_report → Rust 转发 Python → docx/pdf/png 保存
```

### Agent 对话流程（流式）

```
[AgentChat] invoke("agent_chat_stream") → Rust 代理 → Python /chat
    → Python 构建上下文(历史消息+system prompt+skills+记忆)
    → ReAct 循环: 调 LLM → 解析工具调用(邮件/待办/Excel/沙箱) → 执行 → 继续
    → 流式事件回推(plan → thinking → tool执行状态 → answer)
    → 后处理提取 todo JSON 写库
    → 前端 AgentApp 刷新对话 + 待办列表
```

### 待办联动

```
对话提取: "帮我记一下…" → LLM 输出 todo JSON → Python insert_todo()
日程同步: ScheduleView 新建日程 → todo_create 自动生成待办
手动创建: AgentTodo 新建表单 → todo_create
```

### 提醒 / 托盘 / 更新

```
提醒: spawn_reminder 每30s轮询 → 到期写入 ReminderState → ReminderModal 弹窗
托盘: build_tray(打开主页面/加入会议/开启对话/退出) → tray-navigate 事件切换视图
更新: App 启动 update_check → UpdateDialog → update_download(进度) → install_update(msiexec) → 退出
```

---

## 九、系统初始化顺序（lib.rs setup + init_background）

```
setup: 数据库 → 读设置 → spawn_reminder(提醒轮询) → build_tray(托盘) → 后台初始化
init_background(窗口显示后不阻塞 UI):
  → start_agent_sidecar（独立优先启动，Python sidecar）
  → Whisper 引擎 → SenseVoice 引擎 → Silero VAD 模型
  → 说话人区分引擎(自动下载声纹模型) → LLM 引擎
  → 每个模块通过 init-status 事件向前端广播状态
```

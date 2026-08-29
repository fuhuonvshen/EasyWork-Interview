# EasyWork

智能会议助手与个人工作台。EasyWork 是一款面向职场人士的本地桌面应用，将会议管理、语音转写、日程规划和 AI 助手整合到一个无缝的工作流中。

与传统会议工具不同，EasyWork 注重**隐私优先**——音频处理和 AI 推理均在本地运行，数据不出设备。同时支持接入云端大模型以获得更强大的 AI 助手能力。

## 功能

**🎙 会议录制与转写**
- 系统音频环回捕获（Windows WASAPI / macOS CoreAudio），录制会议软件（Teams、腾讯会议、钉钉等）的输出音频
- 麦克风音频同步录制，支持混合输出
- 支持 Whisper 和 SenseVoice 双引擎转写，自动选择最优引擎
- Silero VAD（语音活动检测）智能切分语音片段

**🗣 说话人区分**
- 基于声纹识别的自动说话人区分，自动标记"发言人"与"我"
- 转写结果实时展示，附带说话人标签

**📅 日程管理**
- 日历视图，按月展示会议日程
- 新建、编辑、删除会议，支持添加会议链接
- 会议前自动推送提醒通知
- 生成周报与月报

**✅ 待办任务**
- 全功能待办列表，支持创建、勾选完成、删除
- 会议自动生成关联待办，双向同步（删除待办同步删除关联日程）
- 优先级标签（高/中/低）和截止日期
- AI 助手可自动从对话中提取待办

**🤖 AI 办公助手**
- 基于大语言模型的对话式助手（ReAct 框架）
- 工具调用能力：管理待办和日程、发送邮件、执行 Python 代码、处理 Excel 数据
- 自动分析会议纪要、生产数据（OEE、产量统计等）
- 长期记忆：自动记住用户偏好、角色身份、决策约定，跨对话延续

**📝 纪要生成**
- 基于转写结果自动生成会议纪要
- 支持日报、周报、月报格式
- 支持导出为 Markdown、Word 文档格式

## 技术栈

- **桌面框架** — Tauri v2
- **前端** — React 18 + TypeScript + Vite + Tailwind CSS
- **后端** — Rust（音频处理、Tauri 命令）
- **AI 代理** — Python（FastAPI + DeepSeek / OpenAI 兼容 API）
- **语音转写** — Whisper / SenseVoice + Silero VAD
- **数据库** — SQLite（sqlx）

## 开始使用

### 前置依赖

- [Rust](https://www.rust-lang.org/)（最新稳定版）
- [Node.js](https://nodejs.org/) 20+
- [Python](https://www.python.org/) 3.11+

### 安装与运行

```bash
# 安装前端依赖
npm install

# 安装 Python 依赖
cd src-tauri/py_backend
pip install -r requirements.txt
cd ../..

# 开发模式运行
npm run tauri:dev
```

### 构建安装包

```bash
npm run tauri build
```

## 分支规范

- `main` — 稳定分支，所有发布基于此分支
- `feature/*` — 功能开发分支
- `fix/*` — 修复分支

## License

MIT

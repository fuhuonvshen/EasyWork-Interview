# EasyWork 面试助手

智能面试备考助手。EasyWork 是一款面向求职者的本地桌面应用，将面试录音、语音转写、AI 面试复盘、模拟面试和面试日程整合到一个无缝的工作流中。

与传统面试工具不同，EasyWork 注重**隐私优先**——音频处理和 AI 推理均在本地运行，数据不出设备。同时支持接入云端大模型以获得更强大的 AI 助手能力。

## 功能

**🎙 面试记录与转写**
- 系统音频环回捕获（Windows WASAPI / macOS CoreAudio），录制线上面试（腾讯会议、飞书、Teams 等）的输出音频
- 麦克风音频同步录制，支持混合输出
- 支持 Whisper 和 SenseVoice 双引擎转写，自动选择最优引擎
- Silero VAD（语音活动检测）智能切分语音片段

**🗣 说话人区分**
- 基于声纹识别的自动说话人区分，自动标记"候选人"与"面试官"
- 转写结果实时展示，附带说话人标签

**📝 AI 面试复盘**
- 基于转写自动生成**求职者视角**的面试复盘：问答要点、表现亮点、待改进项、五维评分、下一步建议
- 支持导出为 Markdown、Word、PDF、PNG

**🤖 AI 面试助手（角色化 Agent）**
- **模拟面试官**：按目标岗位出题、逐题点评，结束后生成维度评分报告
- **复盘分析师**：基于面试转写深度复盘，输出亮点、不足与改进建议
- **简历顾问**：解析简历，按目标 JD 逐节优化，输出匹配度分析
- **通用助手**：岗位调研、面经问答、薪资谈判
- 面试题库管理、长期记忆（求职档案：目标岗位、偏好、决策）

**📅 面试日程**
- 日历视图，按投递 / 电话面 / 线上面 / 现场面 / Offer 阶段管理
- 面试前自动推送提醒通知
- 生成求职复盘周报与月报（投递统计、通过率、各公司表现）

**✅ 待办任务**
- 全功能待办列表，AI 助手可自动从对话中提取跟进事项（投简历、刷题、感谢信）

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

**推荐：云端构建（无需本地 Rust 环境）**

本项目已配置 GitHub Actions（`.github/workflows/build.yml`），Rust/whisper.cpp/sherpa-onnx 等重型编译全部在云端完成，本地不需要安装 Rust：

1. 推送代码到 `main` 分支 → 在仓库 **Actions** 页面查看构建进度
2. 构建完成后，从 Actions 运行记录底部下载 **EasyWork-windows-installer** 安装包直接安装
3. 打 `v*` 标签（如 `v1.0.7`）会自动生成 GitHub **Release**，附带安装包与更新清单

首次云端构建约 15-40 分钟（需现场编译 whisper.cpp、sherpa-onnx），之后有缓存会显著加快。

**本地构建（可选）**：

```bash
npm run tauri build
```

## 分支规范

- `main` — 稳定分支，所有发布基于此分支
- `feature/*` — 功能开发分支
- `fix/*` — 修复分支

## License

MIT

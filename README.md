<div align="center">

# EasyWork 面试助手

**一款面向求职者的本地桌面应用：面试录音 → 语音转写 → AI 复盘 → 模拟面试，一站式备考工作流。**

![Version](https://img.shields.io/github/v/release/fuhuonvshen/EasyWork-Interview)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS-0d9488)
![Tauri](https://img.shields.io/badge/Tauri-2.0-24c8db)
![Build](https://img.shields.io/github/actions/workflow/status/fuhuonvshen/EasyWork-Interview/build.yml)

</div>

---

## 为什么用 EasyWork？

- **🎙 录音即复盘**：录制线上面试（腾讯会议 / 飞书 / Teams…），自动转写、自动区分说话人，结束一键生成求职者视角的 AI 复盘
- **🤖 角色化 AI 助手**：模拟面试官、复盘分析师、简历顾问、通用助手四种角色，全流程陪伴备考
- **🔒 本地优先**：语音转写（Whisper / SenseVoice）默认在本地运行，数据不出设备；可选接入在线大模型获得更强能力

## 功能特性

### 🎙 面试记录与转写

| 能力 | 说明 |
|---|---|
| 系统音频环回捕获 | 录制线上面试的输出音频（Windows WASAPI / macOS CoreAudio），麦克风同步录制可混合 |
| 双引擎转写 | Whisper 与 SenseVoice 自动选择，Silero VAD 智能切分语音片段 |
| 实时字幕 | 录制过程中实时转写，带说话人标签，点击跳转对应音频位置 |
| 说话人区分 | 基于声纹识别自动标记"候选人"与"面试官" |

### 📝 AI 面试复盘

- 基于转写自动生成**求职者视角**复盘：问答要点、表现亮点、待改进项、五维评分、下一步建议
- 导出 Markdown / Word / PDF / PNG

### 🤖 角色化 AI 助手

| 角色 | 场景 |
|---|---|
| 模拟面试官 | 按目标岗位出题、逐题点评，结束生成维度评分报告 |
| 复盘分析师 | 基于面试转写深度复盘，输出亮点、不足与改进建议 |
| 简历顾问 | 解析简历，按目标 JD 逐节优化，输出匹配度分析 |
| 通用助手 | 岗位调研、面经问答、薪资谈判、**面试邮件自动识别并安排日程提醒** |

### 🗂 面试题库

- AI 复盘时自动提取面试官问过的问题，确认后归档，面试前针对性复习

### 📄 简历顾问

- 上传 PDF / Word / TXT 简历，AI 自动提取成结构化字段（教育/工作/项目/技能/求职意向）
- 扫描件自动 OCR 兜底

### 🚀 投递工作台

- **云端共享公司库**：内置 1000+ 秋招公司，找不到的公司可新增（AI 校验信息准确性），数据云端共享给所有使用者
- **投递记录管理**：状态跟踪（待投递 → 已投递 → 面试 → Offer…），进度一目了然
- **OfferSubmit 浏览器扩展**：一键引导安装，投递时自动填充简历，投递记录自动回写

## 快速开始

### 用户安装

从 [Releases](https://github.com/fuhuonvshen/EasyWork-Interview/releases) 下载对应平台的安装包即可。

首次启动：

1. **配置 AI 模型**（设置 → 语言模型）：下载本地模型，或填入在线 API（OpenAI 兼容）
2. **上传简历**（简历顾问）：AI 自动提取字段，作为后续所有问答的上下文
3. 开始使用：录制面试 / 模拟面试 / 投递管理

### 开发者构建

```bash
npm install
npm run tauri dev      # 开发模式（需 Rust 工具链）
npm run tauri build    # 构建安装包
```

> 语音转写模型（Whisper / SenseVoice）与本地 LLM 首次使用时在应用内下载。

## 技术架构

```
┌─────────────────────────────────────────────┐
│  Tauri 2 桌面壳（Rust）                       │
│  ├─ React + TypeScript 前端                  │
│  ├─ 语音链路：环回/麦克风采集 → 降噪 → VAD     │
│  │   → SenseVoice/Whisper 本地转写            │
│  └─ 命令层（投递/简历/纪要/题库/设置）          │
├─────────────────────────────────────────────┤
│  Python sidecar（FastAPI，本地 127.0.0.1）    │
│  └─ Agent 对话引擎：ReAct + 工具调用 + 长期记忆 │
│     （可选接入在线 LLM）                      │
├─────────────────────────────────────────────┤
│  SQLite（easywork.db，WAL 模式）              │
└─────────────────────────────────────────────┘
```

- **桌面壳**：Tauri 2 / Rust
- **前端**：React 18 / TypeScript / Tailwind CSS
- **语音**：whisper.cpp、sherpa-onnx（SenseVoice）、Silero VAD、RNNoise
- **Agent**：Python FastAPI sidecar，ReAct 循环 + 工具系统 + 长期记忆
- **存储**：SQLite（本地）；公司库经飞书多维表格云端共享

## 数据与隐私

- 音频录制与转写默认**本地运行**，不经过任何服务器
- 可选的在线能力：云端大模型（LLM）、在线语音识别、公司库云端共享——均需在设置中显式配置
- 本地模型与数据存放在应用数据目录，卸载即清理

## 反馈

发现 Bug 或有功能建议？欢迎提 [Issue](https://github.com/fuhuonvshen/EasyWork-Interview/issues)。

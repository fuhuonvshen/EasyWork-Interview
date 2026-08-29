// EasyWork - User-facing error messages
// Raw backend errors are logged to console; the UI only shows friendly messages.

export const ERRORS = {
  LIST_DEVICES: "无法获取音频设备列表，请检查麦克风连接",
  START_RECORDING: "启动录制失败，请检查麦克风权限",
  STOP_RECORDING: "停止录制失败",
  GENERATE_MINUTES: "纪要生成失败，请稍后重试",
  LOAD_MODEL: "模型加载失败，请在「模型管理」中检查模型状态",
  DOWNLOAD_MODEL: "模型下载失败，请检查网络连接",
  DELETE_MEETING: "删除失败",
  LOAD_SCHEDULE: "加载日程失败",
  CREATE_SCHEDULE: "创建日程失败",
  UPDATE_SCHEDULE: "更新日程失败",
  DELETE_SCHEDULE: "删除日程失败",
  TOGGLE_PIN: "置顶操作失败",
  DELETE_CONVERSATION: "删除对话失败",
  CREATE_TODO: "创建待办任务失败",
  GENERATE_REPORT: "生成报告失败",
  AGENT_CHAT: "AI 回复失败，请稍后重试",
  UPLOAD_FILE: "文件上传失败",
  LOAD_MINUTES: "加载纪要失败",
  PARSE_MINUTES: "纪要数据解析异常，请重试",
  SAVE_MINUTES: "保存纪要失败，请重试",
  NETWORK: "网络连接异常",
} as const;

/** Wrap a raw error into a user-friendly message. Logs the detail to console. */
export function toUserError(context: string, raw: unknown): string {
  const detail = raw instanceof Error ? raw.message : String(raw);
  console.warn(`[${context}]`, detail);
  return context;
}

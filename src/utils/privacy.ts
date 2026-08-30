// 简历隐私脱敏：姓名只留姓、电话前3后4、邮箱/微信/身份证打码
// 在简历保存到本地前调用，AI 参考时不会包含完整隐私信息。

const NAME_BLOCKLIST = ["简历", "个人", "求职", "我的", "教育", "求职意向"];

export function sanitizePrivacy(text: string): string {
  let s = text;
  // 手机号：1[3-9]xxxxxxxxx → 保留前3位 + 后4位（138****5678）
  s = s.replace(/(1[3-9]\d)(\d{4})(\d{4})/g, "$1****$3");
  // 座机：区号-号码 010-12345678 → 010-****5678
  s = s.replace(/(0\d{2,3}-)(\d{4})(\d{4})/g, "$1****$3");
  // 邮箱：保留首字符 + ***@域名（a***@qq.com）
  s = s.replace(/([A-Za-z0-9_])[A-Za-z0-9_.-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g, "$1***@$2");
  // 身份证：前6后4，中间打码
  s = s.replace(/(\d{6})\d{8}(\d{3}[0-9Xx])/g, "$1********$2");
  // 微信/QQ 号：跟在「微信/QQ」后的账号 → ***
  s = s.replace(/(微信|QQ|qq)[号：:号]?\s*([A-Za-z][A-Za-z0-9_-]{5,19}|\d{5,12})/g, "$1：***");
  // 姓名：显式「姓名：X」格式 → 只留姓
  s = s.replace(/(姓名[：:]\s*)([一-龥]{2,4})/g, (m, p, name: string) => p + name[0] + "**");
  // 姓名兜底：首行恰为 2-4 个中文字且非常见标题 → 视为姓名
  const lines = s.split("\n");
  const first = lines[0]?.trim() ?? "";
  if (/^[一-龥]{2,4}$/.test(first) && !NAME_BLOCKLIST.includes(first)) {
    lines[0] = first[0] + "**";
  }
  return lines.join("\n");
}

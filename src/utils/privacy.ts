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

// 简历结构化字段脱敏：姓名只留姓、电话/邮箱/描述类字段整体走 sanitizePrivacy
export function sanitizeResumeFields(fieldsJson: string): string {
  try {
    const obj = JSON.parse(fieldsJson);
    if (obj && typeof obj === "object") {
      if (typeof obj.name === "string" && obj.name.length > 1) {
        obj.name = obj.name[0] + "**";
      }
      for (const key of ["phone", "email", "gender", "age", "summary"]) {
        if (typeof obj[key] === "string") obj[key] = sanitizePrivacy(obj[key]);
      }
      for (const arrKey of ["education", "work_experience", "projects"]) {
        if (Array.isArray(obj[arrKey])) {
          obj[arrKey] = obj[arrKey].map((item: Record<string, unknown>) => {
            const clean: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(item)) {
              clean[k] = typeof v === "string" ? sanitizePrivacy(v) : v;
            }
            return clean;
          });
        }
      }
      if (Array.isArray(obj.skills)) {
        obj.skills = obj.skills.map((s: unknown) => typeof s === "string" ? sanitizePrivacy(s) : s);
      }
      if (obj.job_intention && typeof obj.job_intention === "object") {
        for (const [k, v] of Object.entries(obj.job_intention)) {
          if (typeof v === "string") obj.job_intention[k] = sanitizePrivacy(v);
        }
      }
      return JSON.stringify(obj, null, 2);
    }
    return sanitizePrivacy(fieldsJson);
  } catch {
    return sanitizePrivacy(fieldsJson);
  }
}

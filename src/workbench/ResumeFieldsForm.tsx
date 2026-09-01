// EasyWork - 简历结构化字段表单（BOSS 直聘风格：分节卡片，可编辑增删）
import { Plus, Trash2, RefreshCw, Loader } from "lucide-react";
import type { ResumeFields } from "../types";

interface Props {
  fields: ResumeFields;
  onChange: (f: ResumeFields) => void;
  onReExtract: () => void;
  extracting: boolean;
}

const inputCls =
  "w-full px-3 py-2 text-xs text-gray-700 bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-300 placeholder-gray-300";

function Field({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="block text-[10px] font-medium text-gray-400 mb-1">{label}</span>
      <input className={inputCls} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function TextAreaField({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="block text-[10px] font-medium text-gray-400 mb-1">{label}</span>
      <textarea
        className={`${inputCls} resize-y leading-relaxed`}
        rows={3}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function SectionCard({ title, onAdd, addLabel, children }: {
  title: string; onAdd?: () => void; addLabel?: string; children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-xs font-bold text-gray-800">{title}</h4>
        {onAdd && (
          <button onClick={onAdd} className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-medium text-amber-700 bg-amber-50 rounded-lg hover:bg-amber-100 transition-colors">
            <Plus size={11} /> {addLabel || "添加"}
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

const emptyItem = {
  school: "", major: "", degree: "", start_time: "", end_time: "",
  company: "", position: "", description: "",
  name: "", role: "",
} as Record<string, string>;

export default function ResumeFieldsForm({ fields, onChange, onReExtract, extracting }: Props) {
  const set = (patch: Partial<ResumeFields>) => onChange({ ...fields, ...patch });

  const setListItem = (key: "education" | "work_experience" | "projects", idx: number, field: string, v: string) => {
    const list = [...fields[key]];
    list[idx] = { ...(list[idx] as unknown as Record<string, string>), [field]: v } as never;
    set({ [key]: list } as Partial<ResumeFields>);
  };

  const addListItem = (key: "education" | "work_experience" | "projects") => {
    set({ [key]: [...fields[key], { ...emptyItem }] } as Partial<ResumeFields>);
  };

  const removeListItem = (key: "education" | "work_experience" | "projects", idx: number) => {
    set({ [key]: fields[key].filter((_, i) => i !== idx) } as Partial<ResumeFields>);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-gray-400">已自动提取字段，可直接修改后保存</p>
        <button
          onClick={onReExtract}
          disabled={extracting}
          className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-medium text-gray-500 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-50 transition-colors"
        >
          {extracting ? <Loader size={11} className="animate-spin" /> : <RefreshCw size={11} />}
          重新提取
        </button>
      </div>

      {/* 基本信息 */}
      <SectionCard title="基本信息">
        <div className="grid grid-cols-2 gap-3">
          <Field label="姓名" value={fields.name} onChange={(v) => set({ name: v })} />
          <Field label="性别" value={fields.gender} onChange={(v) => set({ gender: v })} />
          <Field label="电话" value={fields.phone} onChange={(v) => set({ phone: v })} />
          <Field label="年龄" value={fields.age} onChange={(v) => set({ age: v })} />
          <div className="col-span-2">
            <Field label="邮箱" value={fields.email} onChange={(v) => set({ email: v })} />
          </div>
        </div>
      </SectionCard>

      {/* 教育经历 */}
      <SectionCard title="教育经历" onAdd={() => addListItem("education")} addLabel="添加教育">
        {fields.education.length === 0 && <p className="text-[11px] text-gray-300 py-1">暂无</p>}
        {fields.education.map((item, i) => (
          <div key={i} className="relative mb-3 last:mb-0 p-3 rounded-xl bg-gray-50/70 border border-gray-100">
            <button
              onClick={() => removeListItem("education", i)}
              className="absolute top-2 right-2 p-1 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors"
              aria-label="删除该条教育经历"
            >
              <Trash2 size={12} />
            </button>
            <div className="grid grid-cols-2 gap-2 pr-8">
              <Field label="学校" value={item.school} onChange={(v) => setListItem("education", i, "school", v)} />
              <Field label="专业" value={item.major} onChange={(v) => setListItem("education", i, "major", v)} />
              <Field label="学历" value={item.degree} onChange={(v) => setListItem("education", i, "degree", v)} />
              <div className="grid grid-cols-2 gap-2">
                <Field label="开始" value={item.start_time} onChange={(v) => setListItem("education", i, "start_time", v)} />
                <Field label="结束" value={item.end_time} onChange={(v) => setListItem("education", i, "end_time", v)} />
              </div>
            </div>
          </div>
        ))}
      </SectionCard>

      {/* 工作经历 */}
      <SectionCard title="工作经历" onAdd={() => addListItem("work_experience")} addLabel="添加工作">
        {fields.work_experience.length === 0 && <p className="text-[11px] text-gray-300 py-1">暂无</p>}
        {fields.work_experience.map((item, i) => (
          <div key={i} className="relative mb-3 last:mb-0 p-3 rounded-xl bg-gray-50/70 border border-gray-100">
            <button
              onClick={() => removeListItem("work_experience", i)}
              className="absolute top-2 right-2 p-1 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors"
              aria-label="删除该条工作经历"
            >
              <Trash2 size={12} />
            </button>
            <div className="grid grid-cols-2 gap-2 pr-8">
              <Field label="公司" value={item.company} onChange={(v) => setListItem("work_experience", i, "company", v)} />
              <Field label="职位" value={item.position} onChange={(v) => setListItem("work_experience", i, "position", v)} />
              <Field label="开始" value={item.start_time} onChange={(v) => setListItem("work_experience", i, "start_time", v)} />
              <Field label="结束" value={item.end_time} onChange={(v) => setListItem("work_experience", i, "end_time", v)} />
            </div>
            <div className="mt-2">
              <TextAreaField label="职责描述" value={item.description} onChange={(v) => setListItem("work_experience", i, "description", v)} />
            </div>
          </div>
        ))}
      </SectionCard>

      {/* 项目经历 */}
      <SectionCard title="项目经历" onAdd={() => addListItem("projects")} addLabel="添加项目">
        {fields.projects.length === 0 && <p className="text-[11px] text-gray-300 py-1">暂无</p>}
        {fields.projects.map((item, i) => (
          <div key={i} className="relative mb-3 last:mb-0 p-3 rounded-xl bg-gray-50/70 border border-gray-100">
            <button
              onClick={() => removeListItem("projects", i)}
              className="absolute top-2 right-2 p-1 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors"
              aria-label="删除该项目经历"
            >
              <Trash2 size={12} />
            </button>
            <div className="grid grid-cols-2 gap-2 pr-8">
              <Field label="项目名称" value={item.name} onChange={(v) => setListItem("projects", i, "name", v)} />
              <Field label="担任角色" value={item.role} onChange={(v) => setListItem("projects", i, "role", v)} />
              <Field label="开始" value={item.start_time} onChange={(v) => setListItem("projects", i, "start_time", v)} />
              <Field label="结束" value={item.end_time} onChange={(v) => setListItem("projects", i, "end_time", v)} />
            </div>
            <div className="mt-2">
              <TextAreaField label="项目描述" value={item.description} onChange={(v) => setListItem("projects", i, "description", v)} />
            </div>
          </div>
        ))}
      </SectionCard>

      {/* 技能 */}
      <SectionCard title="技能">
        <textarea
          className={`${inputCls} resize-y leading-relaxed`}
          rows={3}
          value={fields.skills.join("\n")}
          placeholder={"每行一个技能，如：\nReact\nTypeScript"}
          onChange={(e) =>
            set({ skills: e.target.value.split(/[\n,，、;；]/).map((s) => s.trim()).filter(Boolean) })
          }
        />
      </SectionCard>

      {/* 求职意向 */}
      <SectionCard title="求职意向">
        <div className="grid grid-cols-3 gap-3">
          <Field label="期望岗位" value={fields.job_intention.position} onChange={(v) => set({ job_intention: { ...fields.job_intention, position: v } })} />
          <Field label="期望薪资" value={fields.job_intention.salary_expectation} onChange={(v) => set({ job_intention: { ...fields.job_intention, salary_expectation: v } })} />
          <Field label="期望城市" value={fields.job_intention.location} onChange={(v) => set({ job_intention: { ...fields.job_intention, location: v } })} />
        </div>
      </SectionCard>

      {/* 自我评价 */}
      <SectionCard title="自我评价">
        <textarea
          className={`${inputCls} resize-y`}
          rows={3}
          value={fields.summary}
          placeholder="个人总结 / 自我评价"
          onChange={(e) => set({ summary: e.target.value })}
        />
      </SectionCard>
    </div>
  );
}

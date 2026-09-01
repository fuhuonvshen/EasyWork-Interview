"""把 EasyWork 简历字段（resumes.fields JSON）转换为 OfferSubmit 扩展的填充模板。

组件集以简历顾问的字段为准：简历顾问有哪些字段，模板就有哪些组件。
系统字段（姓名/性别/手机/邮箱/教育/工作/项目/技能/自我评价）映射为扩展
系统组件；其余字段（年龄、期望岗位、期望薪资、期望城市）映射为自定义组件，
同步时把组件定义（label + keywords）一并交给扩展，扩展可即时用于填充匹配。
时间不做解析转换（AI 提取已按原文保留，扩展只负责拼接展示）。
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone

# OfferSubmit 组件默认 label（与扩展 src/shared/sections.ts FIELD_LABELS 对齐）
FIELD_LABELS = {
    "name": "姓名",
    "gender": "性别",
    "phone": "手机号",
    "email": "邮箱",
    "workExperience": "工作经历",
    "projectExperience": "项目经历",
    "educationExperience": "教育经历",
    "skills": "技能",
    "selfEvaluation": "自我评价",
}

# 全局固定顺序（与扩展 FIELD_ORDER 对齐），模板 sections 按此排序
FIELD_ORDER = [
    "name", "gender", "phone", "email", "age",
    "workExperience", "projectExperience", "educationExperience",
    "skills", "selfEvaluation",
    "expectedPosition", "expectedSalary", "expectedLocation",
]

TPL_ID = "tpl_easywork"
TPL_NAME = "EasyWork 简历"

# 简历顾问独有字段 → 自定义组件定义（id 稳定，keywords 供填充匹配）
CUSTOM_FIELDS = [
    {"id": "ew_age", "label": "年龄", "keywords": ["年龄", "age", "周岁"]},
    {"id": "ew_expected_position", "label": "期望岗位", "keywords": ["期望岗位", "应聘岗位", "求职岗位", "position"]},
    {"id": "ew_expected_salary", "label": "期望薪资", "keywords": ["期望薪资", "期望薪酬", "薪资要求", "salary"]},
    {"id": "ew_expected_location", "label": "期望城市", "keywords": ["期望城市", "意向城市", "工作城市", "工作地点", "location"]},
]


def _text_section(stype: str, value: str, label: str | None = None) -> dict | None:
    if not value or not value.strip():
        return None
    return {
        "id": f"sec_{stype}",
        "type": stype,
        "label": label or FIELD_LABELS.get(stype, stype),
        "data": {"kind": "text", "value": value.strip()},
    }


def _custom_section(def_id: str, label: str, value: str) -> dict | None:
    return _text_section(def_id, value, label)


def _gender_value(raw: str) -> str:
    r = (raw or "").strip().lower()
    if r in ("男", "male", "m"):
        return "male"
    if r in ("女", "female", "f"):
        return "female"
    return ""


def _map_gender(raw: str) -> dict | None:
    v = _gender_value(raw)
    if not v:
        return None
    return {
        "id": "sec_gender",
        "type": "gender",
        "label": FIELD_LABELS["gender"],
        "data": {"kind": "gender", "value": v},
    }


def _map_educations(items: list | None) -> dict | None:
    if not items:
        return None
    out = []
    for it in items:
        if not isinstance(it, dict):
            continue
        school = (it.get("school") or "").strip()
        major = (it.get("major") or "").strip()
        degree = (it.get("degree") or "").strip()
        if not (school or major or degree):
            continue
        out.append({
            "id": uuid.uuid4().hex,
            "school": school,
            "major": major,
            "degree": degree,
            "startDate": (it.get("start_time") or "").strip(),
            "endDate": (it.get("end_time") or "").strip(),
            "description": "",
        })
    if not out:
        return None
    return {
        "id": "sec_educationExperience",
        "type": "educationExperience",
        "label": FIELD_LABELS["educationExperience"],
        "data": {"kind": "educations", "items": out},
    }


def _map_works(items: list | None) -> dict | None:
    if not items:
        return None
    out = []
    for it in items:
        if not isinstance(it, dict):
            continue
        company = (it.get("company") or "").strip()
        position = (it.get("position") or "").strip()
        if not (company or position):
            continue
        out.append({
            "id": uuid.uuid4().hex,
            "company": company,
            "position": position,
            "startDate": (it.get("start_time") or "").strip(),
            "endDate": (it.get("end_time") or "").strip(),
            "description": (it.get("description") or "").strip(),
        })
    if not out:
        return None
    return {
        "id": "sec_workExperience",
        "type": "workExperience",
        "label": FIELD_LABELS["workExperience"],
        "data": {"kind": "works", "items": out},
    }


def _map_projects(items: list | None) -> dict | None:
    if not items:
        return None
    out = []
    for it in items:
        if not isinstance(it, dict):
            continue
        name = (it.get("name") or "").strip()
        if not name:
            continue
        out.append({
            "id": uuid.uuid4().hex,
            "name": name,
            "role": (it.get("role") or "").strip(),
            "startDate": (it.get("start_time") or "").strip(),
            "endDate": (it.get("end_time") or "").strip(),
            "link": "",
            "description": (it.get("description") or "").strip(),
        })
    if not out:
        return None
    return {
        "id": "sec_projectExperience",
        "type": "projectExperience",
        "label": FIELD_LABELS["projectExperience"],
        "data": {"kind": "projects", "items": out},
    }


def _map_skills(skills: list | None) -> dict | None:
    if not skills:
        return None
    items = [s.strip() for s in skills if isinstance(s, str) and s.strip()]
    if not items:
        return None
    return {
        "id": "sec_skills",
        "type": "skills",
        "label": FIELD_LABELS["skills"],
        "data": {"kind": "lines", "items": items},
    }


def _custom_def(def_id: str) -> dict:
    for d in CUSTOM_FIELDS:
        if d["id"] == def_id:
            return d
    raise KeyError(def_id)


def build_template_from_fields(fields: dict) -> tuple[dict | None, list[dict]]:
    """fields（resumes.fields 解析出的 dict）→ (ResumeTemplate | None, 自定义组件定义)。

    只包含有非空数据的组件，顺序按 FIELD_ORDER（简历顾问字段全量保留）。
    """
    builders = {
        "name": lambda: _text_section("name", fields.get("name") or ""),
        "gender": lambda: _map_gender(fields.get("gender") or ""),
        "phone": lambda: _text_section("phone", fields.get("phone") or ""),
        "email": lambda: _text_section("email", fields.get("email") or ""),
        "age": lambda: _custom_section("ew_age", "年龄", fields.get("age") or ""),
        "workExperience": lambda: _map_works(fields.get("work_experience")),
        "projectExperience": lambda: _map_projects(fields.get("projects")),
        "educationExperience": lambda: _map_educations(fields.get("education")),
        "skills": lambda: _map_skills(fields.get("skills")),
        "selfEvaluation": lambda: _text_section("selfEvaluation", fields.get("summary") or ""),
        "expectedPosition": lambda: _custom_section(
            "ew_expected_position", "期望岗位", (fields.get("job_intention") or {}).get("position") or ""),
        "expectedSalary": lambda: _custom_section(
            "ew_expected_salary", "期望薪资", (fields.get("job_intention") or {}).get("salary_expectation") or ""),
        "expectedLocation": lambda: _custom_section(
            "ew_expected_location", "期望城市", (fields.get("job_intention") or {}).get("location") or ""),
    }
    sections = []
    used_custom = set()
    for stype in FIELD_ORDER:
        sec = builders[stype]()
        if sec:
            sections.append(sec)
            if sec["type"] in ("ew_age", "ew_expected_position", "ew_expected_salary", "ew_expected_location"):
                used_custom.add(sec["type"])
    if not sections:
        return None, []

    now = int(datetime.now(timezone.utc).timestamp() * 1000)
    template = {
        "id": TPL_ID,
        "name": TPL_NAME,
        "sections": sections,
        "createdAt": now,
        "updatedAt": now,
    }
    custom_defs = [d for d in CUSTOM_FIELDS if d["id"] in used_custom]
    return template, custom_defs


def parse_fields_json(raw: str | None) -> dict | None:
    if not raw:
        return None
    try:
        v = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return None
    return v if isinstance(v, dict) else None

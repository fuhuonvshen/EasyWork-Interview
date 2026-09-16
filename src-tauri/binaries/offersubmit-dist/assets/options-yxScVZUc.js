import{g as q,s as V,a as He,e as Pe,m as we,b as Re,u as _e,d as Fe,c as Ge,f as W,h as ie,i as Ke}from"./storage-BgeifeEi.js";const z="其他/自定义",C=[{name:"基本信息",types:["name","gender","birthDate","phone","email","wechat","age","location","hometown"]},{name:"身份户籍",types:["idType","idCard","nationality","citizenship","countryCode","hukou","political","marital"]},{name:"教育背景",types:["education","school","major","degree","graduationYear","academicCategory","educationExperience"]},{name:"求职意向",types:["jobIntention","expectedSalary","workLocation"]},{name:"工作与实习",types:["workExperience","workYears"]},{name:"项目经历",types:["projectExperience"]},{name:"获奖·论文·专利",types:["awards","papers","patents"]},{name:"语言与技能",types:["languages","computerSkills","skills","selfEvaluation"]},{name:z,types:["channel"]}],Ue=Object.fromEntries(C.flatMap(e=>e.types.map(t=>[t,e.name])));function Ve(e){return Ue[e]??z}const We=[{name:"基本信息",types:["name","gender","birthDate","phone","email","wechat","location","hometown","workYears","education","degree","school","major","graduationYear","workLocation","jobIntention","expectedSalary"]},{name:"身份与户籍",types:["age","idCard","idType","nationality","citizenship","countryCode","hukou","political","marital"]},{name:"学业补充",types:["academicCategory","channel"]},{name:"经历与成果",types:["workExperience","projectExperience","educationExperience","awards","papers","patents"]},{name:"语言与技能",types:["languages","computerSkills","skills","selfEvaluation"]}],se=We.flatMap(e=>e.types),$e={name:"姓名",gender:"性别",birthDate:"出生日期",phone:"手机号",email:"邮箱",wechat:"微信",location:"现居城市",hometown:"籍贯",workYears:"工作年限",education:"学历",school:"毕业院校",major:"专业",graduationYear:"毕业年份",jobIntention:"求职意向",expectedSalary:"期望薪资",workExperience:"工作经历",projectExperience:"项目经历",educationExperience:"教育经历",skills:"技能",selfEvaluation:"自我评价",age:"年龄",idCard:"证件号码",nationality:"民族",citizenship:"国籍/地区",countryCode:"国别码",hukou:"户口所在地",idType:"证件类型",political:"政治面貌",marital:"婚姻状况",workLocation:"期望工作地",degree:"学位",academicCategory:"一级学科分类",channel:"应聘渠道来源",languages:"语言能力",computerSkills:"计算机能力",awards:"获奖经历",papers:"论文著作",patents:"个人专利"};function ze(e){switch(e){case"gender":return{kind:"gender",value:""};case"workExperience":return{kind:"works",items:[]};case"projectExperience":return{kind:"projects",items:[]};case"educationExperience":return{kind:"educations",items:[]};case"awards":return{kind:"awards",items:[]};case"papers":return{kind:"papers",items:[]};case"patents":return{kind:"patents",items:[]};case"languages":return{kind:"languages",items:[]};case"computerSkills":return{kind:"computerSkills",items:[]};case"skills":return{kind:"lines",items:[]};default:return{kind:"text",value:""}}}function ke(e){return{id:`sec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`,type:e,label:$e[e]??e,data:ze(e)}}function Je(e,t){const a=se.indexOf(t);if(a<0)return e.length;for(let n=0;n<e.length;n++)if(se.indexOf(e[n].type)>a)return n;return e.length}function L(e="id"){return`${e}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,10)}`}function f(e){return e.replace(/[&<>"']/g,t=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[t])}function Qe(e,t,a){const n=()=>{e.removeEventListener("blur",n),e.removeEventListener("keydown",o),t(e.value)},o=s=>{s.key==="Enter"?e.blur():s.key==="Escape"&&(e.removeEventListener("blur",n),e.removeEventListener("keydown",o),a==null||a())};e.addEventListener("blur",n),e.addEventListener("keydown",o),e.focus(),e.select()}function Se(e){e.style.height="auto",e.style.height=`${e.scrollHeight}px`}function Ee(e){return new Promise(t=>{const a=document.createElement("div");a.className="os-modal-mask",a.innerHTML=`
      <div class="os-modal" role="dialog" aria-modal="true">
        <div class="os-modal-head">
          <h3>${e?`编辑「${f(e.label)}」`:"新建自定义组件"}</h3>
          <button type="button" class="os-btn ghost sm icon" data-x title="关闭">✕</button>
        </div>
        <div class="os-modal-body">
          <p class="form-tip">自定义组件用于模板里没有的字段（如「到岗时间」），填充时按<b>关键词</b>匹配页面控件。</p>
          <label class="ai-label">组件名
            <input class="os-input" id="cm-label" placeholder="如：到岗时间" value="${f((e==null?void 0:e.label)??"")}" />
          </label>
          <label class="ai-label">匹配关键词（逗号分隔，中英文均可）
            <input class="os-input" id="cm-keywords" placeholder="到岗时间,arrival,可入职时间" value="${f(((e==null?void 0:e.keywords)??[]).join(","))}" spellcheck="false" />
          </label>
          <p id="cm-error" class="os-error" style="display:none"></p>
        </div>
        <div class="os-modal-foot">
          <button type="button" class="os-btn" data-cancel>取消</button>
          <button type="button" class="os-btn primary" data-ok>保存</button>
        </div>
      </div>`,document.body.appendChild(a);const n=s=>{a.remove(),t(s)},o=()=>{const s=a.querySelector("#cm-label"),c=a.querySelector("#cm-error"),u=s.value.trim();if(!u){c.style.display="",c.textContent="请输入组件名",s.focus();return}const p=a.querySelector("#cm-keywords").value.split(/[,，;；]/).map(y=>y.trim()).filter(Boolean);if(p.length===0){c.style.display="",c.textContent="至少填一个匹配关键词";return}n({label:u,keywords:p})};a.addEventListener("click",s=>{const c=s.target;c===a||c.closest("[data-x]")||c.closest("[data-cancel]")?n(null):c.closest("[data-ok]")&&o()}),a.addEventListener("keydown",s=>{s.key==="Escape"&&n(null)}),a.querySelector("#cm-label").focus()})}const Xe=["works","projects","educations","awards","papers","patents","languages","computerSkills"];function H(e){return Xe.includes(e.kind)}const Ze={works:[{key:"company",label:"公司名称"},{key:"position",label:"职位"},{key:"startDate",label:"开始时间",ph:"YYYY-MM"},{key:"endDate",label:"结束时间",ph:"YYYY-MM / 至今"},{key:"description",label:"工作内容 / 业绩",multi:!0,wide:!0}],projects:[{key:"name",label:"项目名称"},{key:"role",label:"担任角色"},{key:"startDate",label:"开始时间",ph:"YYYY-MM"},{key:"endDate",label:"结束时间",ph:"YYYY-MM"},{key:"link",label:"项目链接",ph:"可选"},{key:"description",label:"项目描述 / 你的贡献",multi:!0,wide:!0}],educations:[{key:"school",label:"学校名称"},{key:"major",label:"专业"},{key:"degree",label:"学历",ph:"本科 / 硕士 / 博士"},{key:"academy",label:"学院 / 院系",ph:"可选"},{key:"startDate",label:"开始时间",ph:"YYYY-MM"},{key:"endDate",label:"结束时间",ph:"YYYY-MM / 至今"},{key:"rank",label:"成绩排名",ph:"如：前 10%，可选"},{key:"supervisor",label:"导师",ph:"可选"},{key:"description",label:"在校经历 / 主修课程",multi:!0,wide:!0}],awards:[{key:"name",label:"获奖名称",ph:"如：全国大学生数学建模竞赛一等奖"},{key:"type",label:"获奖级别",ph:"如：国家级"},{key:"date",label:"获奖时间",ph:"YYYY-MM"}],papers:[{key:"name",label:"论文名称"},{key:"journal",label:"发表期刊",ph:"可选"},{key:"detail",label:"论文详情 / 摘要",multi:!0,wide:!0},{key:"url",label:"论文地址",ph:"可选"}],patents:[{key:"name",label:"专利名称"},{key:"no",label:"专利编号"},{key:"date",label:"发布时间",ph:"YYYY-MM"}],languages:[{key:"lang",label:"语种",ph:"如：英语"},{key:"cert",label:"证书 / 等级",ph:"如：CET-6"}],computerSkills:[{key:"lang",label:"技术 / 编程语言",ph:"如：Python"},{key:"level",label:"掌握程度",ph:"如：熟练"}]};function et(e){return Ze[e]}const tt={works:"company",projects:"name",educations:"school",awards:"name",papers:"name",patents:"name",languages:"lang",computerSkills:"lang"};function at(e,t){const a=tt[t],o=(a?String(e[a]??""):"").trim();return o?o.length>14?`${o.slice(0,14)}…`:o:"未命名条目"}function nt(e){return Object.entries(e).some(([t,a])=>t!=="id"&&String(a??"").trim()!=="")}function st(e){switch(e){case"works":return{id:L("w"),company:"",position:"",startDate:"",endDate:"",description:""};case"projects":return{id:L("p"),name:"",role:"",startDate:"",endDate:"",link:"",description:""};case"educations":return{id:L("e"),school:"",major:"",degree:"",academy:"",rank:"",supervisor:"",startDate:"",endDate:"",description:""};case"awards":return{id:L("a"),name:"",type:"",date:""};case"papers":return{id:L("pa"),name:"",detail:"",journal:"",url:""};case"patents":return{id:L("pt"),no:"",name:"",date:""};case"languages":return{id:L("l"),lang:"",cert:""};case"computerSkills":return{id:L("c"),lang:"",level:""}}}function oe(e){return{text:"文本字段",gender:"单选",lines:"多行文本",educations:"教育经历",works:"工作经历",projects:"项目经历",awards:"获奖经历",papers:"论文著作",patents:"个人专利",languages:"语言能力",computerSkills:"计算机能力"}[e]??e}const ot=[["","未选择"],["male","男"],["female","女"]];function Te(e,t){var n;if(!e)return[];const a=(n=C[t])==null?void 0:n.name;return a?e.sections.filter(o=>Ve(o.type)===a):[]}function it(e){if(!e||e.sections.length===0)return`<div class="os-empty">
      <div class="os-empty-icon">OS</div>
      <h4>模板还没有字段</h4>
      <p>点左侧分组下的「＋ 添加字段」加入组件（自动按网申顺序归位），
         或点工具栏「一键完整模板」生成全套字段再按需删减。</p>
    </div>`;let t=0;return C.map((a,n)=>{const o=Te(e,n);return o.length===0?"":(t+=1,`
    <section class="flow-group" data-flow-group="${n}">
      <div class="flow-group-head">
        <div class="fg-title"><span class="fg-no">${t}</span><h2>${f(a.name)}</h2></div>
        <p class="fg-sub">共 ${o.length} 个字段 · 对应网申「${f(a.name)}」模块</p>
      </div>
      <div class="os-card flow-card">${o.map(s=>lt(s)).join("")}</div>
    </section>`)}).join("")}function X(e){const t=f(e.id);return`<span class="f-name" title="${f(oe(e.data.kind))}">${f(e.label)}</span>
    <span class="f-acts">
      <button type="button" class="os-btn ghost sm icon" data-rename="${t}" title="重命名显示名">✎</button>
      <button type="button" class="os-btn danger-ghost sm icon" data-sec-remove="${t}" title="从模板移除该字段">✕</button>
    </span>`}function lt(e){const t=e.data,a=f(e.id);return t.kind==="gender"?`
    <div class="field-row" id="sec-${a}" data-sec-id="${a}">
      <div class="f-label">${X(e)}</div>
      <div class="f-control">
        <select class="os-select" data-sec-gender="${a}">
          ${ot.map(([n,o])=>`<option value="${n}" ${t.value===n?"selected":""}>${o}</option>`).join("")}
        </select>
      </div>
    </div>`:t.kind==="text"?`
    <div class="field-row" id="sec-${a}" data-sec-id="${a}">
      <div class="f-label">${X(e)}</div>
      <div class="f-control">
        <input type="text" class="os-input" data-sec-value="${a}" value="${f(t.value)}" placeholder="填写内容" />
      </div>
    </div>`:t.kind==="lines"?`
    <div class="field-row span" id="sec-${a}" data-sec-id="${a}">
      <div class="f-label">${X(e)}</div>
      <div class="f-control">
        <textarea class="os-input os-textarea os-auto" rows="5" data-sec-lines="${a}" placeholder="每行一个，如：TypeScript&#10;Vite">${f(t.items.join(`
`))}</textarea>
      </div>
    </div>`:H(t)?ct(e,t.kind):""}function ct(e,t){const a=e.data;if(!H(a))return"";const n=et(t),o=a.items,s=f(e.id),c=`
    <div class="composite-head" data-sec-id="${s}">
      <span class="sec-title">${f(e.label)}</span>
      <span class="sec-sub" title="${f(oe(e.data.kind))}">${f(oe(e.data.kind))}</span>
      <span class="os-badge accent">${o.length} 条</span>
      <span class="spacer"></span>
      <button type="button" class="os-btn sm" data-add-item="${s}">＋ 添加一条</button>
      <button type="button" class="os-btn danger-ghost sm icon" data-sec-remove="${s}" title="从模板移除该字段">✕</button>
    </div>`,u=o.map((y,b)=>{const B=y,m=n.map(v=>{const O=B[v.key]??"",_=v.multi||v.wide?"f-cell wide":"f-cell",K=v.ph?` placeholder="${f(v.ph)}"`:"",Y=v.multi?`<textarea class="os-input os-textarea os-auto" rows="3" data-item-field data-item-sec="${s}" data-item-idx="${b}" data-item-key="${f(v.key)}"${K}>${f(O)}</textarea>`:`<input type="text" class="os-input" data-item-field data-item-sec="${s}" data-item-idx="${b}" data-item-key="${f(v.key)}" value="${f(O)}"${K} />`;return`<div class="${_}"><span class="f-label">${f(v.label)}</span>${Y}</div>`}).join("");return`<div class="item-card" data-sec-id="${s}">
        <div class="item-card-head">
          <span class="item-no">#${b+1}</span>
          <span class="item-title">${f(at(y,t))}</span>
          <span class="spacer"></span>
          <button type="button" class="os-btn ghost sm icon" data-item-up="${s}:${b}" ${b===0?"disabled":""} title="上移">↑</button>
          <button type="button" class="os-btn ghost sm icon" data-item-down="${s}:${b}" ${b===o.length-1?"disabled":""} title="下移">↓</button>
          <button type="button" class="os-btn danger-ghost sm icon" data-item-del="${s}:${b}" title="删除该条">✕</button>
        </div>
        <div class="item-grid">${m}</div>
      </div>`}).join(""),p=o.length===0?'<div class="item-empty">还没有条目，点「＋ 添加一条」开始录入</div>':"";return`<div class="composite-block" id="sec-${s}" data-sec-id="${s}">
    ${c}${p}
    <div class="composite-items">${u}</div>
  </div>`}function Z(e,t){const[a,n]=(e??":").split(":");return[(t==null?void 0:t.sections.find(o=>o.id===a))??null,Number(n)]}function rt(e,t){const a=n=>{var c,u;const o=((c=n.closest("[data-sec-id]"))==null?void 0:c.dataset.secId)??n.dataset.itemSec??"",s=((u=t.active())==null?void 0:u.sections.find(p=>p.id===o))??null;if(n.hasAttribute("data-item-field")&&s&&H(s.data)){const y=s.data.items[Number(n.dataset.itemIdx)];y&&(y[n.dataset.itemKey??""]=n.value),t.markDirty(),t.saveNow(),t.refreshSectionBadge(s.id)}else s&&n.hasAttribute("data-sec-value")||s&&n.hasAttribute("data-sec-gender")?(s.data.value=n.value,t.markDirty(),t.saveNow(),t.refreshSectionBadge(s.id)):s&&n.hasAttribute("data-sec-lines")&&(s.data.items=n.value.split(`
`).map(p=>p.trim()).filter(Boolean),t.markDirty(),t.saveNow(),t.refreshSectionBadge(s.id))};e.addEventListener("input",n=>{const o=n.target;o instanceof HTMLTextAreaElement&&Se(o),!(!(o instanceof HTMLInputElement)&&!(o instanceof HTMLTextAreaElement)&&!(o instanceof HTMLSelectElement))&&a(o)}),e.addEventListener("change",n=>{const o=n.target;o instanceof HTMLSelectElement&&o.hasAttribute("data-sec-gender")&&a(o)}),e.addEventListener("click",n=>{const o=n.target,s=o.closest("[data-rename]");if(s){t.beginRename(s.dataset.rename??"");return}const c=t.active(),u=o.closest("[data-sec-remove]");if(u){t.removeSection(u.dataset.secRemove??"");return}const p=o.closest("[data-add-item]");if(p){t.addItem(p.dataset.addItem??"");return}const y=o.closest("[data-item-del]");if(y){const[m,v]=Z(y.dataset.itemDel,c);m&&t.removeItem(m.id,v);return}const b=o.closest("[data-item-up]");if(b){const[m,v]=Z(b.dataset.itemUp,c);m&&t.moveItem(m.id,v,-1);return}const B=o.closest("[data-item-down]");if(B){const[m,v]=Z(B.dataset.itemDown,c);m&&t.moveItem(m.id,v,1);return}})}function dt(e){e.querySelectorAll("textarea.os-auto").forEach(t=>Se(t))}function ut(e,t){const a=e.querySelector(`[data-sec-id="${CSS.escape(t)}"] .f-name, [data-sec-id="${CSS.escape(t)}"] .sec-title`);if(!a)return null;const n=document.createElement("input");return n.type="text",n.className="os-input rename-input",n.value=a.textContent??"",n.dataset.renameCommit=t,a.replaceWith(n),n}function pt(e,t){const a=e.querySelector(`[data-sec-id="${CSS.escape(t)}"].composite-block`),n=a==null?void 0:a.querySelector(".item-card:last-of-type input.os-input, .item-card:last-of-type textarea.os-input");n==null||n.focus()}function le(e){const t=e.data;return t.kind==="text"?t.value.trim()!=="":t.kind==="gender"?t.value!=="":t.kind==="lines"?t.items.length>0:H(t)?t.items.some(a=>nt(a)):!1}function mt(e,t,a){var s,c;const n=new Set(((t==null?void 0:t.sections)??[]).map(u=>u.type)),o=[];for(const u of((s=C[e])==null?void 0:s.types)??[])n.has(u)||o.push({type:u,label:$e[u]??u});if(((c=C[e])==null?void 0:c.name)===z)for(const u of a)n.has(u.id)||o.push({type:u.id,label:u.label});return o}function ft(e){const t=e.tpl(),a=e.customFields(),n=s=>{var u,p;return(((u=C[s])==null?void 0:u.types.length)??0)+(((p=C[s])==null?void 0:p.name)===z?a.length:0)},o=s=>s.map(c=>{const p=a.some(y=>y.id===c.type)?`<span class="dir-acts">
              <button type="button" class="os-btn ghost sm icon" data-custom-edit="${f(c.type)}" title="编辑组件定义">✎</button>
              <button type="button" class="os-btn danger-ghost sm icon" data-custom-del="${f(c.type)}" title="删除组件定义（模板内保留）">✕</button>
            </span>`:"";return`<button type="button" class="dir-row" data-goto-sec="${f(c.id)}">
          <span class="os-dot ${le(c)?"filled":""}"></span>
          <span class="dir-row-label">${f(c.label)}</span>${p}
        </button>`}).join("");return`<div class="dir-list">
    ${C.map((s,c)=>{const u=Te(t,c),p=mt(c,t,a),y=e.chipsOpen.has(c),b=y?`<div class="dir-chips">
            ${p.length?p.map(m=>`<button type="button" class="os-chip" data-add-type="${f(m.type)}">＋ ${f(m.label)}</button>`).join(""):'<span class="dir-chips-empty">该组字段已全部加入模板</span>'}
          </div>`:"";return`<div class="dir-group${e.activeGroup()===c?" active":""}" data-dir-group="${c}">
        <button type="button" class="dir-head" data-goto-group="${c}">
          <span class="dir-name">${f(s.name)}</span>
          <span class="os-badge muted dir-count">${u.length}/${n(c)}</span>
        </button>
        ${u.length?`<div class="dir-rows">${o(u)}</div>`:'<div class="dir-hint">未启用</div>'}
        <div class="dir-add">
          ${y?"":`<button type="button" class="dir-add-btn" data-add-toggle="${c}">＋ 添加字段</button>`}
          ${b}
        </div>
      </div>`}).join("")}
  </div>`}function yt(e,t){e.addEventListener("click",a=>{const n=a.target,o=n.closest("[data-custom-edit]");if(o){a.stopPropagation(),t.onCustomEdit(o.dataset.customEdit??"");return}const s=n.closest("[data-custom-del]");if(s){a.stopPropagation(),t.onCustomDel(s.dataset.customDel??"");return}const c=n.closest("[data-add-type]");if(c){t.onAddType(c.dataset.addType??"");return}const u=n.closest("[data-add-toggle]");if(u){t.onToggleAdd(Number(u.dataset.addToggle));return}const p=n.closest("[data-goto-group]");if(p){t.onGotoGroup(Number(p.dataset.gotoGroup));return}const y=n.closest("[data-goto-sec]");if(y){t.onGotoSection(y.dataset.gotoSec??"");return}})}function ht(e){e.innerHTML=`
    <div class="page-head">
      <div class="page-title"><h1>AI 智能填充</h1><p>规则/语义匹配不到的字段，交给大模型判定（可选项，需自备 OpenAI 兼容 API）。</p></div>
    </div>
    <div class="page-body">
      <div class="os-card pad ai-form">
        <p class="ai-tip">AI 判定会把<b>页面表单结构</b>与<b>简历内容</b>发送到你配置的 API（用于判断每个框该填什么），请确认服务可信。填写的 Key 仅保存在本机浏览器扩展中。</p>
        <label class="ai-label">API 地址（OpenAI 兼容，Base URL）
          <input id="ai-base-url" class="os-input" placeholder="https://api.deepseek.com/v1" spellcheck="false" />
        </label>
        <label class="ai-label">API Key
          <input id="ai-key" class="os-input" type="password" placeholder="sk-..." spellcheck="false" />
        </label>
        <label class="ai-label">模型
          <input id="ai-model" class="os-input" placeholder="deepseek-chat" spellcheck="false" />
        </label>
        <div class="ai-actions">
          <button type="button" id="ai-save" class="os-btn primary">保存</button>
          <button type="button" id="ai-test" class="os-btn">测试连接</button>
          <span id="ai-status" class="sync-status"></span>
          <span id="ai-saved-hint" class="os-ok" style="display:none">已保存 ✓ 到招聘页时侧边栏可用 AI 兜底判定。</span>
        </div>
      </div>
    </div>`;const t=s=>e.querySelector(s),a=()=>({aiBaseUrl:t("#ai-base-url").value.trim()||"https://api.deepseek.com/v1",aiKey:t("#ai-key").value.trim(),aiModel:t("#ai-model").value.trim()||"deepseek-chat"}),n=s=>{document.activeElement!==t("#ai-base-url")&&(t("#ai-base-url").value=s.aiBaseUrl),document.activeElement!==t("#ai-key")&&(t("#ai-key").value=s.aiKey),document.activeElement!==t("#ai-model")&&(t("#ai-model").value=s.aiModel)},o=async()=>{const s=await q();n({aiBaseUrl:s.aiBaseUrl,aiKey:s.aiKey,aiModel:s.aiModel})};t("#ai-save").addEventListener("click",async()=>{const s=await q();await V({...s,...a()});const c=t("#ai-saved-hint");c.style.display="",window.setTimeout(()=>c.style.display="none",5e3)}),t("#ai-test").addEventListener("click",()=>{(async()=>{const s=t("#ai-test"),c=t("#ai-status");s.disabled=!0,c.className="sync-status",c.textContent="测试中…";const u=a();if(!u.aiKey){c.className="sync-status err",c.textContent="请先填写 API Key",s.disabled=!1;return}try{const p=u.aiBaseUrl.trim().replace(/\/+$/,"").replace(/\/v1$/,""),y=await fetch(`${p}/v1/chat/completions`,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${u.aiKey}`},body:JSON.stringify({model:u.aiModel,messages:[{role:"user",content:"hi"}],max_tokens:8})});if(y.ok)c.className="sync-status ok",c.textContent="连接正常 ✓ 记得点「保存」";else{const b=(await y.text()).slice(0,200);c.className="sync-status err",c.textContent=y.status===401?"Key 无效（401）":`失败 ${y.status}: ${b}`}}catch(p){c.className="sync-status err",c.textContent=`无法连接：${p instanceof Error?p.message:String(p)}`}finally{s.disabled=!1}})()}),o()}const ye=["本科","硕士","博士","高中","大专","中专","初中及以下","MBA","其他"],ee=["一般","良好","熟练","精通"],bt=["在校生","应届毕业生","1 年以下",...Array.from({length:40},(e,t)=>`${t+1} 年`)],vt=["身份证","护照","港澳居民来往内地通行证","台湾居民来往大陆通行证"],gt=Array.from({length:56},(e,t)=>String(2035-t)),wt=Array.from({length:12},(e,t)=>`${t+1}月`),he={work:"工作经历",internship:"实习经历",education:"教育背景",project:"项目经验",language:"语言能力",award:"获奖经历"};function k(e){return e.replace(/[&<>"']/g,t=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[t])}function $t(e){const t=we(e??"");return t?`${Number(t)}月`:""}function be(e){return we(e)??""}function ve(e){return Pe(e??"")??""}function te(e,t,a){const n=t.trim(),o=e.includes(n);return[`<option value=""${n?"":" selected"}>${a}</option>`,...!n||o?[]:[`<option value="${k(n)}" selected>${k(n)}</option>`],...e.map(s=>`<option value="${k(s)}"${s===n?" selected":""}>${k(s)}</option>`)].join("")}function kt(e,t,a){a===""||a===!1?delete e[t]:e[t]=a}function St(e){return Object.values(e).some(t=>t===!0||typeof t=="string"&&t.trim()!=="")}function Et(e){let t=o(),a=null,n=null;function o(){return{work:[],internship:[],education:[],project:[],language:[],award:[]}}function s(l){const i=e.querySelector("#mk-chip");i&&(i.className=`mk-chip ${l}`,i.textContent=l==="dirty"?"未保存":l==="saving"?"保存中…":l==="saved"?"已保存":"")}function c(){s("dirty"),n!==null&&window.clearTimeout(n),n=window.setTimeout(()=>void u(),600)}async function u(){n!==null&&(window.clearTimeout(n),n=null),s("saving"),a={profile:t,sourceHost:(a==null?void 0:a.sourceHost)??"手动编辑",sourceUrl:(a==null?void 0:a.sourceUrl)??"",at:(a==null?void 0:a.at)??Date.now()},await Re(a),s("saved"),window.setTimeout(()=>s("hidden"),1200)}function p(l,i,d,h,g=""){return`<input class="os-input" spellcheck="false"${l===null?"":` data-sec="${l}" data-row="${i}"`} data-k="${d}" placeholder="${k(g)}" value="${k(h??"")}">`}function y(l,i,d,h,g,$="请选择"){return`<select class="os-select"${l===null?"":` data-sec="${l}" data-row="${i}"`} data-k="${d}">${te(g,h??"",$)}</select>`}function b(l,i,d,h,g=""){return`<textarea class="os-textarea" rows="3" spellcheck="false" data-sec="${l}" data-row="${i}" data-k="${d}" placeholder="${k(g)}">${k(h??"")}</textarea>`}function B(l,i,d=""){return`<textarea class="os-textarea" rows="3" spellcheck="false" data-k="${l}" placeholder="${k(d)}">${k(i??"")}</textarea>`}function m(l,i,d=""){return`<div class="mk-row"><label>${k(l)}</label><div class="mk-ctl">${i}${d?`<span class="mk-note">${k(d)}</span>`:""}</div></div>`}function v(l,i,d,h){return`<select class="os-select mk-year"${l===null?"":` data-sec="${l}" data-row="${i}"`} data-k="${d}">${te(gt,ve(h),"年")}</select>`}function O(l,i,d,h){return`<select class="os-select mk-month"${l===null?"":` data-sec="${l}" data-row="${i}"`} data-k="${d}">${te(wt,$t(h),"月")}</select>`}function _(l,i,d,h){return m("起止时间",`${v(l,i,"startYear",d.startYear)}${O(l,i,"startMonth",d.startMonth)}
       <span class="mk-dash">—</span>
       ${v(l,i,"endYear",d.endYear)}${O(l,i,"endMonth",d.endMonth)}
       ${h?`<label class="mk-check"><input type="checkbox" data-sec="${l}" data-row="${i}" data-k="toNow"${d.toNow?" checked":""}>至今</label>`:""}`)}function K(l,i,d){switch(l){case"work":case"internship":return _(l,d,i,!0)+m("公司名称",p(l,d,"company",i.company))+m("职位名称",p(l,d,"title",i.title))+m("工作职责",b(l,d,"duty",i.duty));case"education":return _(l,d,i,!1)+m("学校名称",p(l,d,"school",i.school,"学校全称"))+m("专业名称",p(l,d,"major",i.major,"专业全称"))+m("学历",y(l,d,"degree",i.degree,ye));case"project":return _(l,d,i,!1)+m("项目名称",p(l,d,"name",i.name))+m("职责",p(l,d,"role",i.role))+m("项目描述",b(l,d,"description",i.description))+m("项目中职责",b(l,d,"myDuty",i.myDuty));case"language":return m("语言类型",p(l,d,"lang",i.lang,"如 英语"))+m("掌握程度",y(l,d,"level",i.level,ee))+m("听说",y(l,d,"listenSpeak",i.listenSpeak,ee))+m("读写",y(l,d,"readWrite",i.readWrite,ee));case"award":return m("获奖时间",`${v(l,d,"startYear",i.startYear)}${O(l,d,"startMonth",i.startMonth)}`)+m("奖项名称",p(l,d,"awardName",i.awardName))}}function Y(l){const i=t[l],d=i.map((h,g)=>`
        <div class="mk-card">
          <div class="mk-card-head">
            <span class="mk-card-no">第 ${g+1} 条</span>
            <button type="button" class="os-btn sm danger-ghost" data-act="del" data-sec="${l}" data-row="${g}">删除本条</button>
          </div>
          <div class="mk-card-body">${K(l,h,g)}</div>
        </div>`).join("");return`<section class="mk-sec">
      <header class="mk-sec-head">
        <h3>${he[l]}</h3>
        <span class="mk-sub">${i.length?`${i.length} 条`:""}</span>
        <button type="button" class="os-btn sm mk-add" data-act="add" data-sec="${l}">＋ 添加</button>
      </header>
      <div class="mk-body mk-cards">${d||'<div class="mk-empty">还没有条目，点右上「＋ 添加」</div>'}</div>
    </section>`}function U(l,i,d=""){return`<section class="mk-sec">
      <header class="mk-sec-head"><h3>${k(l)}</h3>${d?`<span class="mk-sub">${k(d)}</span>`:""}</header>
      <div class="mk-body">${i}</div>
    </section>`}function J(){const l=a?`来源 ${k(a.sourceHost)} · ${new Date(a.at).toLocaleString("zh-CN")}`:"尚无数据（在 Moka 简历页点「提取本页简历」，或直接在下方填写）";e.innerHTML=`
      <div class="page-head">
        <div class="page-title">
          <h1>默认模板 · Moka 通用简历页</h1>
          <p>字段与 Moka 各公司通用简历页一致、固定不可增删；它是该页面「一键填充」的数据源，在此修改即改填充内容。</p>
        </div>
        <div class="toolbar">
          <span class="os-badge">${l}</span>
          <button type="button" class="os-btn sm" data-act="reload">↻ 重新读取</button>
          <span class="mk-chip" id="mk-chip"></span>
        </div>
      </div>
      <div class="page-body">
        <div class="mk-wrap">
          ${U("基础信息",m("姓名",p(null,null,"name",t.name))+m("手机号码",p(null,null,"phone",t.phone))+m("邮箱",p(null,null,"email",t.email)),"页面为账号绑定字段，填充时跳过")}
          ${U("个人信息",m("性别",y(null,null,"gender",t.gender,["男","女"]))+m("工作经验",y(null,null,"workYears",t.workYears,bt))+m("最高学历",y(null,null,"degree",t.degree,ye))+m("所在地",p(null,null,"location",t.location))+m("最近公司",p(null,null,"recentCompany",t.recentCompany))+m("证件类型",y(null,null,"idType",t.idType,vt))+m("证件号码",p(null,null,"idNumber",t.idNumber))+m("出生日期",`${v(null,null,"birthYear",t.birthDate)}${O(null,null,"birthMonth",t.birthDate)}`,"页面为择年+择月"))}
          ${U("求职意向",m("当前薪资",p(null,null,"currentSalary",t.currentSalary))+m("期望薪资",p(null,null,"expectedSalary",t.expectedSalary))+m("期望城市",p(null,null,"expectedCity",t.expectedCity)))}
          ${Y("work")}
          ${Y("education")}
          ${Y("internship")}
          ${Y("project")}
          ${Y("language")}
          ${U("自我描述",m("自我描述",B("selfDescription",t.selfDescription)))}
          ${Y("award")}
        </div>
      </div>`}function pe(l){const i=l.target;if(!(i instanceof HTMLInputElement||i instanceof HTMLSelectElement||i instanceof HTMLTextAreaElement))return null;const d=i.dataset.k;if(!d)return null;const h=i.dataset.sec??null,g=i.dataset.row===void 0?null:Number(i.dataset.row);return{k:d,sec:h,row:g,el:i}}function me(l){const i=pe(l);if(!i)return;const{k:d,sec:h,row:g,el:$}=i,A=$ instanceof HTMLInputElement&&$.type==="checkbox"?$.checked:$.value;if(d==="birthYear"||d==="birthMonth"){const P=d==="birthYear"?String(A):ve(t.birthDate),fe=be(d==="birthMonth"?String(A):t.birthDate??"");t.birthDate=P&&fe?`${P}-${fe}`:P||"",c();return}if(h!==null&&g!==null){const P=t[h][g];if(!P)return;kt(P,d,A)}else t[d]=A===""?void 0:A;c()}function Oe(l){const i=pe(l);i&&(i.el instanceof HTMLSelectElement||i.el instanceof HTMLInputElement&&i.el.type==="checkbox"||me(l))}function qe(l){var g;const i=l.target.closest("[data-act]");if(!i)return;const d=i.dataset.act;if(d==="reload"){Q(!0);return}const h=i.dataset.sec;if(h){if(d==="add"){t[h].push({}),u(),J();const $=e.querySelector(`[data-sec="${h}"][data-row="${t[h].length-1}"][data-k]`);(g=$==null?void 0:$.closest(".mk-card"))==null||g.scrollIntoView({behavior:"smooth",block:"center"}),$==null||$.focus();return}if(d==="del"){const $=Number(i.dataset.row),A=t[h][$];if(!A||St(A)&&!window.confirm(`删除「${he[h]}」第 ${$+1} 条？`))return;t[h].splice($,1),u(),J()}}}e.addEventListener("input",Oe),e.addEventListener("change",me),e.addEventListener("click",qe);async function Q(l=!1){a=await He(),t=(a==null?void 0:a.profile)??o(),J(),l&&(s("saved"),window.setTimeout(()=>s("hidden"),1200))}return Q(),{show:()=>void Q()}}const Tt={pending:"待投递",applied:"已投递",interview:"面试中",offer:"已拿Offer",rejected:"未通过",archived:"已归档"};function Lt(e,t){e.innerHTML=`
    <div class="page-head">
      <div class="page-title"><h1>投递记录</h1><p>填充/提交后自动记录，可与 EasyWork 双向同步。</p></div>
    </div>
    <div class="page-body">
      <div class="os-card pad rec-toolbar">
        <button type="button" id="btn-sync" class="os-btn primary">⇄ 从 EasyWork 同步</button>
        <span id="sync-status" class="sync-status"></span>
        <span class="spacer"></span>
        <span id="rec-count" class="os-badge muted"></span>
      </div>
      <div class="os-card pad">
        <table class="os-table" id="records-table">
          <thead><tr><th>公司</th><th>职位</th><th>来源</th><th>投递时间</th><th>状态</th><th>操作</th></tr></thead>
          <tbody id="records-body"></tbody>
        </table>
        <div id="records-empty" class="os-empty" style="display:none">
          <div class="os-empty-icon">IN</div>
          <h4>暂无投递记录</h4>
          <p>在招聘页面用「一键填充」完成后会自动生成记录；也可以点上方「从 EasyWork 同步」拉取。</p>
        </div>
      </div>
    </div>`;const a=async()=>{const n=await Ge(),o=e.querySelector("#records-body"),s=e.querySelector("#records-empty"),c=e.querySelector("#rec-count");o.innerHTML="",s.style.display=n.length?"none":"",c.textContent=`共 ${n.length} 条`;for(const u of n){const p=document.createElement("tr");p.innerHTML=`
        <td>${f(u.company||"—")}</td>
        <td>${f(u.position||"—")}</td>
        <td><span class="os-badge muted">${f(u.site||"")}</span></td>
        <td class="os-muted">${new Date(u.appliedAt).toLocaleString()}</td>
        <td><select class="os-select" data-status="${f(u.id)}" style="min-width:110px">
          ${Object.entries(Tt).map(([y,b])=>`<option value="${y}" ${y===u.status?"selected":""}>${b}</option>`).join("")}
        </select></td>
        <td><button type="button" class="os-btn danger-ghost sm" data-del-record="${f(u.id)}">删除</button></td>`,o.appendChild(p)}};return e.addEventListener("change",n=>{const o=n.target.closest("[data-status]");o&&(async()=>(await _e(o.dataset.status??"",{status:o.value,updatedAt:Date.now()}),await a(),await t.sync().catch(()=>{})))()}),e.addEventListener("click",n=>{const o=n.target.closest("[data-del-record]");o&&(async()=>(await Fe(o.dataset.delRecord??""),await a(),await t.sync().catch(()=>{})))()}),e.querySelector("#btn-sync").addEventListener("click",async()=>{const n=e.querySelector("#btn-sync"),o=e.querySelector("#sync-status");n.disabled=!0,o.className="sync-status",o.textContent="同步中…";try{const s=await t.sync();o.className=`sync-status ${s.className}`,o.textContent=s.message,await a()}catch(s){o.className="sync-status err",o.textContent=`同步失败：${s instanceof Error?s.message:String(s)}`}finally{n.disabled=!1}}),{show:a}}function ce(e,t,a,n){const o=document.getElementById("tpl-select");if(!o)return;o.innerHTML=e.map(u=>`<option value="${f(u.id)}">${f(u.name)}</option>`).join(""),o.value=t??"",o.disabled=n;const s=document.getElementById("tpl-name");s&&(s.value=a,s.disabled=n,s.placeholder=n?"先新建模板":"模板名称（可改）");const c=document.getElementById("btn-tpl-del");c&&(c.disabled=n)}function R(e){const t=document.getElementById("save-chip");t&&(t.className=`save-chip ${e}`,t.textContent=e==="saving"?"保存中…":e==="saved"?"已自动保存":e==="dirty"?"有未保存修改":"",t.style.visibility=e==="hidden"?"hidden":"visible")}const N=document.getElementById("directory"),w=document.getElementById("flow");let S=[],r=null,M=[];const j=new Set;let F=-1,ae=!1,I=null;function x(){R("dirty"),I!==null&&window.clearTimeout(I),I=window.setTimeout(()=>void D(),500)}async function D(){if(I!==null&&(window.clearTimeout(I),I=null),!(!r||ae)){ae=!0,R("saving");try{await ie({...r,updatedAt:Date.now()})}finally{ae=!1}I===null?(R("saved"),window.setTimeout(()=>R("hidden"),1400)):R("dirty")}}async function re(){I!==null&&(window.clearTimeout(I),I=null),r&&(await ie({...r,updatedAt:Date.now()}),R("hidden"))}function G(){ce(S,(r==null?void 0:r.id)??null,(r==null?void 0:r.name)??"",!r),E(),T()}function E(){const e=N.scrollTop;N.innerHTML=ft({tpl:()=>r,customFields:()=>M,chipsOpen:j,activeGroup:()=>F,onGotoGroup:Me,onGotoSection:Ae,onToggleAdd:De,onAddType:Ye,onCustomNew:Ne,onCustomEdit:je,onCustomDel:xe}),N.scrollTop=e}function T(){const e=w.scrollTop;w.innerHTML=it(r),dt(w),w.scrollTop=e}function Le(e){const t=r==null?void 0:r.sections.find(n=>n.id===e);if(!t)return;const a=N.querySelector(`[data-goto-sec="${CSS.escape(e)}"] .os-dot`);a==null||a.classList.toggle("filled",le(t))}function Ie(e){const t=w.querySelector(`#sec-${CSS.escape(e)}`);t&&(t.scrollIntoView({behavior:"smooth",block:"center"}),t.classList.add("flash"),window.setTimeout(()=>t.classList.remove("flash"),1600),window.setTimeout(de,320))}function de(){const e=w.getBoundingClientRect();let t=-1;if(w.querySelectorAll("[data-flow-group]").forEach(a=>{a.getBoundingClientRect().top-e.top<160&&(t=Number(a.dataset.flowGroup))}),t!==F){F=t;const a=N.querySelector(`[data-dir-group="${t}"]`);a&&a.classList.add("active"),N.querySelectorAll('.dir-group:not([data-dir-group=""])').forEach(n=>{n!==a&&n.classList.remove("active")})}}function Me(e){const t=w.querySelector(`[data-flow-group="${e}"]`);if(t)t.scrollIntoView({behavior:"smooth",block:"start"}),window.setTimeout(de,320);else{j.add(e),E();const a=N.querySelector(`[data-dir-group="${e}"]`);a==null||a.scrollIntoView({behavior:"smooth",block:"nearest"})}}function Ae(e){Ie(e)}function De(e){j.has(e)?j.delete(e):j.add(e),E()}function Ye(e){if(!r||r.sections.some(o=>o.type===e))return;const t=M.find(o=>o.id===e),a=ke(e);a.label=(t==null?void 0:t.label)??a.label;const n=Je(r.sections,e);r.sections.splice(n,0,a),x(),D(),E(),T(),Ie(a.id)}function It(e){const t=r==null?void 0:r.sections.find(a=>a.id===e);t&&(le(t)&&!window.confirm(`从模板移除「${t.label}」及其内容？`)||(r.sections=r.sections.filter(a=>a.id!==e),x(),D(),E(),T()))}function Ce(e,t){const a=r==null?void 0:r.sections.find(o=>o.id===e);if(!a)return;a.label=t,x(),D();const n=w.scrollTop;E(),T(),w.scrollTop=n}function Mt(e){const t=ut(w,e);t&&Qe(t,a=>{const n=r==null?void 0:r.sections.find(o=>o.id===e);n&&a.trim()&&a.trim()!==n.label?Ce(e,a.trim()):T()},()=>T())}function At(e){const t=r==null?void 0:r.sections.find(n=>n.id===e);if(!t||!H(t.data))return;t.data.items.push(st(t.data.kind)),x(),D(),T();const a=w.querySelector(`#sec-${CSS.escape(e)}`);a==null||a.scrollIntoView({behavior:"smooth",block:"nearest"}),pt(w,e),Le(e),E()}function Dt(e,t){const a=r==null?void 0:r.sections.find(c=>c.id===e);if(!a||!H(a.data))return;const n=a.data.items[t];if(!n||Object.entries(n).some(([c,u])=>c!=="id"&&String(u??"").trim()!=="")&&!window.confirm("该条已有内容，确认删除？"))return;a.data.items.splice(t,1),x(),D();const s=w.scrollTop;E(),T(),w.scrollTop=s}function Yt(e,t,a){const n=r==null?void 0:r.sections.find(u=>u.id===e);if(!n||!H(n.data))return;const o=n.data.items,s=t+a;if(s<0||s>=o.length)return;[o[t],o[s]]=[o[s],o[t]],x(),D();const c=w.scrollTop;T(),w.scrollTop=c}async function ue(){const e=await q();e.customFields=M,await V(e)}async function Ne(){const e=await Ee(null);e&&(M.push({id:L("custom"),label:e.label,keywords:e.keywords}),await ue(),E())}async function je(e){const t=M.find(n=>n.id===e);if(!t)return;const a=await Ee(t);a&&(t.label=a.label,t.keywords=a.keywords,await ue(),E(),T())}async function xe(e){const t=M.find(a=>a.id===e);t&&window.confirm(`删除自定义组件「${t.label}」？已放入模板的字段会保留，但不再参与页面匹配。`)&&(M=M.filter(a=>a.id!==e),await ue(),E())}function Be(e){const t=S.find(a=>a.id===e);t&&(r=t,j.clear(),F=-1,(async()=>{const a=await q();a.activeProfileId=t.id,await V(a)})(),G())}function ge(e){const t=Date.now(),a={id:L("tpl"),name:`模板 ${S.length+1}`,sections:e?se.map(n=>ke(n)):[],createdAt:t,updatedAt:t};(async()=>(await ie(a),S=await W(),await Be(a.id),e||(j.add(0),E())))()}function Ct(){document.getElementById("tpl-select").addEventListener("change",e=>{(async()=>(await re(),Be(e.target.value)))()}),document.getElementById("tpl-name").addEventListener("change",e=>{r&&(r.name=e.target.value.trim()||"未命名模板",x(),D().then(()=>ce(S,r.id,r.name,!1)))}),document.getElementById("btn-tpl-new").addEventListener("click",()=>ge(!1)),document.getElementById("btn-tpl-full").addEventListener("click",()=>ge(!0)),document.getElementById("btn-tpl-del").addEventListener("click",()=>{r&&window.confirm(`删除模板「${r.name}」？`)&&(async()=>{const e=await q();e.activeProfileId===r.id&&(e.activeProfileId=null,await V(e)),await Ke(r.id),S=await W(),r=S.find(t=>t.id===e.activeProfileId)??S[0]??null,G()})()})}function Nt(){document.querySelectorAll(".rail-item").forEach(e=>{e.addEventListener("click",()=>{const t=e.dataset.page??"";document.querySelectorAll(".rail-item").forEach(a=>a.classList.toggle("active",a===e)),document.querySelectorAll(".page").forEach(a=>a.classList.toggle("active",a.dataset.pagePanel===t)),t==="records"&&xt.show(),t==="moka"&&Bt.show()})})}async function jt(){const e=await chrome.runtime.sendMessage({type:"SYNC_FROM_EASYWORK"});if(!(e!=null&&e.ok))throw new Error((e==null?void 0:e.error)??"同步失败");const t=e.data;if(t.serverReachable){S=await W();const a=await q(),n=S.find(o=>o.id===a.activeProfileId)??S[0]??null;n!==r&&n?(r=n,G()):!n&&r&&(r=null,G()),ce(S,(r==null?void 0:r.id)??null,(r==null?void 0:r.name)??"",!r)}return{message:t.message,className:t.serverReachable?"ok":"err"}}const xt=Lt(document.getElementById("page-records"),{sync:jt});ht(document.getElementById("page-ai"));const Bt=Et(document.getElementById("page-moka"));async function Ot(){S=await W();const e=await q();M=e.customFields,r=S.find(t=>t.id===e.activeProfileId)??S[0]??null,G()}rt(w,{active:()=>r,removeSection:It,addItem:At,removeItem:Dt,moveItem:Yt,markDirty:x,saveNow:D,refreshSectionBadge:Le,renameSectionLabel:Ce,cancelRename:T,beginRename:Mt});yt(N,{tpl:()=>r,customFields:()=>M,chipsOpen:j,activeGroup:()=>F,onGotoGroup:Me,onGotoSection:Ae,onToggleAdd:De,onAddType:Ye,onCustomNew:Ne,onCustomEdit:je,onCustomDel:xe});Ct();Nt();let ne=!1;w.addEventListener("scroll",()=>{ne||(ne=!0,requestAnimationFrame(()=>{ne=!1,de()}))},{passive:!0});window.addEventListener("pagehide",()=>void re());document.addEventListener("visibilitychange",()=>{document.visibilityState==="hidden"&&re()});Ot();

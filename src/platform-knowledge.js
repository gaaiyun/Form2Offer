(function attachForm2OfferPlatformKnowledge(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.Form2OfferPlatformKnowledge = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createForm2OfferPlatformKnowledge() {
  "use strict";

  // 国内校招网申平台知识库。内容来自 2026 年秋招真实填表记录（Moka、北森、51job、HotJob、飞书、
  // 银行与国企自建站）与公开页面指纹；只记平台行为，不含任何个人资料或租户账号信息。
  // confidence：verified = 登录后真实表单实测；partial = 部分实测；unverified = 只有公开页面或通用知识。

  const FAMILIES = Object.freeze({
    ats: "招聘 SaaS（ATS）",
    "job-board": "招聘平台 / 求职网站",
    "self-built": "企业自建招聘站",
    "bank-soe": "银行 / 国企 / 事业单位",
    "foreign-ats": "外企 ATS",
    "info-only": "信息页（不是投递入口）"
  });

  const GENERAL_RULES = Object.freeze([
    { id: "parse-first", text: "有简历解析的平台：先选对简历版本→上传→等解析完→逐项核对改正；表单填好后不要再上传，解析会覆盖已填内容。" },
    { id: "status-layers", text: "状态分开记：已上传、已解析核对、已暂存、已预览、已提交。“自动保存成功”、按钮可点、页面无报错都不等于已提交。" },
    { id: "submit-evidence", text: "提交只认成功页、简历编号或“我的投递”里的新记录；结果不明时记为“提交结果未知”，不要重投。" },
    { id: "rank-bucket", text: "成绩排名没有对应档位时，选仍包含真实排名的最小档（前10%→前20%），不选更好的档，也不从 GPA 推算名次。" },
    { id: "month-dates", text: "经历只有年月而控件要精确到日：开始填当月 1 日、结束填当月最后一天。没有“至今”选项时不要输入“至今”，会被解析成当天。" },
    { id: "prefill-check", text: "平台预填和解析结果常出错（英语等级、邮箱、地址、最高学历、专业括号、单位与职位错位），每项都要读回核对。" },
    { id: "length-limit", text: "注意字数上限：部分站点按字节计（汉字算 2），短栏写不下的内容放进描述类长文本栏，不要硬截断。" },
    { id: "apply-limit", text: "先看“还可投递 N 个 / 最多 N 个志愿”。选志愿就会占名额，次数有限的公司提交后通常不能修改。" },
    { id: "neutral-file", text: "上传文件用不含公司名的中性文件名；照片按控件标题区分证件照与生活照，并核对底色、尺寸和 KB 范围。" },
    { id: "facts-by-person", text: "亲属在职、疾病、处分、调剂、到岗时间等声明由本人逐项确认，不沿用其他公司的回答。" },
    { id: "human-only", text: "登录、验证码、滑块、证件号、密码和最终提交由本人完成。" },
    { id: "rescan", text: "多步表单切换页面、增删条目后会重新渲染，需要重新扫描；全部填完后从上到下复核一遍，个别字段会丢值。" },
    { id: "dropdown-readback", text: "自绘下拉有展开动画，选完要读回显示值，避免选中相邻选项。" },
    { id: "full-names", text: "公司写全称，部门和职务另列；职位字典里没有“实习生”时，描述首行写明真实职务与实习身份。" },
    { id: "save-often", text: "部分银行站约 15 分钟无请求就会话过期，每填完一条就保存。" }
  ]);

  const PLATFORMS = [
    {
      id: "moka",
      name: "Moka 招聘",
      family: "ats",
      confidence: "verified",
      match: [
        { host: "(^|\\.)mokahr\\.com$" },
        { path: "^/(m/)?(campus-recruitment|social-recruitment|campus_apply)/", weak: true }
      ],
      signals: ["[class*='sd-Select-container']", ".polyglot-separator", "[class*='apply-field-']"],
      login: "手机号或邮箱验证码；登录态按租户 cookie 保存，未登录点“申请职位”会弹登录框。",
      parse: { supported: true, overwrites: "high", note: "上传后约 8–10 秒解析完成，会覆盖专业、成绩排名、海外经历和多段实习；标点变半角，专业名可能丢右括号，偶尔丢一段。" },
      save: "单页长表单，没有分节保存；底部“预览并提交”。",
      submitEvidence: "URL 含 /campus_apply/thanks 或页面出现“已成功提交”。",
      limits: "个别租户限制总投递次数，提交后不可修改。",
      controls: [
        "字段块 class 含 apply-field-，标题 class 含 title-，中英文标题用 .polyglot-separator 分隔。",
        "下拉是自绘 sd-Select，选项在页面底部的 portal（sd-Select-menu）里，位置随滚动变化，需要真实点击。",
        "日期面板：点年份标题进十年面板→选年→选月；出生日期只到年月。",
        "籍贯等级联：依次点省、市、区，最后点“确认”。",
        "专业搜不到时用“添加专业全称”手动输入完整专业名。",
        "条目型小节常以“是否有实习/项目经历”开头，选“是”后其余字段才渲染。",
        "部分租户点“申请职位”后先弹隐私协议。"
      ],
      tips: [
        "先上传简历并等解析完（约 10 秒），再开始填写",
        "解析会覆盖专业、排名和实习段，填完后不要再上传",
        "“是否有实习/项目经历”先选“是”，字段才会出现",
        "增删条目后部分字段会丢值，提交前从上到下复核"
      ],
      agentNotes: [
        "页面有 smooth scroll，滚动后坐标会变，点击前重新取位置。",
        "别处增删条目会让语言类型、期望城市、院校起止等字段丢值，最后做一遍幂等复核。",
        "教育背景首块“填写说明 / 从最高学历开始填写 □确认”是必填勾选，点 label。",
        "解析结果比较要用严格相等，解析常带“·”项目符号或多余前缀。"
      ]
    },
    {
      id: "beisen",
      name: "北森招聘（新版门户）",
      family: "ats",
      confidence: "partial",
      match: [
        { host: "(^|\\.)zhiye\\.com$" },
        { host: "(^|\\.)italent(x)?\\.(cn|com)$" },
        { host: "(^|\\.)beisen\\.com$" }
      ],
      signals: [".form-item--phoenix", ".phoenix-select", ".phoenix-radio-group"],
      login: "微信扫码或手机号注册登录，登录态按租户独立。",
      parse: { supported: true, overwrites: "medium", note: "上传后解析预填；奖项日期常被写成 1 月 1 日或年份错误，专业人数等字段可能被填入无依据的数字。" },
      save: "表单页“暂存”与“预览并提交”；暂存后最好重新载入核对。",
      submitEvidence: "岗位详情页显示“已投递”或“你已投递过该职位”。",
      limits: "账户页显示“最多可投递 N 个校园招聘职位，还可投递 M 个”。",
      controls: [
        "字段为 .form-item，标签 .form-item__text，必填标记 .form-item__required。",
        "Phoenix 自绘下拉、地区和日期选择器：点开浮层→读可见选项→精确匹配→点击→读回。",
        "简历和证件照是两个上传框，按块标题区分，别按页面顺序。"
      ],
      tips: [
        "先看“还可投递 N 个”，再决定岗位",
        "先上传简历等解析，再核对奖项日期、专业人数等字段",
        "证件照和简历是两个上传框，按标题区分",
        "带 isEdit 的链接可能是在编辑已投简历，先看详情页状态"
      ],
      agentNotes: [
        "投递表单入口形如 /form?fromPage=job&jobAdId=<id>；未登录会跳 /login。",
        "无依据的必填数字（如专业人数）留空交给本人，不要沿用解析值。"
      ]
    },
    {
      id: "beisen-legacy",
      name: "北森招聘（旧版门户）",
      family: "ats",
      confidence: "verified",
      match: [
        { host: "(^|\\.)zhiye\\.com$", path: "^/(Portal/|campusxq|internxq|socialxq)" }
      ],
      signals: [".bs_school_selector_main", ".bas_select_wrap", ".dl_postit"],
      login: "手机号或邮箱账号，登录态按租户独立。",
      parse: { supported: true, overwrites: "medium", note: "简历导入约 10–30 秒；专业名会被截短（如只剩“金融”），专业排名和本科学位为空，需要按资料重写。" },
      save: "分步表单：基本信息→个人履历→附件→预览提交；每个条目有自己的“保存”，整步“保存并下一步”。",
      submitEvidence: "“我的申请”里出现带“查看申请”的已完成记录。",
      limits: "详情页才能读到准确的限投与剩余次数。",
      controls: [
        "出生日期是 My97 日期框，格式 yyyy/mm/dd，写 yyyy-mm-dd 会报“日期格式不正确”。",
        "学校弹窗：搜索后要点结果里的 radio 才算选中；同名分校（如“…南国商学院”）要按全名区分。",
        "地区弹窗：点文字是下钻，点 radio 才是选中，末级选完点“确定”。",
        "站点会跳过它认为已完成的步骤，需要按顶部步骤条逐步核对。"
      ],
      tips: [
        "出生日期用 yyyy/mm/dd 格式",
        "学校弹窗要点 radio 选中，注意同名分校",
        "站点会自动跳步，按步骤条逐步检查",
        "解析后的专业名、排名、学位需要重写"
      ],
      agentNotes: [
        "删除条目的确认框是自绘 simplemodal，不是浏览器原生对话框。",
        "每次进入 ResumeItem 都会在“未完成申请”留一条草稿，属正常现象。"
      ]
    },
    {
      id: "51job",
      name: "前程无忧校园（新版企业表单）",
      family: "job-board",
      confidence: "verified",
      match: [
        { host: "^xyz\\.51job\\.com$", path: "^/consumer/" },
        { host: "(^|\\.)51job\\.com$" },
        { host: "(^|\\.)51jobcdn\\.com$" }
      ],
      signals: [],
      login: "应届生求职账号（短信验证码），与 www.51job.com 登录态不通用。",
      parse: { supported: false, overwrites: "low", note: "附件上传后多数租户不解析，只显示编号文件名；字段需要手工核对。" },
      save: "每个小节独立保存；必填未齐时保存按钮灰掉或返回“参数异常”。",
      submitEvidence: "跳转应届生个人中心后，“投递反馈→网申”出现该岗位“已投递”。",
      limits: "常见每人 1–2 个志愿；第一志愿出现在表中不代表已提交。",
      controls: [
        "Element UI；日期框可用真实键盘输入 yyyy-mm-dd 后回车。",
        "学校、专业是自动补全，要点中候选项，容易点到名字相近的学校。",
        "成绩排名档常只有前5%、前20%、前50%、其他。",
        "公司规模把 1000–9999 拆成 1000–5000、5000–10000，不能凭集团总人数推断。",
        "“学术成果”选“是”后必填期刊名与精确发布日期，在投论文不能当已发表。"
      ],
      tips: [
        "排名没有对应档时选包含真实排名的档（前10%→前20%）",
        "小节分别保存，保存灰掉通常是必填没齐",
        "学校/专业要点中下拉候选，留意相近校名",
        "在投论文不要选“已发表”"
      ],
      agentNotes: [
        "偏好类必填（城市调动、大区调剂、第二志愿）是本人决策，不能拿其他公司的回答代填。",
        "附件无回显时要重新上传并等字段稳定后再核对。"
      ]
    },
    {
      id: "51job-classic",
      name: "前程无忧校园（经典五步表单）",
      family: "job-board",
      confidence: "verified",
      match: [
        { host: "(^|\\.)51job\\.com$", path: "\\.aspx" }
      ],
      signals: ["#imgbtnNext", "#imgbtnSubmit", "[id$='imgbtnNext']"],
      login: "应届生求职账号。",
      parse: { supported: false, overwrites: "low", note: "旧档案的预填常有错误：英语被带成专业四级、邮箱错位、地址和最高学历不对，必须逐项核对。" },
      save: "五步：基本信息→教育→IT 技能→实习/工作→自评；用“下一步/上一步”按钮翻页并保存。",
      submitEvidence: "点“提交”后跳转 xyzsuccess 页，显示“投递成功”和简历编号。",
      limits: "按企业设置。",
      controls: [
        "多条经历用“添加”新增，字段 id 依次带 _1、_2 后缀。",
        "学校、专业是 select 加自动补全文本框，只改 select 时页面仍显示旧值。",
        "文本框 maxlength 按字节计，50 约等于 25 个汉字。",
        "附件上传框在同源 iframe 里。",
        "左侧栏目文字不能切换步骤，要用页面的上一步/下一步。"
      ],
      tips: [
        "字数上限按字节算，汉字算 2 个",
        "预填常有错：英语等级、邮箱、地址、最高学历逐项核对",
        "用页面的“下一步/上一步”翻页，左侧栏目不能切换",
        "看到“投递成功”和简历编号才算已投"
      ],
      agentNotes: [
        "奖项名称写不下时放进描述类 textarea。",
        "“待完善投递(N)”的计数会滞后，以实际卡片为准。"
      ]
    },
    {
      id: "yingjiesheng-resume",
      name: "应届生求职通用简历",
      family: "job-board",
      confidence: "verified",
      match: [
        { host: "^q\\.yingjiesheng\\.com$" },
        { host: "^young\\.yingjiesheng\\.com$" }
      ],
      signals: [],
      login: "应届生求职账号（与 51job 校园共用）。",
      parse: { supported: true, overwrites: "medium", note: "PDF 解析会产生乱码、断行，把章节名混进经历；要编辑原记录，不要重新上传覆盖。" },
      save: "各栏目原生“添加”和“保存”，与企业表单分开。",
      submitEvidence: "通用简历保存不等于任何企业网申已投递。",
      limits: "—",
      controls: [
        "职位栏使用平台字典，输入自由文本不会保存。",
        "荣誉名称上限 50，中文按 2 计。",
        "资格证书要求获得年月。",
        "首次刷新可能触发滑块验证。"
      ],
      tips: [
        "职位必须从平台字典里选，自由文本不保存",
        "荣誉名称最多约 25 个汉字",
        "通用简历保存≠企业网申已投递"
      ],
      agentNotes: ["公共简历同一时间只由一个会话编辑。"]
    },
    {
      id: "hotjob",
      name: "HotJob（红海云）",
      family: "ats",
      confidence: "partial",
      match: [{ host: "(^|\\.)hotjob\\.cn$" }],
      signals: ["[class*='kuma-form']", "[class*='uxcore']"],
      login: "微信扫码或邮箱/手机验证码，首次登录会自动创建账号。",
      parse: { supported: true, overwrites: "medium", note: "可上传简历解析；部分岗位要求“中文简历完整度 100%”才能投递。" },
      save: "简历模块分块保存；“自动保存成功”提示不代表正式保存，重载后可能回到旧值。",
      submitEvidence: "投递记录中出现该岗位。",
      limits: "国企、银行类常限志愿数；志愿、地点、岗位问答是投递时的独立步骤。",
      controls: [
        "阿里云 WAF：短时间大量请求会被封（405），每个租户请求要间隔。",
        "在研项目结束日没有“至今”选项，输入“至今”会被解析成当天。",
        "公司规模需按每段实习分别选择。",
        "专业要在弹窗里选中，只写名称不算。",
        "postType 有 campus / social / intern 之分，不能混用。"
      ],
      tips: [
        "“自动保存成功”不等于正式保存，记得点保存并核对",
        "进行中的项目不要输入“至今”",
        "专业必须在弹窗中选中",
        "别频繁刷新，站点有防火墙会封 IP"
      ],
      agentNotes: ["根域名入口（不含 SU 编号）要以登录后最终落地的 URL 为准。"]
    },
    {
      id: "feishu",
      name: "飞书招聘",
      family: "ats",
      confidence: "verified",
      match: [
        { host: "(^|\\.)jobs\\.feishu\\.cn$" },
        { host: "(^|\\.)jobs\\.larksuite\\.com$" }
      ],
      signals: [".ud-formily-item", "[class*='applyFormModuleWrapper']", "[data-form-field-id]"],
      login: "手机号或邮箱验证码。",
      parse: { supported: true, overwrites: "high", note: "“解析并覆盖”会清空部分已填项（证件、年龄、家乡、期望地点、院系、排名、学位、学科门类、学制），项目和实习按 PDF 重建。" },
      save: "单页申请表，底部“提交简历”。",
      submitEvidence: "跳转“投递成功”，并显示该岗位是第几志愿。",
      limits: "同一招聘项目可能限制官网与内推合计次数，达上限会提示。",
      controls: [
        "字段带 data-form-field-id / data-form-field-name，是稳定锚点。",
        "账号已有旧简历时会自动带出旧值，期望城市可能被预填成别的城市。"
      ],
      tips: [
        "解析会覆盖已填内容，先上传再核对",
        "期望城市可能被预填，按岗位核对",
        "看到“已达投递上限”就停止，不再上传"
      ],
      agentNotes: ["申请信息含意向城市、期望地点、期望初试形式、招聘信息来源。"]
    },
    {
      id: "bytedance",
      name: "字节跳动校招",
      family: "self-built",
      confidence: "partial",
      match: [{ host: "^jobs\\.bytedance\\.com$" }, { host: "(^|\\.)bytedance\\.com$", path: "^/campus" }],
      signals: [],
      login: "手机号或邮箱验证码。",
      parse: { supported: true, overwrites: "unknown", note: "与飞书招聘同源，先建在线简历再投递。" },
      save: "在线简历分块保存。",
      submitEvidence: "投递进度页出现岗位。",
      limits: "同时投递岗位数有限；正式校招与实习项目要区分。",
      controls: ["SPA 自绘组件。"],
      tips: ["先确认是正式校招还是实习项目", "投递名额有限，先选准岗位"],
      agentNotes: []
    },
    {
      id: "tencent",
      name: "腾讯校招",
      family: "self-built",
      confidence: "partial",
      match: [{ host: "^join\\.qq\\.com$" }, { host: "^careers\\.tencent\\.com$" }],
      signals: [],
      login: "微信或 QQ 扫码，只能本人完成。",
      parse: { supported: null, overwrites: "unknown", note: "未实测。" },
      save: "在线简历 + 志愿选择。",
      submitEvidence: "投递进度页出现岗位。",
      limits: "有志愿数量限制。",
      controls: [],
      tips: ["扫码登录由本人完成", "志愿数量有限"],
      agentNotes: []
    },
    {
      id: "zhaopin",
      name: "智联招聘校园",
      family: "job-board",
      confidence: "partial",
      match: [{ host: "(^|\\.)zhaopin\\.com$" }],
      signals: [".apply-module", ".scrd-web--form"],
      login: "手机验证码或微信扫码。",
      parse: { supported: true, overwrites: "unknown", note: "平台在线简历。" },
      save: "企业页内嵌申请模块，每块独立保存。",
      submitEvidence: "“我的投递”出现记录。",
      limits: "按企业设置。",
      controls: ["el-form 与 apply-form-* 控件混用。"],
      tips: ["每个模块单独保存"],
      agentNotes: []
    },
    {
      id: "nowcoder",
      name: "牛客网申",
      family: "job-board",
      confidence: "partial",
      match: [{ host: "(^|\\.)nowcoder\\.com$" }],
      signals: [],
      login: "手机、微信或邮箱。",
      parse: { supported: true, overwrites: "unknown", note: "站内简历模块。" },
      save: "站内问卷或外跳企业官网。",
      submitEvidence: "投递记录。",
      limits: "按企业设置。",
      controls: ["Ant Design 风格。"],
      tips: ["很多岗位会外跳到企业官网投递"],
      agentNotes: []
    },
    {
      id: "shixiseng",
      name: "实习僧",
      family: "job-board",
      confidence: "partial",
      match: [{ host: "(^|\\.)shixiseng\\.com$" }],
      signals: [],
      login: "手机验证码或微信。",
      parse: { supported: true, overwrites: "unknown", note: "站内在线简历一键投递。" },
      save: "站内在线简历。",
      submitEvidence: "投递记录。",
      limits: "每日投递数可能有上限。",
      controls: [],
      tips: ["校招专栏常跳企业官网网申"],
      agentNotes: []
    },
    {
      id: "liepin",
      name: "猎聘校招",
      family: "job-board",
      confidence: "unverified",
      match: [{ host: "(^|\\.)liepin\\.com$" }],
      signals: [],
      login: "手机验证码或微信。",
      parse: { supported: null, overwrites: "unknown", note: "未实测。" },
      save: "企业校招微站 + 站内投递。",
      submitEvidence: "投递记录。",
      limits: "按企业设置。",
      controls: [],
      tips: [],
      agentNotes: []
    },
    {
      id: "dajie",
      name: "大街网",
      family: "job-board",
      confidence: "unverified",
      match: [{ host: "(^|\\.)dajie\\.com$" }],
      signals: [],
      login: "未核实。",
      parse: { supported: null, overwrites: "unknown", note: "未实测。" },
      save: "未核实。",
      submitEvidence: "未核实。",
      limits: "未核实。",
      controls: [],
      tips: [],
      agentNotes: []
    },
    {
      id: "boss",
      name: "BOSS 直聘",
      family: "job-board",
      confidence: "partial",
      match: [{ host: "(^|\\.)zhipin\\.com$" }],
      signals: [],
      login: "手机验证码或微信扫码。",
      parse: { supported: false, overwrites: "low", note: "沟通式投递，不是表单网申。" },
      save: "—",
      submitEvidence: "聊天记录。",
      limits: "每日沟通数有上限。",
      controls: [],
      tips: ["这里是沟通投递，不需要填表"],
      agentNotes: []
    },
    {
      id: "dayee",
      name: "大易（用友大易）",
      family: "ats",
      confidence: "partial",
      match: [{ host: "(^|\\.)dayee\\.com$" }],
      signals: [],
      login: "微信登录为主。",
      parse: { supported: true, overwrites: "high", note: "解析会把部门当职位、把研究或学生工作当企业、把多个项目合成一个，需要逐段拆回。" },
      save: "分区编辑保存；首次保存会进入预览，保存成功不代表提交。",
      submitEvidence: "“我的投递”显示“投递成功”和投递时间。",
      limits: "常要求中文简历完整度 100%。",
      controls: [
        "分区用数字 ID，定位要用属性选择器。",
        "下拉有展开动画，连续点击可能选中相邻项。",
        "日历弹层可直接输入，旧弹层收起时也可能被匹配到。"
      ],
      tips: [
        "解析常把部门当职位、把多个项目合并，逐段拆回",
        "下拉选完读回显示值",
        "保存成功只是保存，提交要在职位页单独确认"
      ],
      agentNotes: ["仅有年月的奖项在名称里标注年月，不编具体日期。"]
    },
    {
      id: "kuaishou",
      name: "快手校招",
      family: "self-built",
      confidence: "unverified",
      match: [{ host: "^campus\\.kuaishou\\.cn$" }],
      signals: [],
      login: "手机验证码。",
      parse: { supported: null, overwrites: "unknown", note: "未实测。" },
      save: "在线简历 + 岗位投递。",
      submitEvidence: "投递记录。",
      limits: "常见投递志愿上限。",
      controls: [],
      tips: ["投递名额有限，先选准岗位"],
      agentNotes: []
    },
    {
      id: "xiaomi",
      name: "小米招聘",
      family: "self-built",
      confidence: "partial",
      match: [{ host: "^hr\\.xiaomi\\.com$" }],
      signals: [],
      login: "小米账号。",
      parse: { supported: null, overwrites: "unknown", note: "未实测。" },
      save: "在线简历 + 投递。",
      submitEvidence: "投递记录。",
      limits: "按项目设置。",
      controls: [],
      tips: [],
      agentNotes: []
    },
    {
      id: "ctrip",
      name: "携程招聘",
      family: "self-built",
      confidence: "partial",
      match: [{ host: "^(careers|job)\\.ctrip\\.com$" }],
      signals: [],
      login: "手机或邮箱。",
      parse: { supported: true, overwrites: "high", note: "页面明示“上传简历解析后覆盖历史简历信息”。" },
      save: "在线简历 + 岗位申请。",
      submitEvidence: "投递记录。",
      limits: "按项目设置。",
      controls: [],
      tips: ["已填好的简历不要再上传，会覆盖历史信息"],
      agentNotes: []
    },
    {
      id: "midea",
      name: "美的招聘",
      family: "self-built",
      confidence: "unverified",
      match: [{ host: "^careers\\.midea\\.com$" }],
      signals: [],
      login: "未核实。",
      parse: { supported: null, overwrites: "unknown", note: "未实测。" },
      save: "校招入口 /schoolOut。",
      submitEvidence: "投递记录。",
      limits: "未核实。",
      controls: [],
      tips: [],
      agentNotes: []
    },
    {
      id: "cvte",
      name: "视源股份校招",
      family: "self-built",
      confidence: "unverified",
      match: [{ host: "^campus\\.cvte\\.com$" }],
      signals: [],
      login: "未核实。",
      parse: { supported: null, overwrites: "unknown", note: "未实测。" },
      save: "未核实。",
      submitEvidence: "未核实。",
      limits: "未核实。",
      controls: [],
      tips: [],
      agentNotes: []
    },
    {
      id: "sfexpress",
      name: "顺丰校园招聘",
      family: "self-built",
      confidence: "verified",
      match: [{ host: "^campus\\.sf-express\\.com$" }],
      signals: [],
      login: "手机验证码，伴随极验行为验证，只能本人完成。",
      parse: { supported: null, overwrites: "unknown", note: "未实测。" },
      save: "SPA（路由前缀 /cr/）。",
      submitEvidence: "投递记录。",
      limits: "未核实。",
      controls: [],
      tips: ["登录有行为验证码，由本人完成"],
      agentNotes: []
    },
    {
      id: "pingan",
      name: "中国平安校园招聘",
      family: "self-built",
      confidence: "verified",
      match: [{ host: "^campus\\.pingan\\.com$" }],
      signals: [],
      login: "手机验证码，伴随极验行为验证。",
      parse: { supported: null, overwrites: "unknown", note: "未实测。" },
      save: "页面配置驱动。",
      submitEvidence: "投递记录。",
      limits: "未核实。",
      controls: [],
      tips: ["登录有行为验证码，由本人完成"],
      agentNotes: []
    },
    {
      id: "citicbank",
      name: "中信银行招聘",
      family: "bank-soe",
      confidence: "verified",
      match: [{ host: "^job\\.citicbank\\.com$" }],
      signals: [],
      login: "账号密码；登录态存在 sessionStorage，新开标签页会丢失。",
      parse: { supported: false, overwrites: "low", note: "手填简历，无解析。" },
      save: "简历在同源 iframe 中，按块（教育/实习/在校/语言…）添加并保存。",
      submitEvidence: "投递记录页出现岗位。",
      limits: "银行类常限志愿数。",
      controls: [
        "先把需要的空条目一次加完再填，之后再“添加”会重渲染并冲掉已填内容。",
        "表单用 BootstrapValidator 和自建数据模型，纯脚本赋值不更新模型，需要逐字段触发输入事件。",
        "日期框只认真实键盘输入 yyyy-mm-dd。",
        "学校、国家是 select2 搜索框：点开后输入并回车选第一项。",
        "个人中心“我的简历”会弹身份选择，选“我是校招用户”；每次点击都会重载 iframe。"
      ],
      tips: [
        "需要几条经历就先一次性添加几条，再逐条填写",
        "日期请用键盘输入 yyyy-mm-dd",
        "别新开标签页，登录态只在当前标签",
        "点“我的简历”会重载表单，先保存再切换"
      ],
      agentNotes: ["保存请求为 /recruitportal/api/info/v1/draft，“保存成功”提示才是证据。"]
    },
    {
      id: "spdb",
      name: "浦发银行招聘",
      family: "bank-soe",
      confidence: "verified",
      match: [{ host: "^job\\.spdb\\.com\\.cn$" }],
      signals: [],
      login: "账号登录；约 15 分钟无请求会话过期。",
      parse: { supported: false, overwrites: "low", note: "手填。" },
      save: "“我的基本资料”和“校招简历”是两套表；每条经历先点“编辑”展开，保存按钮叫“修改”。",
      submitEvidence: "投递记录。",
      limits: "银行类常限志愿数。",
      controls: [
        "基本资料要先上传头像照片（提示“图片上传成功”）才能保存。",
        "学校、专业、生源地是弹窗选择器：搜索后点选项。",
        "WdatePicker 日期框可直接写 yyyy-MM-dd 并触发 change。",
        "奖学金类奖励的名称会固定为“奖学金”，具体名称写在“原因”里。",
        "保存后旧表单仍显示，再填下一条前要重新载入页面，否则会改到已存记录。",
        "家庭成员的出生年月为必填。"
      ],
      tips: [
        "每填完一条就保存，15 分钟不操作会掉线",
        "基本资料先传照片才能保存",
        "保存后先刷新再填下一条，避免改到旧记录",
        "家庭成员需要出生年月"
      ],
      agentNotes: ["左侧步骤导航用坐标点击更可靠。"]
    },
    {
      id: "abchina",
      name: "中国农业银行招聘",
      family: "bank-soe",
      confidence: "partial",
      match: [{ host: "^career\\.abchina\\.com$" }],
      signals: [],
      login: "账号登录。",
      parse: { supported: false, overwrites: "low", note: "手填。" },
      save: "按 .ant-card 模块编辑并保存；字段已填不等于已保存。",
      submitEvidence: "成功提示或总览新增记录。",
      limits: "银行类常限志愿数。",
      controls: [
        "日期输入只读，要在 Ant Design 日历里点 td[title='YYYY年M月D日']。",
        "学生干部职务级别为校级/学院级/系级，职责最多 100 字。",
        "下拉会触发重绘，保存按钮可能消失，按当前模块重新定位。"
      ],
      tips: ["日期要在日历里点选", "学生干部职责最多 100 字", "以成功提示或总览新增记录确认保存"],
      agentNotes: []
    },
    {
      id: "chinahr",
      name: "中智 / 中国银行网申（chinahr）",
      family: "bank-soe",
      confidence: "partial",
      match: [{ host: "^(applyjob|campus)\\.chinahr\\.com$" }],
      signals: [],
      login: "账号登录。",
      parse: { supported: false, overwrites: "low", note: "手填。" },
      save: "教育与实践经历都是单条独立编辑页，底部“保存”只保存当前条目。",
      submitEvidence: "投递记录；个人简历页的“同步”会更新全部应聘记录，慎用。",
      limits: "银行类常限志愿数。",
      controls: [
        "单位名称约 30 字、城市 15 字、职责 30 字等短上限，职位避免 & 等特殊字符。",
        "“是否至今”和“正式工作”是独立单选，已结束的学生实习都选否。",
        "日期按年、月、日三列逐项选择，月末天数随年月变化。",
        "“内容与收获”要点占位文字打开弹层，弹层“提交”只回填，还要点底部“保存”。"
      ],
      tips: [
        "弹层里的“提交”只是回填，底部“保存”才保存",
        "短栏字数很紧，长内容写进描述",
        "“同步”会改动全部应聘记录，慎点"
      ],
      agentNotes: []
    },
    {
      id: "icbc",
      name: "中国工商银行招聘",
      family: "bank-soe",
      confidence: "partial",
      match: [{ host: "^job\\.icbc\\.com\\.cn$" }],
      signals: [],
      login: "注册账号并实名验证。",
      parse: { supported: null, overwrites: "unknown", note: "未实测。" },
      save: "未核实。",
      submitEvidence: "投递记录。",
      limits: "银行类常限志愿数。",
      controls: [],
      tips: ["实名环节由本人完成"],
      agentNotes: []
    },
    {
      id: "iguopin",
      name: "国聘",
      family: "bank-soe",
      confidence: "partial",
      match: [{ host: "(^|\\.)iguopin\\.com$" }],
      signals: [],
      login: "注册账号与手机验证码。",
      parse: { supported: null, overwrites: "unknown", note: "未实测。" },
      save: "站内在线简历 + 职位投递，部分岗位跳转企业系统。",
      submitEvidence: "投递记录。",
      limits: "央国企岗位常有限投规则。",
      controls: [],
      tips: ["部分岗位会跳转到企业自己的系统"],
      agentNotes: []
    },
    {
      id: "campus-portal",
      name: "高校就业网",
      family: "info-only",
      confidence: "partial",
      match: [{ host: "(^|\\.)bysjy\\.com\\.cn$" }, { host: "(^|\\.)91wllm\\.cn$" }, { host: "(^|\\.)edu\\.cn$" }],
      signals: [],
      login: "学校统一认证。",
      parse: { supported: false, overwrites: "low", note: "—" },
      save: "—",
      submitEvidence: "—",
      limits: "—",
      controls: [],
      tips: ["这里通常只是招聘信息，找到企业真实网申链接再填"],
      agentNotes: []
    },
    {
      id: "gov-exam",
      name: "公务员 / 事业单位报名",
      family: "bank-soe",
      confidence: "unverified",
      match: [{ host: "(^|\\.)gov\\.cn$" }, { host: "(^|\\.)rsks\\.[a-z0-9.-]+$" }],
      signals: [],
      login: "实名注册、证件与人脸核验。",
      parse: { supported: false, overwrites: "low", note: "不适用。" },
      save: "报名表 + 资格审核。",
      submitEvidence: "报名确认页。",
      limits: "通常限报 1 个岗位。",
      controls: [],
      tips: ["实名与承诺事项由本人逐项完成"],
      agentNotes: []
    },
    {
      id: "phenom",
      name: "Phenom 招聘站（外企）",
      family: "foreign-ats",
      confidence: "partial",
      match: [{ host: "(^|\\.)phenompeople\\.com$" }, { host: "^careers\\.pg\\.com\\.cn$" }],
      signals: [],
      login: "邮箱注册账号或第三方登录。",
      parse: { supported: true, overwrites: "medium", note: "上传后解析预填。" },
      save: "多步申请流程，常带在线测评链接。",
      submitEvidence: "确认邮件或申请列表。",
      limits: "同一轮校招常限投 N 个岗位。",
      controls: [],
      tips: ["注册账号由本人完成", "提交后留意测评邮件"],
      agentNotes: []
    },
    {
      id: "workday",
      name: "Workday 招聘站",
      family: "foreign-ats",
      confidence: "unverified",
      match: [{ host: "(^|\\.)myworkdayjobs\\.com$" }, { host: "(^|\\.)myworkdaysite\\.com$" }],
      signals: ["[data-automation-id]"],
      login: "每个租户独立注册（邮箱 + 密码）。",
      parse: { supported: true, overwrites: "medium", note: "上传简历后预填，需要核对。" },
      save: "多页向导：我的信息 / 经历 / 申请问题 / 自愿披露 / 确认。",
      submitEvidence: "申请列表。",
      limits: "按租户设置。",
      controls: ["data-automation-id 属性稳定。"],
      tips: ["每个公司要单独注册账号"],
      agentNotes: []
    },
    {
      id: "successfactors",
      name: "SAP SuccessFactors",
      family: "foreign-ats",
      confidence: "unverified",
      match: [{ host: "(^|\\.)successfactors\\.(com|eu|cn)$" }, { host: "(^|\\.)sapsf\\.(com|cn)$" }],
      signals: [],
      login: "注册账号。",
      parse: { supported: true, overwrites: "unknown", note: "未实测。" },
      save: "多步表单。",
      submitEvidence: "申请列表。",
      limits: "按租户设置。",
      controls: [],
      tips: [],
      agentNotes: []
    },
    {
      id: "foreign-ats-other",
      name: "其他外企 ATS（Greenhouse / Lever / Taleo 等）",
      family: "foreign-ats",
      confidence: "unverified",
      match: [
        { host: "(^|\\.)taleo\\.net$" },
        { host: "(^|\\.)icims\\.com$" },
        { host: "(^|\\.)greenhouse\\.io$" },
        { host: "(^|\\.)lever\\.co$" },
        { host: "(^|\\.)avature\\.net$" },
        { host: "(^|\\.)smartrecruiters\\.com$" },
        { host: "(^|\\.)eightfold\\.ai$" }
      ],
      signals: [],
      login: "多数需要注册；Greenhouse / Lever 可免注册填表。",
      parse: { supported: true, overwrites: "unknown", note: "未实测。" },
      save: "单页（Greenhouse/Lever）或多步（Taleo/Oracle）。",
      submitEvidence: "确认页或邮件。",
      limits: "按租户设置。",
      controls: [],
      tips: [],
      agentNotes: []
    },
    {
      id: "wechat-article",
      name: "微信公众号文章",
      family: "info-only",
      confidence: "partial",
      match: [{ host: "^mp\\.weixin\\.qq\\.com$" }],
      signals: [],
      login: "无需。",
      parse: { supported: false, overwrites: "low", note: "—" },
      save: "—",
      submitEvidence: "—",
      limits: "—",
      controls: [],
      tips: ["这是招聘公告，按文末链接进入官方网申"],
      agentNotes: []
    },
    {
      id: "aggregator",
      name: "校招信息聚合站",
      family: "info-only",
      confidence: "unverified",
      match: [
        { host: "(^|\\.)wondercv\\.com$" },
        { host: "(^|\\.)xiaozhaobao\\.com\\.cn$" },
        { host: "(^|\\.)shushuqiuzhi\\.com$" },
        { host: "(^|\\.)niuqizp\\.com$" },
        { host: "(^|\\.)yingjiesheng\\.com$" }
      ],
      signals: [],
      login: "—",
      parse: { supported: false, overwrites: "low", note: "—" },
      save: "—",
      submitEvidence: "—",
      limits: "—",
      controls: [],
      tips: ["不要在聚合站上传简历或填写个人信息，找到企业官方入口再填"],
      agentNotes: []
    }
  ];

  const compiled = PLATFORMS.map((platform) => ({
    platform,
    rules: platform.match.map((rule) => ({
      host: rule.host ? new RegExp(rule.host, "i") : null,
      path: rule.path ? new RegExp(rule.path, "i") : null,
      weak: Boolean(rule.weak)
    }))
  }));

  function parseUrl(value) {
    try {
      const parsed = new URL(String(value || ""));
      return /^https?:$/.test(parsed.protocol) ? parsed : null;
    } catch {
      return null;
    }
  }

  function summarize(platform, matchedBy, confidence) {
    return {
      id: platform.id,
      name: platform.name,
      family: platform.family,
      familyLabel: FAMILIES[platform.family] || "",
      confidence,
      matchedBy
    };
  }

  function detectPlatform(url, signals = []) {
    const parsed = parseUrl(url);
    const hostname = parsed ? parsed.hostname : "";
    const pathname = parsed ? `${parsed.pathname}${parsed.hash ? parsed.hash.replace(/^#/, "/") : ""}` : "";

    // 同一域名下可能有多条规则（北森新旧版、51job 两版）：带路径的规则更具体，优先。
    let best = null;
    for (const { platform, rules } of compiled) {
      for (const rule of rules) {
        if (rule.weak || !rule.host || !hostname) continue;
        if (!rule.host.test(hostname)) continue;
        if (rule.path && !rule.path.test(pathname)) continue;
        const specificity = rule.path ? 2 : 1;
        if (!best || specificity > best.specificity) {
          best = { platform, specificity };
        }
      }
    }
    if (best) {
      return summarize(best.platform, "host", best.specificity === 2 ? 0.97 : 0.93);
    }

    const signalSet = new Set((Array.isArray(signals) ? signals : []).map(String));
    if (signalSet.size > 0) {
      for (const { platform } of compiled) {
        if ((platform.signals || []).some((selector) => signalSet.has(selector))) {
          return summarize(platform, "signal", 0.8);
        }
      }
    }

    for (const { platform, rules } of compiled) {
      for (const rule of rules) {
        if (rule.weak && rule.path && rule.path.test(pathname)) {
          return summarize(platform, "path", 0.7);
        }
      }
    }
    return null;
  }

  function getPlatform(id) {
    return PLATFORMS.find((platform) => platform.id === String(id || "")) || null;
  }

  function listPlatforms() {
    return PLATFORMS.slice();
  }

  function getFingerprintSelectors() {
    return Array.from(new Set(PLATFORMS.flatMap((platform) => platform.signals || [])));
  }

  function getPlatformGuide(idOrUrl, signals = []) {
    const raw = String(idOrUrl || "");
    const platform = getPlatform(raw) || (() => {
      const detected = /^https?:/i.test(raw) ? detectPlatform(raw, signals) : null;
      return detected ? getPlatform(detected.id) : null;
    })();
    return {
      platform: platform
        ? {
            id: platform.id,
            name: platform.name,
            family: platform.family,
            familyLabel: FAMILIES[platform.family] || "",
            confidence: platform.confidence,
            login: platform.login,
            parse: platform.parse,
            save: platform.save,
            submitEvidence: platform.submitEvidence,
            limits: platform.limits,
            controls: platform.controls.slice()
          }
        : null,
      tips: platform ? platform.tips.slice() : [],
      agentNotes: platform ? [...platform.controls, ...platform.agentNotes] : [],
      generalRules: GENERAL_RULES.map((rule) => rule.text)
    };
  }

  return {
    FAMILIES,
    GENERAL_RULES,
    detectPlatform,
    getPlatform,
    getPlatformGuide,
    getFingerprintSelectors,
    listPlatforms
  };
});

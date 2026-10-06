(function attachForm2OfferJobInsight(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.Form2OfferJobInsight = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createForm2OfferJobInsight() {
  "use strict";

  // 岗位速读：只用本地规则，不调用 AI、不上传 JD。
  // 目的是“有效投递”——先看岗位类型和硬门槛，再决定投不投、用哪份简历。

  const JOB_FAMILIES = Object.freeze([
    { id: "sales", label: "销售 / 客户发展", keywords: ["销售", "客户经理", "大客户", "渠道", "商务拓展", "业务拓展", "BD", "KA", "招商", "客户关系", "客户开发", "理财经理", "财富顾问", "营销经理", "动销", "市场拓展", "客户发展"] },
    { id: "bank-frontline", label: "银行网点 / 零售金融", keywords: ["柜员", "综合柜员", "大堂", "厅堂", "营业网点", "支行", "零售业务", "对公业务", "营业部"] },
    { id: "operations", label: "运营 / 电商", keywords: ["运营", "电商", "用户增长", "内容运营", "社群", "活动运营", "商家运营", "店铺", "直播", "私域"] },
    { id: "data", label: "数据分析 / 商业分析", keywords: ["数据分析", "商业分析", "经营分析", "BI", "数据运营", "数据洞察", "分析师", "数据支持", "报表", "SQL"] },
    { id: "product", label: "产品", keywords: ["产品经理", "产品助理", "产品运营", "需求分析", "产品规划", "PRD", "产品设计"] },
    { id: "ai-application", label: "AI 应用 / 大模型", keywords: ["AI", "大模型", "AIGC", "智能体", "Agent", "LLM", "提示词", "知识库", "智能客服", "Gen AI", "人工智能"] },
    { id: "marketing", label: "市场 / 品牌", keywords: ["市场", "品牌", "营销", "公关", "媒介", "消费者洞察", "市场推广", "广告", "传播"] },
    { id: "supply-chain", label: "供应链 / 物流", keywords: ["供应链", "物流", "采购", "计划", "仓储", "货品", "供应商", "生产计划", "库存"] },
    { id: "finance-middle", label: "金融中后台 / 风控研究", keywords: ["风控", "风险", "合规", "授信", "信贷", "资管", "投研", "研究员", "投资", "托管", "清算", "信用卡", "固收"] },
    { id: "accounting", label: "财务 / 审计", keywords: ["财务", "会计", "审计", "税务", "出纳", "成本"] },
    { id: "hr-admin", label: "人力 / 行政", keywords: ["人力资源", "HR", "招聘专员", "行政", "培训专员", "薪酬"] },
    { id: "management-trainee", label: "管培生 / 储备干部", keywords: ["管培", "管理培训生", "储备干部", "培训生", "储备人才", "Trainee", "储备生"] },
    { id: "consulting-research", label: "咨询 / 研究", keywords: ["咨询", "产业研究", "行业研究", "战略", "研究助理"] },
    { id: "tech-rd", label: "技术研发", keywords: ["开发", "研发", "算法", "工程师", "测试", "前端", "后端", "Java", "C++", "硬件", "芯片", "嵌入式", "运维", "架构"] },
    { id: "design", label: "设计", keywords: ["设计师", "UI", "UX", "视觉设计", "工业设计", "交互设计"] },
    { id: "customer-service", label: "客服 / 客户服务", keywords: ["客服", "客户服务", "呼叫中心", "坐席"] }
  ]);

  const CHINESE_NUMBERS = { 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };
  const DEGREE_RANK = { bachelor: 1, master: 2, phd: 3 };
  const DEGREE_LABEL = { bachelor: "本科", master: "硕士", phd: "博士" };
  const SCHOOL_TIER_RANK = { other: 0, "double-first-class": 1, "211": 2, "985": 3 };

  function normalize(value) {
    return String(value == null ? "" : value).replace(/ /g, " ").replace(/[ \t]+/g, " ").trim();
  }

  function splitSentences(text) {
    // 按逗号也切开：门槛的“必须/优先”只看所在分句，避免“本科及以上，金融专业优先”把学历误判为优先。
    return normalize(text).split(/[。；;！!\n，,]+/).map((part) => part.trim()).filter(Boolean);
  }

  function countKeywordHits(text, keywords) {
    const lower = text.toLowerCase();
    const hits = keywords.filter((keyword) => {
      const needle = keyword.toLowerCase();
      if (/^[a-z+]+$/i.test(keyword)) {
        return new RegExp(`(^|[^a-z])${needle.replace(/[+]/g, "\\+")}([^a-z]|$)`, "i").test(lower);
      }
      return lower.includes(needle);
    });
    // “管理培训生”命中时不再重复计“培训生”。
    return hits.filter((hit) => !hits.some((other) => other !== hit && other.includes(hit)));
  }

  // 管培、储备干部只说明招聘形式；有实际业务方向时以业务方向为主。
  function pickPrimaryFamily(families) {
    if (families.length === 0) return null;
    const [first] = families;
    if (first.id !== "management-trainee") return first;
    const substantive = families.find((family) => family.id !== "management-trainee");
    return substantive && substantive.score * 2 >= first.score ? substantive : first;
  }

  function classifyFamilies(text, title) {
    const scored = JOB_FAMILIES.map((family) => {
      const titleHits = title ? countKeywordHits(title, family.keywords) : [];
      const bodyHits = countKeywordHits(text, family.keywords);
      return {
        id: family.id,
        label: family.label,
        score: titleHits.length * 3 + bodyHits.length,
        hits: Array.from(new Set([...titleHits, ...bodyHits])).slice(0, 6)
      };
    }).filter((family) => family.score > 0);
    return scored.sort((left, right) => right.score - left.score);
  }

  function detectSchoolTier(sentences) {
    for (const sentence of sentences) {
      if (!/985|211|双一流|C9|QS\s*前?\s*\d+|顶尖高校|名校/.test(sentence)) continue;
      const needs = /985/.test(sentence) && !/211/.test(sentence)
        ? "985"
        : /211/.test(sentence)
          ? "211"
          : /双一流/.test(sentence) ? "double-first-class" : "985";
      return {
        type: "school-tier",
        level: /优先|加分|更佳|为佳/.test(sentence) ? "preferred" : "required",
        value: needs,
        text: sentence.slice(0, 80)
      };
    }
    return null;
  }

  function detectDegree(sentences) {
    const checks = [
      { value: "phd", pattern: /(仅限|要求|须|需)?博士(研究生)?(及以上|学历|学位)?/ , guard: /博士/ },
      { value: "master", pattern: /硕士(研究生)?(及以上|以上|学历)|研究生及以上/ },
      { value: "bachelor", pattern: /本科(及以上|以上|学历)/ }
    ];
    for (const check of checks) {
      for (const sentence of sentences) {
        if (check.value === "phd" && !(/博士/.test(sentence) && /仅限|要求|须|需|及以上|学历|学位/.test(sentence) && !/硕士/.test(sentence))) continue;
        if (check.pattern.test(sentence)) {
          return {
            type: "degree",
            level: /优先/.test(sentence) ? "preferred" : "required",
            value: check.value,
            text: sentence.slice(0, 80)
          };
        }
      }
    }
    return null;
  }

  function detectEnglish(sentences) {
    for (const sentence of sentences) {
      const score = sentence.match(/(?:英语|英文|CET)[^\d。；\n]{0,6}?(?:六级|6级|CET-?6|四级|4级|CET-?4)?[^\d。；\n]{0,6}?(\d{3})\s*分/i);
      if (score) {
        return {
          type: "english",
          level: /优先|加分/.test(sentence) ? "preferred" : "required",
          value: Number(score[1]),
          text: sentence.slice(0, 80)
        };
      }
      if (/(英语|英文)[^。；\n]{0,8}(工作语言|流利|熟练|母语|口语)|雅思|托福|IELTS|TOEFL/i.test(sentence)) {
        return {
          type: "english",
          level: /优先|加分/.test(sentence) ? "preferred" : "required",
          value: null,
          text: sentence.slice(0, 80)
        };
      }
    }
    return null;
  }

  function detectMajor(sentences) {
    for (const sentence of sentences) {
      if (!/专业/.test(sentence) || /专业不限|不限专业/.test(sentence)) continue;
      const match = sentence.match(/([一-龥、，,/]{2,40}?)(?:等)?(?:相关)?专业/);
      if (!match) continue;
      const fields = match[1].replace(/^(任职要求|岗位要求|要求|具备|具有)/, "").trim();
      if (!fields || /^(所学|本|该|相关|以上)$/.test(fields)) continue;
      return {
        type: "major",
        level: /优先|加分/.test(sentence) ? "preferred" : "required",
        value: fields,
        text: sentence.slice(0, 80)
      };
    }
    return null;
  }

  function detectClassYears(text) {
    const years = new Set();
    for (const match of normalize(text).matchAll(/(20\d{2})\s*届/g)) {
      years.add(Number(match[1]));
    }
    for (const match of normalize(text).matchAll(/(?<!\d)(2\d)\s*(?:届|秋招|春招|校招)/g)) {
      years.add(2000 + Number(match[1]));
    }
    return Array.from(years).sort();
  }

  function detectApplyLimit(text) {
    const match = normalize(text).match(/(?:每人|每位(?:同学|候选人|申请人|求职者)?|最多|限)[^。；\n]{0,12}?(?:投递|申请|选择|报名|投|报|选)[^。；\n\d一二两三四五六]{0,6}?(\d+|[一二两三四五六])\s*(?:个|项|次)/);
    if (!match) return null;
    const raw = match[1];
    const value = /^\d+$/.test(raw) ? Number(raw) : CHINESE_NUMBERS[raw];
    return value > 0 && value < 50 ? value : null;
  }

  function analyzeJobText(text, options = {}) {
    const body = normalize(text);
    const title = normalize(options.title || "");
    const sentences = splitSentences(body);
    const families = classifyFamilies(body, title);
    const requirements = [detectSchoolTier(sentences), detectDegree(sentences), detectEnglish(sentences), detectMajor(sentences)].filter(Boolean);
    const experience = body.match(/(\d+)\s*年(?:以上|及以上)?(?:的)?(?:相关)?(?:工作)?经验/);
    return {
      title,
      families,
      primaryFamily: pickPrimaryFamily(families),
      requirements,
      classYears: detectClassYears(body),
      applyLimit: detectApplyLimit(body),
      flags: {
        internship: /实习生|日常实习|暑期实习|实习岗/.test(`${title} ${body}`) && !/校招|秋招|应届|管培/.test(title),
        socialRecruit: Boolean(experience && Number(experience[1]) >= 1),
        relocation: /(服从|接受|适应)[^。；\n]{0,6}(全国|异地|调配|调剂|分配|轮岗|外派)/.test(body),
        languageBonus: (body.match(/粤语|日语|韩语|德语|法语|西班牙语|小语种/g) || []).filter((value, index, list) => list.indexOf(value) === index)
      }
    };
  }

  function hasCandidateValue(candidate, key) {
    const value = candidate?.[key];
    return Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null && value !== "";
  }

  function assessRequirements(analysis, candidate = {}) {
    const items = [];
    const result = (item) => items.push(item);

    for (const requirement of analysis?.requirements || []) {
      if (requirement.type === "school-tier") {
        if (!hasCandidateValue(candidate, "schoolTier")) {
          result({ type: requirement.type, status: "unknown", text: `院校要求：${requirement.text}` });
          continue;
        }
        const meets = (SCHOOL_TIER_RANK[candidate.schoolTier] ?? 0) >= (SCHOOL_TIER_RANK[requirement.value] ?? 3);
        result({
          type: requirement.type,
          status: meets ? "ok" : requirement.level === "required" ? "block" : "risk",
          text: `${requirement.level === "required" ? "院校硬门槛" : "院校偏好"}：${requirement.text}`
        });
      } else if (requirement.type === "degree") {
        if (!hasCandidateValue(candidate, "degree")) {
          result({ type: requirement.type, status: "unknown", text: `学历要求：${DEGREE_LABEL[requirement.value]}及以上` });
          continue;
        }
        const meets = (DEGREE_RANK[candidate.degree] || 0) >= DEGREE_RANK[requirement.value];
        result({
          type: requirement.type,
          status: meets ? "ok" : requirement.level === "required" ? "block" : "risk",
          text: `学历要求：${DEGREE_LABEL[requirement.value]}及以上`
        });
      } else if (requirement.type === "english") {
        if (requirement.value == null) {
          result({ type: requirement.type, status: hasCandidateValue(candidate, "englishScore") ? "risk" : "unknown", text: `英语要求：${requirement.text}` });
          continue;
        }
        if (!hasCandidateValue(candidate, "englishScore")) {
          result({ type: requirement.type, status: "unknown", text: `英语分数线 ${requirement.value}` });
          continue;
        }
        const meets = Number(candidate.englishScore) >= requirement.value;
        result({
          type: requirement.type,
          status: meets ? "ok" : requirement.level === "required" ? "block" : "risk",
          text: `英语分数线 ${requirement.value}（本人 ${candidate.englishScore}）`
        });
      } else if (requirement.type === "major") {
        if (!hasCandidateValue(candidate, "majorKeywords")) {
          result({ type: requirement.type, status: "unknown", text: `专业要求：${requirement.value}` });
          continue;
        }
        const meets = candidate.majorKeywords.some((keyword) => keyword && requirement.value.includes(keyword));
        result({
          type: requirement.type,
          status: meets ? "ok" : "risk",
          text: `专业要求：${requirement.value}`
        });
      }
    }

    if ((analysis?.classYears || []).length > 0) {
      if (!hasCandidateValue(candidate, "classYear")) {
        result({ type: "class-year", status: "unknown", text: `面向 ${analysis.classYears.join("、")} 届` });
      } else {
        result({
          type: "class-year",
          status: analysis.classYears.includes(Number(candidate.classYear)) ? "ok" : "block",
          text: `面向 ${analysis.classYears.join("、")} 届`
        });
      }
    }
    if (analysis?.flags?.socialRecruit) {
      result({ type: "experience", status: "risk", text: "要求正式工作经验，可能是社招岗位" });
    }
    if (analysis?.flags?.internship) {
      result({ type: "internship", status: "info", text: "实习岗位，不是正式校招" });
    }
    if (analysis?.flags?.relocation) {
      result({ type: "relocation", status: "info", text: "需接受调配或异地分配" });
    }
    if (analysis?.applyLimit) {
      result({ type: "apply-limit", status: "info", text: `每人限投 ${analysis.applyLimit} 个，提交前选准岗位` });
    }

    const graded = items.filter((item) => item.status !== "info");
    let verdict = "ok";
    if (graded.some((item) => item.status === "block")) verdict = "block";
    else if (graded.some((item) => item.status === "risk")) verdict = "risk";
    else if (graded.length > 0 && graded.every((item) => item.status === "unknown")) verdict = "unknown";
    else if (graded.length === 0 && Object.keys(candidate || {}).length === 0) verdict = "unknown";
    return { verdict, items };
  }

  function recommendResumeVersion(analysis, versions, text = "") {
    const list = Array.isArray(versions) ? versions : [];
    if (list.length === 0 || !analysis) return null;
    const familyScores = new Map((analysis.families || []).map((family) => [family.id, family.score]));
    const haystack = `${analysis.title || ""} ${normalize(text)}`;
    let best = null;
    for (const version of list) {
      const familyMatches = (version.families || []).filter((family) => familyScores.has(family));
      const keywordMatches = countKeywordHits(haystack, version.keywords || []);
      const score = familyMatches.reduce((sum, family) => sum + familyScores.get(family) * 2, 0) + keywordMatches.length;
      if (score > 0 && (!best || score > best.score)) {
        best = {
          id: version.id,
          label: version.label,
          score,
          reason: [
            familyMatches.length ? `岗位族匹配：${familyMatches.map((id) => JOB_FAMILIES.find((family) => family.id === id)?.label || id).join("、")}` : "",
            keywordMatches.length ? `关键词：${keywordMatches.slice(0, 5).join("、")}` : ""
          ].filter(Boolean).join("；")
        };
      }
    }
    return best;
  }

  function splitList(value) {
    return String(value || "").split(/[,，、]/).map((item) => item.trim()).filter(Boolean);
  }

  function parseResumeVersionLines(text) {
    return String(text || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => line.split("|").map((part) => part.trim()))
      .filter((parts) => parts[0] && parts[1])
      .slice(0, 60)
      .map(([id, label, families, keywords]) => ({
        id: id.slice(0, 40),
        label: label.slice(0, 80),
        families: splitList(families).filter((family) => JOB_FAMILIES.some((item) => item.id === family)),
        keywords: splitList(keywords).slice(0, 30)
      }));
  }

  function formatResumeVersionLines(versions) {
    return (Array.isArray(versions) ? versions : [])
      .map((version) => {
        const parts = [version.id, version.label, (version.families || []).join(","), (version.keywords || []).join(",")];
        while (parts.length > 2 && !parts[parts.length - 1]) parts.pop();
        return parts.join(" | ");
      })
      .join("\n");
  }

  return {
    JOB_FAMILIES,
    analyzeJobText,
    assessRequirements,
    recommendResumeVersion,
    parseResumeVersionLines,
    formatResumeVersionLines
  };
});

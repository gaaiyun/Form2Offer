(function attachForm2OfferAnswerLibrary(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.Form2OfferAnswerLibrary = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createAnswerLibrary() {
  "use strict";

  const MAX_ANSWER_LIBRARY_ITEMS = 300;
  const OPEN_QUESTION_PATTERN = /为什么|为何|原因|动机|请.{0,8}(?:描述|说明|分享|介绍|举例|阐述|简述|填写)|谈谈|说说|如何看待|怎么看|理解|看法|认识|职业规划|未来规划|发展规划|优点|缺点|优势|不足|特长|兴趣|期望|目标|计划|挑战|困难|成功|失败|收获|贡献|职责|项目|经历|自我评价|申请理由|选择.{0,8}(?:公司|岗位|职位)|你认为|您认为|最.{0,6}(?:自豪|满意|遗憾)|[?？]/i;
  const PRIVATE_OR_DECLARATION_PATTERN = /身份证|证件号|护照|军官证|手机号|手机号码|联系电话|邮箱|电子邮件|住址|家庭地址|通信地址|户籍|籍贯|出生|生日|婚姻|民族|政治面貌|党员|团员|健康|疾病|残疾|血型|宗教|父亲|母亲|配偶|亲属|家庭成员|紧急联系人|薪资|工资|银行卡|开户|身高|体重|性别|照片|签字|签名|承诺|声明|同意|授权|真实性|服从调剂|违法|犯罪|征信|债务|身份证明|工作许可|国籍|生育|怀孕/i;
  const GENERIC_LABEL_PATTERN = /^(?:请输入|请填写|请回答|回答|补充说明|其他|备注|内容|描述|说明|问题|question|answer)[：:：*＊\s]*$/i;

  function cleanQuestion(value) {
    return String(value == null ? "" : value)
      .replace(/\u00a0/g, " ")
      .replace(/^\s*(?:\d{1,3}[.、)）]|[（(]\d{1,3}[)）])\s*/, "")
      .replace(/\s*[（(]?必填[)）]?\s*/g, " ")
      .replace(/[＊*]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 500);
  }

  function normalizeQuestionKey(value) {
    return cleanQuestion(value)
      .toLocaleLowerCase()
      .replace(/[\s\u3000]+/g, "")
      .replace(/[，,。.!！?？:：;；、"“”'‘’（）()【】\[\]{}<>《》·…—_-]/g, "")
      .slice(0, 500);
  }

  function cleanAnswer(value) {
    return String(value == null ? "" : value)
      .replace(/\r\n?/g, "\n")
      .trim()
      .slice(0, 8000);
  }

  function isEligibleOpenQuestion(question, answer, controlType = "textarea") {
    const clean = cleanQuestion(question);
    const response = cleanAnswer(answer);
    const type = String(controlType || "").toLowerCase();
    if (clean.length < 4 || response.length < 2 || !["textarea", "text", "contenteditable"].includes(type)) {
      return false;
    }
    if (GENERIC_LABEL_PATTERN.test(clean) || PRIVATE_OR_DECLARATION_PATTERN.test(clean)) {
      return false;
    }
    return type === "textarea" || OPEN_QUESTION_PATTERN.test(clean);
  }

  function createAnswerId(questionKey) {
    let hash = 2166136261;
    for (const char of questionKey) {
      hash ^= char.codePointAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return `answer-${(hash >>> 0).toString(36)}`;
  }

  function normalizeAnswerEntry(input = {}, options = {}) {
    const source = input && typeof input === "object" ? input : {};
    const question = cleanQuestion(source.question);
    const answer = cleanAnswer(source.answer);
    const normalizedQuestion = normalizeQuestionKey(question);
    if (!question || !answer || !normalizedQuestion) {
      return null;
    }

    const now = String(options.now || new Date().toISOString());
    return {
      id: String(source.id || createAnswerId(normalizedQuestion)).trim().slice(0, 160),
      question,
      answer,
      normalizedQuestion,
      createdAt: String(source.createdAt || now).slice(0, 40),
      updatedAt: String(source.updatedAt || now).slice(0, 40),
      useCount: Math.max(0, Math.floor(Number(source.useCount) || 0))
    };
  }

  function normalizeAnswerLibrary(input, options = {}) {
    const entries = Array.isArray(input) ? input : [];
    const seen = new Set();
    const normalized = [];
    for (const source of entries) {
      const entry = normalizeAnswerEntry(source, options);
      if (!entry || seen.has(entry.normalizedQuestion)) {
        continue;
      }
      seen.add(entry.normalizedQuestion);
      normalized.push(entry);
      if (normalized.length >= MAX_ANSWER_LIBRARY_ITEMS) {
        break;
      }
    }
    return normalized;
  }

  function mergeAnswerLibrary(existing, candidates, options = {}) {
    const now = String(options.now || new Date().toISOString());
    const current = normalizeAnswerLibrary(existing, { now });
    const byQuestion = new Map(current.map((entry) => [entry.normalizedQuestion, entry]));
    let createdCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;

    for (const candidate of Array.isArray(candidates) ? candidates.slice(0, 100) : []) {
      const incoming = normalizeAnswerEntry(candidate, { now });
      if (!incoming) {
        skippedCount += 1;
        continue;
      }
      const old = byQuestion.get(incoming.normalizedQuestion);
      if (old) {
        if (old.answer !== incoming.answer || old.question !== incoming.question) {
          byQuestion.set(incoming.normalizedQuestion, {
            ...old,
            question: incoming.question,
            answer: incoming.answer,
            updatedAt: now
          });
          updatedCount += 1;
        } else {
          skippedCount += 1;
        }
      } else {
        byQuestion.set(incoming.normalizedQuestion, incoming);
        createdCount += 1;
      }
    }

    const entries = Array.from(byQuestion.values())
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .slice(0, MAX_ANSWER_LIBRARY_ITEMS);
    return { entries, createdCount, updatedCount, skippedCount };
  }

  function findAnswerForQuestion(entries, question) {
    const key = normalizeQuestionKey(question);
    if (!key) {
      return null;
    }
    return normalizeAnswerLibrary(entries).find((entry) => entry.normalizedQuestion === key) || null;
  }

  return {
    MAX_ANSWER_LIBRARY_ITEMS,
    cleanQuestion,
    normalizeQuestionKey,
    cleanAnswer,
    isEligibleOpenQuestion,
    normalizeAnswerEntry,
    normalizeAnswerLibrary,
    mergeAnswerLibrary,
    findAnswerForQuestion
  };
});

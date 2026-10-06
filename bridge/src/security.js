"use strict";

const crypto = require("node:crypto");

const MAX_BODY_BYTES = 1024 * 1024;
const ALLOWED_CONTROL_TYPES = new Set([
  "text", "textarea", "select", "combobox", "radio", "checkbox", "date", "month", "number", "email", "tel", "contenteditable"
]);
const BLOCKED_FIELD_PATTERN = /文件|上传|附件|照片|证件照|验证码|短信码|图形码|提交|申请|确认投递|签名|签字/i;
const SENSITIVE_FIELD_PATTERN = /身份证|证件号|护照|军官证|电话|手机|邮箱|住址|地址|户籍|籍贯|出生|婚姻|民族|政治面貌|党员|团员|健康|疾病|残疾|血型|宗教|家庭|父亲|母亲|配偶|亲属|紧急联系人|薪资|工资|银行卡|身高|体重|性别/i;
const DECLARATION_FIELD_PATTERN = /承诺|声明|同意|授权|真实性|背景调查|背调|违法|犯罪|处罚|失信|征信|竞业|利益冲突|服从调剂|兼职|持股|居留权/i;
const PAGE_INSTRUCTION_PATTERN = /(?:ignore|disregard|override|system prompt|developer message|assistant|tool call|忽略.{0,8}(?:指令|规则)|系统提示|开发者消息|执行命令)/ig;

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function randomPairCode() {
  return crypto.randomInt(100000, 1000000).toString();
}

function hashToken(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function timingSafeTokenMatch(value, expectedHash) {
  const actual = Buffer.from(hashToken(value), "hex");
  const expected = Buffer.from(String(expectedHash || ""), "hex");
  return actual.length === expected.length && actual.length > 0 && crypto.timingSafeEqual(actual, expected);
}

function isAllowedExtensionOrigin(origin) {
  return /^chrome-extension:\/\/[a-p]{32}$/i.test(String(origin || ""));
}

function sanitizePromptText(value, maxLength = 500) {
  return String(value == null ? "" : value)
    .replace(/\u0000/g, "")
    .replace(PAGE_INSTRUCTION_PATTERN, "[页面指令已移除]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function redactSensitiveText(value, maxLength = 200000) {
  return String(value == null ? "" : value)
    .replace(/\r\n?/g, "\n")
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "【邮箱已隐藏】")
    .replace(/(?<!\d)1[3-9]\d{9}(?!\d)/g, "【手机号已隐藏】")
    .replace(/(?<![\dA-Za-z])\d{17}[\dXx](?![\dA-Za-z])/g, "【证件号已隐藏】")
    .replace(/(?<!\d)\d{15}(?!\d)/g, "【证件号已隐藏】")
    .replace(/(身份证|证件号码?|护照号码?)\s*[：:]?\s*[\dA-Za-z-]{6,}/gi, "$1：【已隐藏】")
    .slice(0, maxLength);
}

function redactAgentSourceText(value, maxLength = 200000) {
  return redactSensitiveText(value, maxLength * 2)
    .split("\n")
    .filter((line) => !/(?:身份证|证件号|护照|手机|电话|邮箱|住址|家庭|父亲|母亲|配偶|亲属|紧急联系人|健康|疾病|残疾|血型|宗教|婚姻|政治面貌|民族)/i.test(line))
    .join("\n")
    .slice(0, maxLength);
}

function sanitizePageOrigin(value) {
  const raw = sanitizePromptText(value, 300);
  try {
    const parsed = new URL(raw);
    return /^https?:$/.test(parsed.protocol) ? parsed.origin : "";
  } catch {
    return "";
  }
}

function classifyFieldRisk(field = {}) {
  const text = [field.label, field.placeholder, field.name, field.id]
    .filter(Boolean)
    .join(" ")
    .slice(0, 2000);
  const riskText = [text, field.section].filter(Boolean).join(" ").slice(0, 2400);
  const type = String(field.type || "").toLowerCase();
  if (!ALLOWED_CONTROL_TYPES.has(type) || BLOCKED_FIELD_PATTERN.test(text)) {
    return "blocked";
  }
  if (DECLARATION_FIELD_PATTERN.test(riskText)) {
    return "declaration";
  }
  if (SENSITIVE_FIELD_PATTERN.test(riskText)) {
    return "sensitive";
  }
  return "standard";
}

function sanitizeField(field = {}) {
  return {
    fieldId: sanitizePromptText(field.fieldId, 160),
    type: sanitizePromptText(field.type, 40).toLowerCase(),
    tagName: sanitizePromptText(field.tagName, 40).toLowerCase(),
    label: sanitizePromptText(field.label, 180),
    placeholder: sanitizePromptText(field.placeholder, 160),
    name: sanitizePromptText(field.name, 120),
    id: sanitizePromptText(field.id, 120),
    required: Boolean(field.required),
    disabled: Boolean(field.disabled),
    readOnly: Boolean(field.readOnly),
    hasCurrentValue: Boolean(field.hasCurrentValue),
    canFill: Boolean(field.canFill),
    maxLength: Math.max(0, Math.min(100000, Number(field.maxLength) || 0)),
    section: sanitizePromptText(field.section, 180),
    nearbyText: sanitizePromptText(field.nearbyText, 260),
    groupText: sanitizePromptText(field.groupText, 220),
    options: Array.isArray(field.options)
      ? field.options.slice(0, 50).map((option) => ({
          value: sanitizePromptText(option?.value, 120),
          label: sanitizePromptText(option?.label, 120)
        }))
      : []
  };
}

const KNOWN_SIGNAL_PATTERN = /^[ws#.-[]='*:()]{1,120}$/;

// 岗位上下文来自招聘网页，只保留公司、职位和 JD 摘要；去掉联系方式和页面指令。
function sanitizeJobContext(job = {}) {
  const source = job && typeof job === "object" ? job : {};
  return {
    company: sanitizePromptText(source.company || source.companyName, 120),
    title: sanitizePromptText(source.title || source.jobTitle, 160),
    description: sanitizePromptText(redactSensitiveText(source.description || source.jd || "", 12000), 4000)
  };
}

function sanitizeSignals(signals) {
  return (Array.isArray(signals) ? signals : [])
    .map((signal) => String(signal || "").trim())
    .filter((signal) => KNOWN_SIGNAL_PATTERN.test(signal))
    .slice(0, 20);
}

function sanitizeSessionRequest(input = {}) {
  const scan = input.scan && typeof input.scan === "object" ? input.scan : {};
  const fields = Array.isArray(scan.fields)
    ? scan.fields.slice(0, 300).map(sanitizeField).filter((field) => field.fieldId)
    : [];
  const profileFields = Array.isArray(input.profileCatalog?.fields)
    ? input.profileCatalog.fields.slice(0, 300).map((field) => ({
        path: sanitizePromptText(field?.path, 160),
        label: sanitizePromptText(field?.label, 180),
        aliases: Array.isArray(field?.aliases)
          ? field.aliases.slice(0, 12).map((alias) => sanitizePromptText(alias, 120)).filter(Boolean)
          : []
      })).filter((field) => field.path && field.label && classifyFieldRisk({ type: "text", label: field.label }) === "standard")
    : [];
  return {
    mode: input.mode === "agent-pull" ? "agent-pull" : "codex",
    page: {
      origin: sanitizePageOrigin(scan.origin || input.page?.origin),
      hostname: sanitizePromptText(scan.hostname || input.page?.hostname, 160),
      title: sanitizePromptText(scan.title || input.page?.title, 240)
    },
    scan: { fields },
    profileCatalog: { fields: profileFields },
    job: sanitizeJobContext(input.job || (input.jobContext ? { description: input.jobContext } : {})),
    signals: sanitizeSignals(input.signals)
  };
}

module.exports = {
  MAX_BODY_BYTES,
  randomToken,
  randomPairCode,
  hashToken,
  timingSafeTokenMatch,
  isAllowedExtensionOrigin,
  sanitizePromptText,
  redactSensitiveText,
  redactAgentSourceText,
  classifyFieldRisk,
  sanitizeJobContext,
  sanitizeSessionRequest
};

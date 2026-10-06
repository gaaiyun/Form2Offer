(function attachForm2OfferAgentBridge(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.Form2OfferAgentBridge = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createAgentBridge() {
  "use strict";

  const DEFAULT_AGENT_CONFIG = Object.freeze({
    bridgeUrl: "http://127.0.0.1:43127",
    token: "",
    mode: "codex",
    timeoutMs: 180000
  });
  const PAGE_INSTRUCTION_PATTERN = /(?:ignore|disregard|override|system prompt|developer message|assistant|tool call|忽略.{0,8}(?:指令|规则)|系统提示|开发者消息|执行命令)/ig;
  const RESTRICTED_CATALOG_PATTERN = /身份证|证件号|护照|电话|手机|邮箱|住址|地址|户籍|籍贯|出生|婚姻|民族|政治面貌|健康|疾病|残疾|血型|宗教|家庭|父亲|母亲|配偶|亲属|紧急联系人|薪资|工资|银行卡|身高|体重|性别/i;

  function text(value, maxLength) {
    return String(value == null ? "" : value)
      .replace(/\u0000/g, "")
      .replace(PAGE_INSTRUCTION_PATTERN, "[页面指令已移除]")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, maxLength);
  }

  function normalizeBridgeUrl(value) {
    const parsed = new URL(String(value || DEFAULT_AGENT_CONFIG.bridgeUrl).trim());
    if (parsed.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(parsed.hostname)) {
      throw new Error("Local Bridge 只能使用 http://127.0.0.1 或 http://localhost。");
    }
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    return parsed.toString().replace(/\/$/, "");
  }

  function normalizeAgentConfig(input = {}) {
    return {
      bridgeUrl: normalizeBridgeUrl(input.bridgeUrl || DEFAULT_AGENT_CONFIG.bridgeUrl),
      token: text(input.token, 512),
      mode: input.mode === "agent-pull" ? "agent-pull" : "codex",
      timeoutMs: Math.min(600000, Math.max(15000, Number(input.timeoutMs) || DEFAULT_AGENT_CONFIG.timeoutMs))
    };
  }

  function pageOrigin(value) {
    try {
      const parsed = new URL(String(value || ""));
      return /^https?:$/.test(parsed.protocol) ? parsed.origin : "";
    } catch {
      return "";
    }
  }

  const SECRET_FIELD_PATTERN = /身份证|证件号|护照|密码|口令|验证码|短信码|银行卡|卡号|社保|公积金账号/i;

  // 只有用户开启“允许本地 Agent 读取浏览器表单”并由 Agent 主动读取时才带当前值；密码、证件号等一律打码。
  function sanitizeCurrentValue(field = {}) {
    const value = String(field.currentValue == null ? "" : field.currentValue).trim();
    if (!value) return "";
    const context = [field.label, field.inferredLabel, field.placeholder, field.name, field.id].filter(Boolean).join(" ");
    if (SECRET_FIELD_PATTERN.test(context) || String(field.type || "").toLowerCase() === "password") return "【已打码】";
    return text(value, 1000);
  }

  function sanitizeField(field = {}, options = {}) {
    const currentValue = options.includeValues ? sanitizeCurrentValue(field) : "";
    return {
      ...(currentValue ? { currentValue } : {}),
      fieldId: text(field.fieldId, 160),
      type: text(field.type, 40).toLowerCase(),
      tagName: text(field.tagName, 40).toLowerCase(),
      label: text(field.label || field.inferredLabel, 180),
      placeholder: text(field.placeholder, 160),
      name: text(field.name, 120),
      id: text(field.id, 120),
      required: Boolean(field.required),
      disabled: Boolean(field.disabled),
      readOnly: Boolean(field.readOnly),
      hasCurrentValue: Boolean(field.hasCurrentValue),
      canFill: Boolean(field.canFill),
      maxLength: Math.max(0, Math.min(100000, Number(field.maxLength) || 0)),
      section: text(field.section || field.inferredCategory, 180),
      nearbyText: text(field.nearbyText, 260),
      groupText: text(field.groupText, 220),
      options: (Array.isArray(field.options) ? field.options : []).slice(0, 50).map((option) => ({
        value: text(option?.value, 120),
        label: text(option?.label, 120)
      }))
    };
  }

  function buildSessionPayload(input = {}, mode = "codex", options = {}) {
    const scan = input.scan && typeof input.scan === "object" ? input.scan : {};
    const includeValues = options.includeValues === true && input.initiator === "agent";
    return {
      mode: mode === "agent-pull" ? "agent-pull" : "codex",
      initiator: input.initiator === "agent" ? "agent" : "user",
      scan: {
        origin: pageOrigin(scan.origin || scan.url),
        hostname: text(scan.hostname, 160),
        title: text(scan.title, 240),
        fields: (Array.isArray(scan.fields) ? scan.fields : []).slice(0, 300).map((field) => sanitizeField(field, { includeValues })).filter((field) => field.fieldId)
      },
      profileCatalog: {
        fields: (Array.isArray(input.profileCatalog?.fields) ? input.profileCatalog.fields : []).slice(0, 300).map((field) => ({
          path: text(field?.path, 180),
          label: text(field?.label, 180),
          aliases: (Array.isArray(field?.aliases) ? field.aliases : []).slice(0, 12).map((alias) => text(alias, 120)).filter(Boolean)
        })).filter((field) => field.path && field.label && !RESTRICTED_CATALOG_PATTERN.test(field.label))
      },
      // 岗位上下文让 Agent 能按公司和 JD 写开放题；Bridge 端会再去掉联系方式和页面指令。
      job: {
        company: text(input.job?.company, 120),
        title: text(input.job?.title, 160),
        description: text(input.job?.description || input.jobContext, 4000)
      },
      signals: (Array.isArray(input.signals) ? input.signals : []).map((signal) => text(signal, 120)).filter(Boolean).slice(0, 20)
    };
  }

  function getRequiredHostPermission(config) {
    const parsed = new URL(normalizeAgentConfig(config).bridgeUrl);
    return `${parsed.protocol}//${parsed.host}/*`;
  }

  return { DEFAULT_AGENT_CONFIG, normalizeBridgeUrl, normalizeAgentConfig, buildSessionPayload, getRequiredHostPermission };
});

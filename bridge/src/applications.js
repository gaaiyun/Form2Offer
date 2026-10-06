"use strict";

const fs = require("node:fs");

// 只读外部投递记录，用于查重提醒。支持两种格式：
// 1. { aliases, current: [{ company, role, status, scope, key }] }（多 Agent 共用的投递状态文件）
// 2. Form2Offer 投递追踪导出的数组 [{ companyName, jobTitle, status }]
const COMPANY_BLOCKING = new Set(["submitted", "offer", "submit_unknown"]);
const STATUS_ALIASES = new Map([
  ["已投递", "submitted"],
  ["笔试", "submitted"],
  ["面试", "submitted"],
  ["offer", "submitted"],
  ["已拒绝", "submitted"],
  ["待投递", "in_progress"],
  ["已撤回", "withdrawn"]
]);
const GENERIC_NAMES = new Set(["中国", "银行", "集团", "公司", "科技", "股份", "控股", "证券", "保险", "基金", "信托", "招聘", "广州", "深圳", "上海", "北京"]);
const MIN_CONTAINS_LENGTH = 3;

function normalizeCompanyName(value) {
  return String(value == null ? "" : value)
    .replace(/[（(][^）)]{0,20}[）)]/g, "")
    .replace(/[\s·・,，。【】[\]]/g, "")
    .replace(/(?:股份)?有限(?:责任)?公司$/, "")
    .replace(/(?:集团|控股)$/, "")
    .trim()
    .toLowerCase();
}

function normalizeStatus(value) {
  const raw = String(value || "").trim();
  return STATUS_ALIASES.get(raw.toLowerCase()) || STATUS_ALIASES.get(raw) || raw.toLowerCase();
}

function loadApplicationRecords(filePath) {
  const empty = { records: [], aliases: new Map(), updatedAt: "", error: "" };
  if (!filePath) return { ...empty, error: "未配置投递记录文件。" };
  let parsed;
  try {
    if (!fs.existsSync(filePath)) return { ...empty, error: `投递记录文件不存在：${filePath}` };
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    return { ...empty, error: `投递记录文件无法读取：${error.message}` };
  }
  const items = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.current) ? parsed.current
      : Array.isArray(parsed?.applications) ? parsed.applications
        : Array.isArray(parsed?.records) ? parsed.records : [];
  const records = items
    .filter((item) => item && typeof item === "object")
    .slice(0, 5000)
    .map((item) => {
      const status = normalizeStatus(item.status);
      const key = String(item.key || "");
      return {
        company: String(item.company || item.companyName || "").slice(0, 120),
        role: String(item.role || item.jobTitle || "").slice(0, 160),
        status,
        scope: String(item.scope || (COMPANY_BLOCKING.has(status) ? "company" : "job")),
        domain: key.startsWith("domain:") ? key.slice(7) : String(item.domain || ""),
        recordedAt: String(item.recordedAt || item.updatedAt || item.appliedAt || "")
      };
    })
    .filter((record) => record.company || record.domain);
  const aliases = new Map();
  for (const [canonical, names] of Object.entries(parsed?.aliases && typeof parsed.aliases === "object" ? parsed.aliases : {})) {
    const group = [canonical, ...(Array.isArray(names) ? names : [])].map(normalizeCompanyName).filter(Boolean);
    for (const name of group) aliases.set(name, group);
  }
  return { records, aliases, updatedAt: String(parsed?.updatedAt || ""), error: "" };
}

function namesFor(name, aliases) {
  const normalized = normalizeCompanyName(name);
  if (!normalized) return [];
  const group = new Set([normalized]);
  for (const [alias, members] of aliases) {
    if (alias === normalized || (alias.length >= MIN_CONTAINS_LENGTH && normalized.includes(alias))) {
      members.forEach((member) => group.add(member));
    }
  }
  return Array.from(group);
}

function companiesMatch(left, right) {
  if (!left || !right || GENERIC_NAMES.has(left) || GENERIC_NAMES.has(right)) return false;
  if (left === right) return true;
  const [shorter, longer] = left.length <= right.length ? [left, right] : [right, left];
  // 子串只在较短名字足够具体时才算，避免“银行”命中“中国银行”。
  return shorter.length >= MIN_CONTAINS_LENGTH && longer.startsWith(shorter);
}

function checkApplied(data, query = {}) {
  const records = Array.isArray(data?.records) ? data.records : [];
  const aliases = data?.aliases instanceof Map ? data.aliases : new Map();
  const wanted = namesFor(query.company, aliases);
  const hostname = String(query.hostname || "").toLowerCase();
  const matches = [];
  for (const record of records) {
    const recordNames = namesFor(record.company, aliases);
    const byCompany = wanted.length > 0 && recordNames.some((name) => wanted.some((target) => companiesMatch(name, target)));
    const byDomain = Boolean(hostname && record.domain && record.domain.toLowerCase() === hostname);
    if (!byCompany && !byDomain) continue;
    const blocking = record.scope === "company" && COMPANY_BLOCKING.has(record.status);
    matches.push({ ...record, blocking, matchedBy: byCompany ? "company" : "domain" });
  }
  matches.sort((left, right) => Number(right.blocking) - Number(left.blocking) || right.recordedAt.localeCompare(left.recordedAt));
  return {
    blocking: matches.some((match) => match.blocking),
    matches: matches.slice(0, 10)
  };
}

module.exports = { loadApplicationRecords, checkApplied, normalizeCompanyName, COMPANY_BLOCKING };

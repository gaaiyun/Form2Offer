"use strict";

const fs = require("node:fs");
const path = require("node:path");

// Agent 准备的资料底稿先暂存在 Bridge 数据目录，由用户在扩展设置页预览后导入。
// 扩展不会自动导入；Bridge 也不会把底稿发给 Agent 以外的任何地方。
const STAGED_FILE_NAME = "staged-profile.json";
const SUPPORTED_FORMATS = new Set(["Form2OfferProfileBackup", "ResumeBridgeProfileBackup", "OpenJobAutofillProfileBackup"]);
const MAX_PACKAGE_BYTES = 900 * 1024;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateProfilePackage(input) {
  const pkg = isPlainObject(input) ? input : null;
  if (!pkg || !SUPPORTED_FORMATS.has(pkg.format) || !isPlainObject(pkg.profileV2) || !isPlainObject(pkg.profileV2.sections)) {
    throw Object.assign(new Error("资料底稿必须是 Form2Offer 备份格式（format=Form2OfferProfileBackup，含 profileV2.sections）。"), { statusCode: 400 });
  }
  const size = Buffer.byteLength(JSON.stringify(pkg), "utf8");
  if (size > MAX_PACKAGE_BYTES) {
    throw Object.assign(new Error("资料底稿过大。"), { statusCode: 413 });
  }
  return pkg;
}

function summarizeProfilePackage(pkg) {
  const sections = isPlainObject(pkg?.profileV2?.sections) ? pkg.profileV2.sections : {};
  let valueCount = 0;
  let itemCount = 0;
  for (const section of Object.values(sections)) {
    if (!isPlainObject(section)) continue;
    if (isPlainObject(section.values)) valueCount += Object.keys(section.values).length;
    if (Array.isArray(section.items)) {
      itemCount += section.items.length;
      for (const item of section.items) {
        if (isPlainObject(item?.values)) valueCount += Object.keys(item.values).length;
      }
    }
  }
  return {
    sectionCount: Object.keys(sections).length,
    itemCount,
    valueCount,
    customSectionCount: Array.isArray(pkg?.profileV2?.customSections) ? pkg.profileV2.customSections.length : 0
  };
}

function getStagedPath(dataDir) {
  return path.join(path.resolve(dataDir), STAGED_FILE_NAME);
}

function stageProfilePackage(dataDir, input, note = "") {
  const pkg = validateProfilePackage(input);
  const record = {
    stagedAt: new Date().toISOString(),
    note: String(note || "").replace(/\s+/g, " ").trim().slice(0, 300),
    summary: summarizeProfilePackage(pkg),
    package: pkg
  };
  const target = getStagedPath(dataDir);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temp, target);
  return { staged: true, stagedAt: record.stagedAt, note: record.note, summary: record.summary };
}

function readStagedProfile(dataDir, options = {}) {
  const target = getStagedPath(dataDir);
  if (!fs.existsSync(target)) return { staged: false };
  const record = JSON.parse(fs.readFileSync(target, "utf8"));
  const view = { staged: true, stagedAt: record.stagedAt, note: record.note, summary: record.summary };
  if (options.includePackage) view.package = record.package;
  return view;
}

function clearStagedProfile(dataDir) {
  const target = getStagedPath(dataDir);
  const existed = fs.existsSync(target);
  if (existed) fs.rmSync(target, { force: true });
  return { cleared: existed };
}

module.exports = {
  STAGED_FILE_NAME,
  validateProfilePackage,
  summarizeProfilePackage,
  stageProfilePackage,
  readStagedProfile,
  clearStagedProfile
};

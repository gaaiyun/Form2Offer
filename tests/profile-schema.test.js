const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const optionsSource = fs.readFileSync(path.join(projectRoot, "src", "options.js"), "utf8");
const popupSource = fs.readFileSync(path.join(projectRoot, "src", "popup.js"), "utf8");
const smokeSource = fs.readFileSync(path.join(projectRoot, "scripts", "qa-extension-smoke.js"), "utf8");
const schemaBlock = optionsSource.slice(
  optionsSource.indexOf("const STRUCTURED_RESUME_SECTIONS"),
  optionsSource.indexOf("let activeProfileSectionKey")
);
const schemaLabels = new Set(
  Array.from(schemaBlock.matchAll(/"([^"]+)"/g), (match) => match[1])
);

test("exposes missing Phoenix application fields in the local profile editor", () => {
  for (const label of [
    "一级学科",
    "发表日期",
    "是否第一作者",
    "对目标公司的期望",
    "求职过程中最困扰的问题",
    "个人优缺点",
    "岗位相关突出技能",
    "获取招聘信息途径"
  ]) {
    assert.match(optionsSource, new RegExp(label));
  }
  assert.match(optionsSource, /key: "questionnaire"/);
});

test("injects profile utilities before the content script", () => {
  for (const source of [popupSource, smokeSource]) {
    const utilityIndex = source.indexOf("src/profile-utils.js");
    const contentIndex = source.indexOf("src/content.js");
    assert.ok(utilityIndex >= 0 && contentIndex > utilityIndex);
  }
});

test("keeps every sample-profile field editable in the structured profile editor", () => {
  const profile = require(path.join(projectRoot, "sample-profile.json")).profileV2;
  const missing = [];

  for (const [sectionKey, section] of Object.entries(profile.sections)) {
    const records = section.kind === "repeat" ? section.items || [] : [section];
    for (const record of records) {
      for (const label of Object.keys(record.values || {})) {
        if (!schemaLabels.has(label)) {
          missing.push(`${sectionKey}.${label}`);
        }
      }
    }
  }

  assert.deepEqual(missing, []);
});

test("covers common bank and state-owned-enterprise campus application fields", () => {
  const expectedLabels = [
    "是否应届毕业生",
    "毕业年份",
    "GPA分数",
    "GPA满分",
    "平均成绩",
    "专业人数",
    "第一志愿岗位",
    "第二志愿岗位",
    "是否接受异地调剂",
    "职业",
    "是否金融从业",
    "是否在应聘单位工作",
    "是否存在失信记录",
    "是否受过纪律处分",
    "是否签订竞业限制协议",
    "职业规划"
  ];

  assert.deepEqual(expectedLabels.filter((label) => !schemaLabels.has(label)), []);
});

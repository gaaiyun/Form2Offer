const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// 万联证券北森租户实测出的问题：数字类值比对失败、地区选择器、分区推断、“添加”按钮在记录里面。
const contentSource = fs.readFileSync(path.join(__dirname, "..", "src", "content.js"), "utf8");

function sliceFunctions(startName, endName) {
  const start = contentSource.indexOf(startName);
  const end = contentSource.indexOf(endName, start);
  assert.ok(start >= 0 && end > start, `${startName} .. ${endName}`);
  return contentSource.slice(start, end);
}

function loadComparators() {
  const ctx = {
    normalizeText: (value, max = 200) => String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, max)
  };
  vm.createContext(ctx);
  vm.runInContext(sliceFunctions("function normalizeDateValue(", "function getPhoenixDatePickerContainer("), ctx);
  vm.runInContext(sliceFunctions("function normalizeComparableValue(", "function summarizeDebugField("), ctx);
  return ctx;
}

test("value comparison keeps digits so dates, phones and body measurements verify", () => {
  const { valuesLookEquivalent } = loadComparators();
  assert.equal(valuesLookEquivalent("2026-03", "2026-03"), true);
  assert.equal(valuesLookEquivalent("2026-03-01", "2026-03"), true);
  assert.equal(valuesLookEquivalent("2026年3月", "2026-03"), true);
  assert.equal(valuesLookEquivalent("13800138000", "13800138000"), true);
  assert.equal(valuesLookEquivalent("+86 13800138000", "13800138000"), true);
  assert.equal(valuesLookEquivalent("170", "170"), true);
  assert.equal(valuesLookEquivalent("170cm", "170"), true);
  assert.equal(valuesLookEquivalent("硕士研究生", "硕士研究生"), true);
  assert.equal(valuesLookEquivalent("大学本科", "本科"), true);

  assert.equal(valuesLookEquivalent("2025-09", "2026-03"), false);
  assert.equal(valuesLookEquivalent("前10%", "前20%"), false);
  assert.equal(valuesLookEquivalent("1", "10"), false);
  assert.equal(valuesLookEquivalent("", "170"), false);
});

function loadAreaHelpers() {
  const ctx = {
    normalizeText: (value, max = 200) => String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, max)
  };
  vm.createContext(ctx);
  vm.runInContext(sliceFunctions("const AREA_PROVINCE_HINTS", "function getVisibleAreaSelector("), ctx);
  return ctx;
}

test("area paths split into province, city and county and match site names", () => {
  const { splitAreaPath, areaNameMatches, guessAreaProvince } = loadAreaHelpers();
  assert.deepEqual([...splitAreaPath("广东省肇庆市德庆县")], ["广东省", "肇庆市", "德庆县"]);
  assert.deepEqual([...splitAreaPath("北京市朝阳区")], ["北京市", "朝阳区"]);
  assert.deepEqual([...splitAreaPath("广西壮族自治区南宁市")], ["广西壮族自治区", "南宁市"]);
  assert.deepEqual([...splitAreaPath("广州")], ["广州"]);
  assert.equal(areaNameMatches("广州市", "广州"), true);
  assert.equal(areaNameMatches("德庆县", "德庆县"), true);
  assert.equal(areaNameMatches("广东省", "广东"), true);
  assert.equal(areaNameMatches("广州市", "深圳"), false);
  assert.equal(guessAreaProvince("广州"), "广东省");
  assert.equal(guessAreaProvince("佛山市"), "广东省");
  assert.equal(guessAreaProvince("杭州"), "浙江省");
  assert.equal(guessAreaProvince("火星"), "");
});

test("Phoenix select reads the committed value, not the search text", () => {
  const source = sliceFunctions("function getPhoenixSelectCommittedValue(", "function getControlCurrentValue(");
  assert.match(source, /phoenix-select__tag/);
  assert.match(source, /--show/);
  assert.match(contentSource, /const phoenixSelect = element\.matches\?\.\("\.phoenix-select__input"\)/);
});

test("bare start/end dates follow their record context before defaulting to education", () => {
  const direct = sliceFunctions("function inferSectionFromDirectLabel(", "function inferMatchSection(");
  assert.doesNotMatch(direct, /开始时间\|结束时间/);
  const infer = sliceFunctions("function inferMatchSection(", "function buildProfileItemAliases(");
  assert.match(infer, /\^\(开始时间\|结束时间\)\$/);
  assert.ok(infer.indexOf("实习经历") < infer.lastIndexOf("开始时间|结束时间"));
});

test("Phoenix records are scoped by .ux-standard-form and add buttons inside records are handled", () => {
  assert.match(contentSource, /repeatItemSelector: "\.ux-standard-form,/);
  const root = sliceFunctions("function findKnownRepeatSectionRoot(", "function findKnownRepeatAddControl(");
  assert.match(root, /containsOtherRepeatAction/);
  assert.match(root, /recordCount > 1/);
});

test("repeat records never borrow values from another record", () => {
  const score = sliceFunctions("function scoreAutofillCandidate(", "function createAutofillCandidate(");
  assert.match(score, /occurrenceBonus < 0[\s\S]{0,40}return 0/);
});

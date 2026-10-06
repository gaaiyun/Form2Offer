const test = require("node:test");
const assert = require("node:assert/strict");

const rules = require("../src/fill-rules.js");

test("parses true rank percentages from profile text", () => {
  assert.equal(rules.parseRankPercent("前10%"), 10);
  assert.equal(rules.parseRankPercent("专业前 30 %"), 30);
  assert.equal(rules.parseRankPercent("top 5%"), 5);
  assert.equal(rules.parseRankPercent("3/120"), null);
  assert.equal(rules.parseRankPercent("良好"), null);
});

test("picks the smallest cumulative bucket that still contains the true rank", () => {
  const options = ["前5%", "前20%", "前50%", "其他"];
  assert.equal(rules.pickRankOption("前10%", options).label, "前20%");
  assert.equal(rules.pickRankOption("前30%", options).label, "前50%");
  assert.equal(rules.pickRankOption("前5%", options).label, "前5%");
});

test("never claims a better rank than the profile value", () => {
  const result = rules.pickRankOption("前10%", ["前1%", "前5%"]);
  assert.equal(result, null);
});

test("uses explicit ranges when the page offers interval buckets", () => {
  const options = ["5%以内", "5%-10%", "10%-20%", "20%-50%", "50%以后"];
  assert.equal(rules.pickRankOption("前10%", options).label, "5%-10%");
  assert.equal(rules.pickRankOption("前30%", options).label, "20%-50%");
});

test("keeps exact matches and ignores non-percentage option lists", () => {
  assert.equal(rules.pickRankOption("前10%", ["前10%", "前20%"]).label, "前10%");
  assert.equal(rules.pickRankOption("前10%", ["优秀", "良好"]), null);
  assert.equal(rules.pickRankOption("良好", ["前10%", "前20%"]), null);
});

test("projects month-only dates to the first or last day for day-level pickers", () => {
  assert.equal(rules.projectMonthToDay("2026-03", "start"), "2026-03-01");
  assert.equal(rules.projectMonthToDay("2026.03", "end"), "2026-03-31");
  assert.equal(rules.projectMonthToDay("2024年2月", "end"), "2024-02-29");
  assert.equal(rules.projectMonthToDay("2025-02", "end"), "2025-02-28");
  assert.equal(rules.projectMonthToDay("2026-03-18", "start"), "2026-03-18");
  assert.equal(rules.projectMonthToDay("至今", "end"), "");
});

test("infers start or end role from field labels", () => {
  assert.equal(rules.inferDateRole("开始时间"), "start");
  assert.equal(rules.inferDateRole("入学时间"), "start");
  assert.equal(rules.inferDateRole("结束日期"), "end");
  assert.equal(rules.inferDateRole("毕业时间"), "end");
  assert.equal(rules.inferDateRole("出生日期"), "");
  assert.equal(rules.inferDateRole("Start date"), "start");
  assert.equal(rules.inferDateRole("Total score"), "");
});

test("formats dates to the separator a picker placeholder expects", () => {
  assert.equal(rules.formatDateForPattern("2026-03-01", "yyyy/mm/dd"), "2026/03/01");
  assert.equal(rules.formatDateForPattern("2026-03-01", "YYYY-MM-DD"), "2026-03-01");
  assert.equal(rules.formatDateForPattern("2026-03-01", "请选择日期"), "2026-03-01");
  assert.equal(rules.formatDateForPattern("2026-03", "yyyy/mm"), "2026/03");
});

test("measures length by characters or by double-width bytes", () => {
  assert.equal(rules.measureTextLength("广州abc", "char"), 5);
  assert.equal(rules.measureTextLength("广州abc", "byte"), 7);
  assert.deepEqual(rules.checkMaxLength("中国银行广州天河支行", 15, "byte"), {
    fits: false,
    length: 20,
    maxLength: 15,
    unit: "byte"
  });
  assert.equal(rules.checkMaxLength("abc", 0, "char").fits, true);
});

test("detects hosts that count maxlength in bytes", () => {
  assert.equal(rules.getMaxLengthUnit("xyz.51job.com"), "byte");
  assert.equal(rules.getMaxLengthUnit("q.yingjiesheng.com"), "byte");
  assert.equal(rules.getMaxLengthUnit("app.mokahr.com"), "char");
});

test("chooses the longest profile variant that still fits a limit", () => {
  const variants = ["这是一个很长的描述文字超过限制", "短描述"];
  assert.equal(rules.pickVariantWithinLimit(variants, 10, "char"), "短描述");
  assert.equal(rules.pickVariantWithinLimit(["太长了太长了"], 4, "char"), "");
});

const test = require("node:test");
const assert = require("node:assert/strict");

const insight = require("../src/job-insight.js");

const SALES_JD = `销售管理培训生（广州）
岗位职责：负责区域渠道开拓与重点客户关系维护，跟进门店动销数据。
任职要求：2027届本科及以上学历，专业不限；粤语优先；能接受全国调配。
每人限投1个岗位。`;

const TECH_JD = `后端开发工程师
岗位职责：负责 Java 服务端研发、系统架构设计。
任职要求：计算机、软件工程相关专业硕士及以上，985/211 院校，英语六级 500 分以上。`;

test("classifies the main job family from title and body", () => {
  const sales = insight.analyzeJobText(SALES_JD, { title: "销售管理培训生" });
  assert.equal(sales.primaryFamily.id, "sales");
  assert.ok(sales.families.some((family) => family.id === "management-trainee"));
  const tech = insight.analyzeJobText(TECH_JD, { title: "后端开发工程师" });
  assert.equal(tech.primaryFamily.id, "tech-rd");
});

test("extracts hard requirements with required or preferred level", () => {
  const tech = insight.analyzeJobText(TECH_JD);
  const school = tech.requirements.find((item) => item.type === "school-tier");
  assert.equal(school.level, "required");
  const english = tech.requirements.find((item) => item.type === "english");
  assert.equal(english.value, 500);
  const major = tech.requirements.find((item) => item.type === "major");
  assert.match(major.text, /计算机/);
  const degree = tech.requirements.find((item) => item.type === "degree");
  assert.equal(degree.value, "master");

  const preferred = insight.analyzeJobText("任职要求：985、211 院校优先，专业不限。");
  assert.equal(preferred.requirements.find((item) => item.type === "school-tier").level, "preferred");
});

test("reads graduation years, apply limits and relocation", () => {
  const sales = insight.analyzeJobText(SALES_JD);
  assert.deepEqual(sales.classYears, [2027]);
  assert.equal(sales.applyLimit, 1);
  assert.equal(sales.flags.relocation, true);
  assert.equal(insight.analyzeJobText("最多可投递3个校园招聘职位").applyLimit, 3);
  assert.equal(insight.analyzeJobText("每位同学限报两个志愿").applyLimit, 2);
});

test("flags internships and social recruitment postings", () => {
  assert.equal(insight.analyzeJobText("日常实习生（数据分析）", { title: "日常实习生" }).flags.internship, true);
  assert.equal(insight.analyzeJobText("要求3年以上相关工作经验").flags.socialRecruit, true);
  assert.equal(insight.analyzeJobText(SALES_JD).flags.internship, false);
});

test("assesses requirements against the candidate's own thresholds", () => {
  const candidate = { schoolTier: "other", degree: "master", englishScore: 434, classYear: 2027, majorKeywords: ["金融"] };
  const tech = insight.assessRequirements(insight.analyzeJobText(TECH_JD), candidate);
  assert.equal(tech.verdict, "block");
  assert.ok(tech.items.some((item) => item.type === "school-tier" && item.status === "block"));
  assert.ok(tech.items.some((item) => item.type === "english" && item.status === "block"));

  const sales = insight.assessRequirements(insight.analyzeJobText(SALES_JD), candidate);
  assert.equal(sales.verdict, "ok");

  const wrongYear = insight.assessRequirements(insight.analyzeJobText("面向2026届毕业生"), candidate);
  assert.equal(wrongYear.verdict, "block");

  const unknownCandidate = insight.assessRequirements(insight.analyzeJobText(TECH_JD), {});
  assert.equal(unknownCandidate.verdict, "unknown");
});

test("recommends the resume version whose families and keywords fit best", () => {
  const versions = [
    { id: "11", label: "数据分析与商业经营分析", families: ["data"], keywords: ["数据分析", "经营分析"] },
    { id: "13", label: "渠道销售与商务客户发展", families: ["sales"], keywords: ["渠道", "客户"] },
    { id: "16", label: "银行与金融运营综合管理", families: ["bank-frontline"], keywords: ["银行", "支行"] }
  ];
  const sales = insight.analyzeJobText(SALES_JD, { title: "销售管理培训生" });
  const recommended = insight.recommendResumeVersion(sales, versions, SALES_JD);
  assert.equal(recommended.id, "13");
  assert.ok(recommended.reason);
  assert.equal(insight.recommendResumeVersion(sales, [], SALES_JD), null);
});

test("parses user-editable resume version lines", () => {
  const versions = insight.parseResumeVersionLines([
    "13 | 渠道销售与商务客户发展 | sales,bank-frontline | 渠道,客户,销售",
    "# comment",
    "11 | 数据分析 | data"
  ].join("\n"));
  assert.equal(versions.length, 2);
  assert.deepEqual(versions[0].families, ["sales", "bank-frontline"]);
  assert.deepEqual(versions[1].keywords, []);
  assert.equal(insight.formatResumeVersionLines(versions).split("\n")[0], "13 | 渠道销售与商务客户发展 | sales,bank-frontline | 渠道,客户,销售");
});

test("handles empty input without throwing", () => {
  const empty = insight.analyzeJobText("");
  assert.equal(empty.primaryFamily, null);
  assert.deepEqual(empty.requirements, []);
  assert.equal(empty.applyLimit, null);
});

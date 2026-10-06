const test = require("node:test");
const assert = require("node:assert/strict");

const knowledge = require("../src/platform-knowledge.js");

test("detects SaaS ATS platforms by host", () => {
  assert.equal(knowledge.detectPlatform("https://app.mokahr.com/campus-recruitment/demo/1#/job/abc").id, "moka");
  assert.equal(knowledge.detectPlatform("https://demo.jobs.feishu.cn/demo/resume/123/apply").id, "feishu");
  assert.equal(knowledge.detectPlatform("https://wecruit.hotjob.cn/SU0000/pb/posDetail.html?postId=1").id, "hotjob");
});

test("separates the new and legacy Beisen portals", () => {
  assert.equal(knowledge.detectPlatform("https://demo.zhiye.com/form?fromPage=job&jobAdId=x").id, "beisen");
  assert.equal(knowledge.detectPlatform("https://demo.zhiye.com/Portal/Resume/ResumeItem?jid=1").id, "beisen-legacy");
  assert.equal(knowledge.detectPlatform("https://demo.zhiye.com/campusxq?jobId=1").id, "beisen-legacy");
});

test("separates 51job consumer forms, classic forms and the yingjiesheng resume", () => {
  assert.equal(knowledge.detectPlatform("https://xyz.51job.com/consumer/pc/resume/index?ctmid=1").id, "51job");
  assert.equal(knowledge.detectPlatform("https://xyz.51job.com/External/FillInResume.aspx?id=1").id, "51job-classic");
  assert.equal(knowledge.detectPlatform("https://q.yingjiesheng.com/pc/myresume").id, "yingjiesheng-resume");
});

test("recognizes bank and state-owned enterprise portals", () => {
  assert.equal(knowledge.detectPlatform("https://job.citicbank.com/recruitportal/index").id, "citicbank");
  assert.equal(knowledge.detectPlatform("https://job.spdb.com.cn/web/index").id, "spdb");
  assert.equal(knowledge.detectPlatform("https://career.abchina.com/build/index.html#/MyResume").id, "abchina");
  assert.equal(knowledge.detectPlatform("https://applyjob.chinahr.com/apply/resume").id, "chinahr");
});

test("uses DOM fingerprints for ATS pages served from company domains", () => {
  const result = knowledge.detectPlatform("https://join.example.com/apply", ["[class*='sd-Select-container']"]);
  assert.equal(result.id, "moka");
  assert.equal(result.matchedBy, "signal");
  assert.ok(result.confidence < 0.9);
  assert.equal(knowledge.detectPlatform("https://www.example.com/"), null);
});

test("weak path patterns only apply when no host rule matched", () => {
  const result = knowledge.detectPlatform("https://join.example.cn/campus-recruitment/demo/123");
  assert.equal(result.id, "moka");
  assert.equal(result.matchedBy, "path");
});

test("exposes the fingerprint selectors that content scripts should probe", () => {
  const selectors = knowledge.getFingerprintSelectors();
  assert.ok(selectors.includes("[class*='sd-Select-container']"));
  assert.ok(selectors.includes(".form-item--phoenix"));
  assert.ok(selectors.every((selector) => typeof selector === "string" && selector.length < 120));
});

test("returns a guide with short tips, agent notes and the general rules", () => {
  const guide = knowledge.getPlatformGuide("moka");
  assert.equal(guide.platform.id, "moka");
  assert.ok(guide.tips.some((tip) => /解析/.test(tip)));
  assert.ok(guide.tips.every((tip) => tip.length <= 60));
  assert.ok(guide.agentNotes.length > 0);
  assert.ok(guide.generalRules.length >= 10);
  const byUrl = knowledge.getPlatformGuide("https://app.mokahr.com/campus-recruitment/demo/1");
  assert.equal(byUrl.platform.id, "moka");
  const unknown = knowledge.getPlatformGuide("https://www.example.com/");
  assert.equal(unknown.platform, null);
  assert.ok(unknown.generalRules.length >= 10);
});

test("every platform entry is complete enough to drive the UI", () => {
  const ids = new Set();
  for (const platform of knowledge.listPlatforms()) {
    assert.ok(platform.id && !ids.has(platform.id), `duplicate or missing id ${platform.id}`);
    ids.add(platform.id);
    assert.ok(platform.name, `${platform.id} name`);
    assert.ok(knowledge.FAMILIES[platform.family], `${platform.id} family ${platform.family}`);
    assert.ok(Array.isArray(platform.match) && platform.match.length > 0, `${platform.id} match`);
    assert.ok(Array.isArray(platform.tips), `${platform.id} tips`);
    for (const rule of platform.match) {
      if (rule.host) new RegExp(rule.host, "i");
      if (rule.path) new RegExp(rule.path, "i");
    }
  }
  assert.ok(ids.size >= 35);
});

test("knowledge text carries no personal data", () => {
  const text = JSON.stringify({ platforms: knowledge.listPlatforms(), general: knowledge.GENERAL_RULES });
  assert.doesNotMatch(text, /1[3-9]\d{9}/);
  assert.doesNotMatch(text, /\d{17}[\dXx]/);
  assert.doesNotMatch(text, /[\w.+-]+@[\w-]+\.[a-z]{2,}/i);
  assert.doesNotMatch(text, /岑|锴源|resumeId=|ctmid=\d/);
});

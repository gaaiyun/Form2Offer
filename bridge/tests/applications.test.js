const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { loadApplicationRecords, checkApplied, normalizeCompanyName } = require("../src/applications.js");

function writeTemp(content) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "f2o-apps-"));
  const file = path.join(directory, "state.json");
  fs.writeFileSync(file, JSON.stringify(content), "utf8");
  return file;
}

const SHARED_STATE = {
  aliases: { 携程: ["携程", "携程集团", "Trip.com"] },
  current: [
    { company: "携程", role: "旅游业务培训生", status: "submitted", scope: "company", recordedAt: "2026-10-01T00:00:00Z", note: "private note" },
    { company: "青木科技", role: "数据策略", status: "needs_user", scope: "job" },
    { company: "中国银行", role: "综合柜员", status: "submitted", scope: "company" },
    { company: "实体待核", status: "needs_user", scope: "domain", key: "domain:demo.zhiye.com" }
  ]
};

test("normalizes company names without stripping meaningful words", () => {
  assert.equal(normalizeCompanyName("广州某某科技有限公司"), "广州某某科技");
  assert.equal(normalizeCompanyName("携程集团"), "携程");
  assert.equal(normalizeCompanyName(" Trip.com "), "trip.com");
});

test("loads shared state files and Form2Offer tracker exports", () => {
  const shared = loadApplicationRecords(writeTemp(SHARED_STATE));
  assert.equal(shared.records.length, 4);
  assert.equal(shared.records[0].note, undefined);
  const tracker = loadApplicationRecords(writeTemp([{ companyName: "示例公司", jobTitle: "管培生", status: "已投递" }]));
  assert.equal(tracker.records[0].company, "示例公司");
  assert.equal(tracker.records[0].status, "submitted");
  const missing = loadApplicationRecords(path.join(os.tmpdir(), "does-not-exist-f2o.json"));
  assert.equal(missing.records.length, 0);
  assert.match(missing.error, /不存在|not found/i);
});

test("blocks companies already submitted, including aliases", () => {
  const data = loadApplicationRecords(writeTemp(SHARED_STATE));
  const ctrip = checkApplied(data, { company: "Trip.com 携程集团" });
  assert.equal(ctrip.blocking, true);
  assert.equal(ctrip.matches[0].status, "submitted");
  assert.equal(checkApplied(data, { company: "携程集团" }).blocking, true);
});

test("job-scoped records only warn and never block other roles", () => {
  const data = loadApplicationRecords(writeTemp(SHARED_STATE));
  const result = checkApplied(data, { company: "青木科技", role: "产品运营" });
  assert.equal(result.blocking, false);
  assert.equal(result.matches.length, 1);
});

test("generic words do not create false positives", () => {
  const data = loadApplicationRecords(writeTemp(SHARED_STATE));
  assert.equal(checkApplied(data, { company: "银行" }).matches.length, 0);
  assert.equal(checkApplied(data, { company: "中国农业银行" }).matches.length, 0);
});

test("domain-scoped records match by hostname", () => {
  const data = loadApplicationRecords(writeTemp(SHARED_STATE));
  const result = checkApplied(data, { company: "", hostname: "demo.zhiye.com" });
  assert.equal(result.matches.length, 1);
});

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeQuestionKey,
  isEligibleOpenQuestion,
  normalizeAnswerLibrary,
  mergeAnswerLibrary,
  findAnswerForQuestion
} = require("../src/answer-library.js");

test("normalizes numbering, required marks, punctuation, and whitespace for exact question reuse", () => {
  assert.equal(
    normalizeQuestionKey("  12. 请说明为什么选择本公司？ *（必填）"),
    normalizeQuestionKey("请说明为什么选择本公司")
  );
});

test("accepts open questions and rejects private or declaration fields", () => {
  assert.equal(isEligibleOpenQuestion("请介绍一次你解决项目挑战的经历", "我先定位问题，再协调资源。", "textarea"), true);
  assert.equal(isEligibleOpenQuestion("为什么选择这个岗位？", "岗位方向与我的积累一致。", "text"), true);
  assert.equal(isEligibleOpenQuestion("家庭成员及职业", "父亲，教师", "textarea"), false);
  assert.equal(isEligibleOpenQuestion("本人承诺以上信息真实有效", "同意", "textarea"), false);
  assert.equal(isEligibleOpenQuestion("请输入", "任意内容", "textarea"), false);
});

test("merges exact questions without creating duplicates and preserves identity", () => {
  const now = "2026-08-25T10:00:00.000Z";
  const first = mergeAnswerLibrary([], [
    { question: "为什么选择本公司？", answer: "第一版答案" }
  ], { now });
  assert.equal(first.createdCount, 1);
  assert.equal(first.entries.length, 1);

  const updated = mergeAnswerLibrary(first.entries, [
    { question: "1、为什么选择本公司", answer: "更新后的答案" }
  ], { now: "2026-08-25T11:00:00.000Z" });
  assert.equal(updated.createdCount, 0);
  assert.equal(updated.updatedCount, 1);
  assert.equal(updated.entries.length, 1);
  assert.equal(updated.entries[0].id, first.entries[0].id);
  assert.equal(updated.entries[0].answer, "更新后的答案");
});

test("finds only normalized exact matches and safely ignores malformed entries", () => {
  const entries = normalizeAnswerLibrary([
    null,
    { question: "你的三年职业规划是什么？", answer: "先夯实专业能力，再承担完整项目。" },
    { question: "", answer: "无效" }
  ], { now: "2026-08-25T10:00:00.000Z" });
  assert.equal(findAnswerForQuestion(entries, "你的三年职业规划是什么").answer.includes("专业能力"), true);
  assert.equal(findAnswerForQuestion(entries, "你的五年职业规划是什么？"), null);
});

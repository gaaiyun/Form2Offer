const test = require("node:test");
const assert = require("node:assert/strict");

const { SessionStore } = require("../src/session-store.js");

function request(mode = "agent-pull") {
  return {
    mode,
    scan: {
      origin: "https://jobs.example.com",
      fields: [
        { fieldId: "project", type: "textarea", label: "请介绍项目经历", canFill: true },
        { fieldId: "identity", type: "text", label: "身份证号码", canFill: true },
        { fieldId: "submit", type: "submit", label: "提交申请", canFill: true }
      ]
    },
    profileCatalog: {
      fields: [{ path: "profile.project.summary", label: "项目经历 / 内容" }]
    }
  };
}

test("creates sessions with mode-specific states and no raw current values", () => {
  const store = new SessionStore();
  const pull = store.create(request("agent-pull"));
  const codex = store.create(request("codex"));
  assert.equal(pull.state, "awaiting_agent");
  assert.equal(codex.state, "queued");
  assert.equal(store.getInternal(pull.id).request.scan.fields[0].currentValue, undefined);
  assert.equal(store.get(pull.id).request.scan.fields[0].fieldId, "project");
  assert.equal(Object.hasOwn(store.get(pull.id).request.scan.fields[0], "currentValue"), false);
});

test("accepts standard plan items and rejects sensitive or blocked fields", () => {
  const store = new SessionStore();
  const session = store.create(request());
  const result = store.submitPlan(session.id, {
    summary: "建议一项",
    warnings: [],
    items: [
      { fieldId: "project", sourcePath: "profile.project.summary", value: "", confidence: 0.96, risk: "standard", reason: "题目一致", evidence: [] },
      { fieldId: "identity", sourcePath: "", value: "440101...", confidence: 1, risk: "sensitive", reason: "", evidence: [] },
      { fieldId: "submit", sourcePath: "", value: "点击", confidence: 1, risk: "blocked", reason: "", evidence: [] }
    ]
  });
  assert.equal(result.state, "review_ready");
  assert.equal(result.plan.items.length, 1);
  assert.equal(result.plan.rejected.length, 2);
});

test("does not allow a second plan or a plan after cancellation", () => {
  const store = new SessionStore();
  const first = store.create(request());
  store.submitPlan(first.id, { items: [], warnings: [], summary: "无建议" });
  assert.throws(() => store.submitPlan(first.id, { items: [] }), /already been submitted/);

  const second = store.create(request());
  store.cancel(second.id);
  assert.throws(() => store.submitPlan(second.id, { items: [] }), /cancelled/);
});

test("expires old sessions", () => {
  const store = new SessionStore({ ttlMs: 60000 });
  const session = store.create(request());
  store.getInternal(session.id).expiresAt = "2020-01-01T00:00:00.000Z";
  store.prune(Date.now());
  assert.equal(store.get(session.id), null);
});

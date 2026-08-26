const test = require("node:test");
const assert = require("node:assert/strict");
const { AgentHostRegistry } = require("../src/agent-host.js");

test("registers replaceable Agent Host adapters", () => {
  const host = { run() {} };
  const registry = new AgentHostRegistry().register("codex", host);
  assert.equal(registry.get("codex"), host);
  assert.deepEqual(registry.list(), ["codex"]);
  assert.throws(() => registry.register("workbuddy", {}), /run/);
});

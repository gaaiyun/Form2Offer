const test = require("node:test");
const assert = require("node:assert/strict");

const { createBridgeServer } = require("../src/server.js");
const { SessionStore } = require("../src/session-store.js");
const { hashToken } = require("../src/security.js");
const { callTool, TOOLS, waitForSession, startMcpStdio, negotiateProtocol } = require("../src/mcp.js");

function makeRequest() {
  return {
    mode: "agent-pull",
    scan: { fields: [{ fieldId: "field-1", type: "textarea", label: "职业规划", canFill: true }] },
    profileCatalog: { fields: [{ path: "profile.questions.career", label: "职业规划" }] }
  };
}

test("HTTP bridge pairs extensions, enforces origin/token, and manages sessions", async () => {
  const browserToken = "existing-browser-token";
  const config = {
    host: "127.0.0.1",
    port: 0,
    pairCode: "123456",
    browserTokenHashes: [hashToken(browserToken)],
    mcpToken: "mcp-secret",
    codex: { enabled: false }
  };
  const sessionStore = new SessionStore();
  const bridge = createBridgeServer({
    config,
    sessionStore,
    sourceRegistry: { list: () => [], search: () => [] },
    codexHost: {},
    saveConfig: () => undefined
  });
  const address = await bridge.listen();
  const base = `http://127.0.0.1:${address.port}`;
  const extensionOrigin = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
  try {
    const health = await fetch(`${base}/v1/health`).then((response) => response.json());
    assert.equal(health.ok, true);

    const rejectedHealth = await fetch(`${base}/v1/health`, { headers: { origin: "https://jobs.example.com" } });
    assert.equal(rejectedHealth.status, 403);

    const rejectedPair = await fetch(`${base}/v1/pair`, {
      method: "POST",
      headers: { origin: "https://jobs.example.com", "content-type": "application/json" },
      body: JSON.stringify({ code: "123456" })
    });
    assert.equal(rejectedPair.status, 403);

    const unauthorized = await fetch(`${base}/v1/sources`, { headers: { origin: extensionOrigin } });
    assert.equal(unauthorized.status, 401);

    const createdResponse = await fetch(`${base}/v1/sessions`, {
      method: "POST",
      headers: { origin: extensionOrigin, authorization: `Bearer ${browserToken}`, "content-type": "application/json" },
      body: JSON.stringify(makeRequest())
    });
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json();
    assert.equal(created.data.state, "awaiting_agent");
  } finally {
    await bridge.close();
  }
});

test("MCP tool facade maps every public tool to bridge requests", async () => {
  const calls = [];
  const client = {
    async request(method, path, body) {
      calls.push({ method, path, body });
      return path.startsWith("/v1/sessions?state=awaiting_agent&wait=") ? { sessions: [{ id: "s9" }] } : { ok: true };
    }
  };
  assert.equal(TOOLS.length, 14);
  assert.equal(new Set(TOOLS.map((tool) => tool.name)).size, 14);
  await callTool(client, "form2offer_bridge_status", {});
  await callTool(client, "form2offer_list_sessions", { state: "awaiting_agent" });
  const waited = await callTool(client, "form2offer_wait_for_session", { timeoutSeconds: 5 });
  await callTool(client, "form2offer_get_session", { sessionId: "s1" });
  await callTool(client, "form2offer_search_resume", { query: "项目", limit: 3 });
  await callTool(client, "form2offer_submit_plan", { sessionId: "s1", plan: { items: [] } });
  await callTool(client, "form2offer_cancel_session", { sessionId: "s1" });
  await callTool(client, "form2offer_platform_guide", { url: "https://app.mokahr.com/x" });
  await callTool(client, "form2offer_platform_guide", { platform: "beisen" });
  await callTool(client, "form2offer_platform_guide", {});
  await callTool(client, "form2offer_analyze_job", { text: "JD", title: "销售" });
  await callTool(client, "form2offer_check_applied", { company: "示例" });
  await callTool(client, "form2offer_stage_profile", { package: { format: "Form2OfferProfileBackup" }, note: "n" });
  await callTool(client, "form2offer_list_tabs", { urlContains: "mokahr" });
  await callTool(client, "form2offer_read_form", { tabId: 7 });
  await callTool(client, "form2offer_debug_autofill", { urlContains: "zhiye", mode: "preview" });
  assert.equal(waited.sessions[0].id, "s9");
  assert.deepEqual(calls.map((call) => call.path), [
    "/v1/status",
    "/v1/sessions?state=awaiting_agent",
    "/v1/sessions?state=awaiting_agent&wait=5",
    "/v1/sessions/s1",
    "/v1/search",
    "/v1/sessions/s1/plan",
    "/v1/sessions/s1/cancel",
    "/v1/knowledge/platforms?url=https%3A%2F%2Fapp.mokahr.com%2Fx",
    "/v1/knowledge/platforms?id=beisen",
    "/v1/knowledge/platforms",
    "/v1/insight",
    "/v1/applications/check",
    "/v1/profile-package",
    "/v1/browser/tabs",
    "/v1/browser/read-form",
    "/v1/browser/debug-autofill"
  ]);
});

test("waiting gives up after the timeout with an empty list", async () => {
  let rounds = 0;
  const client = { async request() { rounds += 1; return { sessions: [] }; } };
  const result = await waitForSession(client, { timeoutSeconds: 1 });
  assert.equal(result.timedOut, true);
  assert.ok(rounds >= 1);
});

test("stage_profile reads an absolute JSON file and rejects relative paths", async () => {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "f2o-mcp-")), "profile.json");
  fs.writeFileSync(file, String.fromCharCode(0xFEFF) + JSON.stringify({ format: "Form2OfferProfileBackup", profileV2: { sections: {} } }), "utf8");
  const bodies = [];
  const client = { async request(method, pathname, body) { bodies.push(body); return { staged: true }; } };
  await callTool(client, "form2offer_stage_profile", { filePath: file, note: "合并" });
  assert.equal(bodies[0].package.format, "Form2OfferProfileBackup");
  await assert.rejects(() => callTool(client, "form2offer_stage_profile", { filePath: "profile.json" }), /绝对路径/);
});

test("MCP stdio negotiates protocol, exposes instructions and reports tool errors as results", async () => {
  const { PassThrough } = require("node:stream");
  const input = new PassThrough();
  const output = new PassThrough();
  const client = { async request() { throw new Error("Bridge 不可用"); } };
  startMcpStdio({ client, input, output });
  const lines = [];
  output.on("data", (chunk) => lines.push(...String(chunk).trim().split(String.fromCharCode(10))));
  input.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }) + String.fromCharCode(10));
  input.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "form2offer_bridge_status", arguments: {} } }) + String.fromCharCode(10));
  await new Promise((resolve) => setTimeout(resolve, 100));
  const [init, call] = lines.map((line) => JSON.parse(line));
  assert.equal(init.result.protocolVersion, "2025-06-18");
  assert.match(init.result.instructions, /审阅页/);
  assert.equal(negotiateProtocol("1999-01-01"), "2024-11-05");
  assert.equal(call.result.isError, true);
  assert.match(call.result.content[0].text, /不可用/);
});

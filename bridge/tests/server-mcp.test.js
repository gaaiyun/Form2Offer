const test = require("node:test");
const assert = require("node:assert/strict");

const { createBridgeServer } = require("../src/server.js");
const { SessionStore } = require("../src/session-store.js");
const { hashToken } = require("../src/security.js");
const { callTool, TOOLS } = require("../src/mcp.js");

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

test("MCP tool facade maps all five public tools to bridge requests", async () => {
  const calls = [];
  const client = {
    async request(method, path, body) {
      calls.push({ method, path, body });
      return { ok: true };
    }
  };
  assert.equal(TOOLS.length, 5);
  await callTool(client, "form2offer_list_sessions", { state: "awaiting_agent" });
  await callTool(client, "form2offer_get_session", { sessionId: "s1" });
  await callTool(client, "form2offer_search_resume", { query: "项目", limit: 3 });
  await callTool(client, "form2offer_submit_plan", { sessionId: "s1", plan: { items: [] } });
  await callTool(client, "form2offer_cancel_session", { sessionId: "s1" });
  assert.deepEqual(calls.map((call) => call.path), [
    "/v1/sessions?state=awaiting_agent",
    "/v1/sessions/s1",
    "/v1/search",
    "/v1/sessions/s1/plan",
    "/v1/sessions/s1/cancel"
  ]);
});

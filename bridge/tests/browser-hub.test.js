const test = require("node:test");
const assert = require("node:assert/strict");

const { createBridgeServer } = require("../src/server.js");
const { SessionStore } = require("../src/session-store.js");
const { hashToken } = require("../src/security.js");

const EXTENSION_ORIGIN = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
const BROWSER_TOKEN = "browser-token";
const MCP_TOKEN = "mcp-token";

async function startBridge(options = {}) {
  const config = {
    host: "127.0.0.1",
    port: 0,
    pairCode: "123456",
    browserTokenHashes: [hashToken(BROWSER_TOKEN)],
    mcpToken: MCP_TOKEN,
    codex: { enabled: false },
    resumeVersions: [],
    candidate: {}
  };
  const bridge = createBridgeServer({
    config,
    sessionStore: new SessionStore(),
    sourceRegistry: { list: () => [], search: () => [] },
    codexHost: {},
    browserWaitMs: options.browserWaitMs ?? 2000
  });
  const address = await bridge.listen();
  const base = `http://127.0.0.1:${address.port}`;
  const call = (method, pathname, { token = MCP_TOKEN, origin, body } = {}) => fetch(`${base}${pathname}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(origin ? { origin } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  }).then(async (response) => ({ status: response.status, json: await response.json() }));
  return { bridge, call, port: address.port };
}

// 模拟扩展后台：认证后响应 list_tabs / read_form，并记录 plan_ready 通知。
function connectFakeExtension(port, call, { token = BROWSER_TOKEN } = {}) {
  const events = [];
  const socket = new WebSocket(`ws://127.0.0.1:${port}/v1/ws`, { headers: { origin: EXTENSION_ORIGIN } });
  const ready = new Promise((resolve, reject) => {
    socket.addEventListener("open", () => socket.send(JSON.stringify({ type: "auth", token, info: { extensionVersion: "0.13.0", linkEnabled: true, includeValues: true } })));
    socket.addEventListener("close", () => reject(new Error("closed")));
    socket.addEventListener("error", () => reject(new Error("closed")));
    socket.addEventListener("message", async (event) => {
      const message = JSON.parse(event.data);
      events.push(message);
      if (message.type === "ready") resolve();
      if (message.type === "list_tabs") {
        socket.send(JSON.stringify({ replyTo: message.id, ok: true, data: { tabs: [{ tabId: 7, title: "申请职位", origin: "https://app.mokahr.com", active: true }] } }));
      }
      if (message.type === "read_form") {
        const created = await call("POST", "/v1/sessions", {
          token: BROWSER_TOKEN,
          origin: EXTENSION_ORIGIN,
          body: {
            mode: "agent-pull",
            initiator: "agent",
            scan: {
              origin: "https://app.mokahr.com",
              hostname: "app.mokahr.com",
              fields: [
                { fieldId: "f1", type: "text", label: "邮箱", currentValue: "demo@example.com", canFill: true },
                { fieldId: "f2", type: "text", label: "身份证号", currentValue: "110101200001011234", canFill: true },
                { fieldId: "f3", type: "textarea", label: "为什么申请", currentValue: "", canFill: true }
              ]
            },
            profileCatalog: { fields: [] },
            job: { company: "示例公司", title: "管培生" }
          }
        });
        socket.send(JSON.stringify({ replyTo: message.id, ok: true, data: { sessionId: created.json.data.id, tab: { tabId: 7 } } }));
      }
    });
  });
  return { socket, ready, events };
}

test("an agent can list tabs and read the browser form through the paired extension", async () => {
  const { bridge, call, port } = await startBridge();
  const extension = connectFakeExtension(port, call);
  try {
    await extension.ready;
    const status = await call("GET", "/v1/browser/status");
    assert.equal(status.json.data.connected, true);
    assert.equal(status.json.data.extensionVersion, "0.13.0");

    const tabs = await call("POST", "/v1/browser/tabs", { body: {} });
    assert.equal(tabs.json.data.tabs[0].tabId, 7);

    const read = await call("POST", "/v1/browser/read-form", { body: { tabId: 7 } });
    assert.equal(read.status, 200, JSON.stringify(read.json));
    const fields = read.json.data.session.request.scan.fields;
    assert.equal(fields[0].currentValue, "demo@example.com");
    assert.equal(fields[1].currentValue, "【已打码】");
    assert.equal(read.json.data.session.initiator, "agent");
    assert.equal(read.json.data.session.context.platform.id, "moka");

    const plan = await call("POST", `/v1/sessions/${read.json.data.session.id}/plan`, {
      body: { items: [{ fieldId: "f3", value: "因为岗位与实习经历相关。", confidence: 0.8, reason: "开放题" }] }
    });
    assert.equal(plan.status, 200);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.ok(extension.events.some((event) => event.type === "plan_ready" && event.sessionId === read.json.data.session.id));
  } finally {
    extension.socket.close();
    await bridge.close();
  }
});

test("browser routes require an agent token and a connected extension", async () => {
  const { bridge, call } = await startBridge({ browserWaitMs: 200 });
  try {
    const fromBrowser = await call("POST", "/v1/browser/read-form", { token: BROWSER_TOKEN, origin: EXTENSION_ORIGIN, body: {} });
    assert.equal(fromBrowser.status, 403);
    const disconnected = await call("POST", "/v1/browser/tabs", { body: {} });
    assert.equal(disconnected.status, 503);
    assert.match(disconnected.json.error, /浏览器扩展未连接/);
  } finally {
    await bridge.close();
  }
});

test("sockets without a valid pairing token are closed", async () => {
  const { bridge, call, port } = await startBridge();
  const extension = connectFakeExtension(port, call, { token: "wrong" });
  try {
    await assert.rejects(extension.ready, /closed/);
    const status = await call("GET", "/v1/browser/status");
    assert.equal(status.json.data.connected, false);
  } finally {
    await bridge.close();
  }
});

test("user-started sessions never carry current page values", async () => {
  const { bridge, call } = await startBridge();
  try {
    const created = await call("POST", "/v1/sessions", {
      token: BROWSER_TOKEN,
      origin: EXTENSION_ORIGIN,
      body: { mode: "agent-pull", scan: { fields: [{ fieldId: "f1", type: "text", label: "邮箱", currentValue: "demo@example.com", canFill: true }] }, profileCatalog: { fields: [] } }
    });
    const session = await call("GET", `/v1/sessions/${created.json.data.id}`);
    assert.equal(Object.hasOwn(session.json.data.request.scan.fields[0], "currentValue"), false);
  } finally {
    await bridge.close();
  }
});

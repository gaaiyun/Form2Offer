const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_CORE_PATH || "playwright-core");
const { hashToken } = require("../bridge/src/security.js");
const { SourceRegistry } = require("../bridge/src/sources.js");
const { SessionStore } = require("../bridge/src/session-store.js");
const { createBridgeServer } = require("../bridge/src/server.js");

const root = path.resolve(__dirname, "..");
const fixtureUrl = "http://127.0.0.1:4173/tests/fixtures/job-form.html";
const browserToken = "agent-smoke-browser-token";
const mcpToken = "agent-smoke-mcp-token";
const bridgePort = 43128;
const scripts = [
  "src/safety-policy.js", "src/date-utils.js", "src/project-utils.js", "src/profile-utils.js",
  "src/job-tracker.js", "src/answer-library.js", "src/content.js"
];

function makeExtensionCopy() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "form2offer-agent-extension-"));
  for (const name of ["src", "icons"]) fs.cpSync(path.join(root, name), path.join(directory, name), { recursive: true });
  for (const name of ["manifest.json", "sample-profile.json", "LICENSE", "NOTICE"]) fs.copyFileSync(path.join(root, name), path.join(directory, name));
  const manifestPath = path.join(directory, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.host_permissions = ["http://127.0.0.1:4173/*", `http://127.0.0.1:${bridgePort}/*`];
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return directory;
}

async function runtimeMessage(page, message) {
  return page.evaluate((request) => new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(request, (response) => {
      const error = chrome.runtime.lastError;
      if (error) return reject(new Error(error.message));
      if (!response?.ok) return reject(new Error(response?.error || "runtime message failed"));
      resolve(response.data);
    });
  }), message);
}

async function main() {
  const sourceRoot = fs.mkdtempSync(path.join(root, "output", "bridge-tests", "agent-e2e-"));
  fs.writeFileSync(path.join(sourceRoot, "resume.md"), "# 测试资料\nGPA 3.8/4.0\n电话 13912345678", "utf8");
  const config = {
    host: "127.0.0.1", port: bridgePort, pairCode: "123456",
    browserTokenHashes: [hashToken(browserToken)], mcpToken,
    codex: { enabled: false }, resumeRoot: sourceRoot, sources: ["resume.md"]
  };
  const bridge = createBridgeServer({
    config,
    sessionStore: new SessionStore(),
    sourceRegistry: new SourceRegistry(config),
    codexHost: { run() { throw new Error("Codex must not run in agent-pull smoke test"); }, cleanup() {} }
  });
  await bridge.listen();
  const extensionDir = makeExtensionCopy();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "form2offer-agent-browser-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`]
  });
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
    const extensionId = new URL(worker.url()).hostname;
    const fixture = await context.newPage();
    await fixture.goto(fixtureUrl);
    await fixture.evaluate(() => {
      const input = document.createElement("input"); input.type = "file"; input.id = "resumeUpload";
      const label = document.createElement("label"); label.htmlFor = input.id; label.textContent = "上传简历";
      document.getElementById("applicationForm").append(label, input);
      window.__form2OfferUploadClicks = 0;
      input.addEventListener("click", () => { window.__form2OfferUploadClicks += 1; });
    });
    const fixtureTabId = await worker.evaluate(async (contentScripts) => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: contentScripts });
      return tab.id;
    }, scripts);
    const snapshot = await worker.evaluate(async (tabId) => new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, { type: "OJAF_GET_AGENT_SNAPSHOT" }, (response) => {
        const error = chrome.runtime.lastError;
        if (error) return reject(new Error(error.message));
        if (!response?.ok) return reject(new Error(response?.error));
        resolve(response.data);
      });
    }), fixtureTabId);
    const nameField = snapshot.scan.fields.find((field) => /姓名/.test(field.label));
    const idField = snapshot.scan.fields.find((field) => /身份证/.test(field.label));
    const uploadField = snapshot.scan.fields.find((field) => /上传简历/.test(field.label));
    assert.ok(nameField && idField && uploadField, "expected ordinary, sensitive, and upload fields");

    await worker.evaluate(async (agentConfig) => chrome.storage.local.set({ agentConfig }), {
      bridgeUrl: `http://127.0.0.1:${bridgePort}`, token: browserToken, mode: "agent-pull", timeoutMs: 60000
    });
    const initiator = await context.newPage();
    await initiator.goto(`chrome-extension://${extensionId}/src/options.html`);
    const session = await runtimeMessage(initiator, {
      type: "OJAF_AGENT_CREATE_SESSION",
      payload: { tabId: fixtureTabId, snapshot, mode: "agent-pull" }
    });
    await initiator.close();

    const before = await fixture.evaluate(() => ({ name: candidateName.value, id: idNumber.value, submit: window.__form2OfferSubmitCount, upload: window.__form2OfferUploadClicks }));
    assert.deepEqual(before, { name: "", id: "", submit: 0, upload: 0 });

    const response = await fetch(`http://127.0.0.1:${bridgePort}/v1/sessions/${encodeURIComponent(session.id)}/plan`, {
      method: "POST",
      headers: { authorization: `Bearer ${mcpToken}`, "content-type": "application/json" },
      body: JSON.stringify({ summary: "浏览器 Agent 回归", warnings: [], items: [
        { fieldId: nameField.fieldId, sourcePath: "", value: "Agent 测试姓名", confidence: 0.96, risk: "standard", reason: "普通文本字段", evidence: [] },
        { fieldId: idField.fieldId, sourcePath: "", value: "SHOULD-NOT-FILL", confidence: 0.99, risk: "sensitive", reason: "敏感字段", evidence: [] },
        { fieldId: uploadField.fieldId, sourcePath: "", value: "SHOULD-NOT-UPLOAD", confidence: 0.99, risk: "blocked", reason: "文件上传", evidence: [] }
      ] })
    });
    assert.equal(response.ok, true);
    const submitted = await response.json();
    assert.equal(submitted.data.plan.items.length, 1, JSON.stringify(submitted.data.plan));
    assert.equal(submitted.data.plan.rejected.length, 2, JSON.stringify(submitted.data.plan));

    const review = await context.newPage();
    await review.goto(`chrome-extension://${extensionId}/src/agent-review.html?session=${encodeURIComponent(session.id)}`);
    await review.locator("#planCard:not([hidden])").waitFor();
    await review.locator("[data-agent-field]").waitFor();
    assert.equal(await review.locator("[data-agent-field]").count(), 1);
    const stillUntouched = await fixture.evaluate(() => candidateName.value);
    assert.equal(stillUntouched, "", "unconfirmed plan must not modify the page");
    await review.locator("#applyBtn").click();
    await fixture.waitForFunction(() => candidateName.value === "Agent 测试姓名");
    const after = await fixture.evaluate(() => ({ name: candidateName.value, id: idNumber.value, submit: window.__form2OfferSubmitCount, upload: window.__form2OfferUploadClicks }));
    assert.deepEqual(after, { name: "Agent 测试姓名", id: "", submit: 0, upload: 0 });
    process.stdout.write(`${JSON.stringify({ sessionId: session.id, acceptedItems: 1, rejectedItems: 2, before, after }, null, 2)}\n`);
  } finally {
    await context.close();
    await bridge.close();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

// 端到端验证“Agent 主动读取浏览器表单”整条链路：
// 真实 Bridge 进程 + MCP stdio 客户端（与 Claude Code / Codex 相同的接入方式）+ 加载扩展的 Chromium。
// 用法：先在仓库根目录起静态服务（python -m http.server 4173 --bind 127.0.0.1），再运行
//   PLAYWRIGHT_CORE_PATH=... PLAYWRIGHT_CHROMIUM_EXECUTABLE=... node scripts/qa-agent-link-e2e.js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");

const { chromium } = require(process.env.PLAYWRIGHT_CORE_PATH || "playwright-core");

const rootDir = path.resolve(__dirname, "..");
const workDir = fs.mkdtempSync(path.join(rootDir, "output", "agent-link-e2e-"));
const fixtureUrl = process.env.FORM2OFFER_MOKA_FIXTURE_URL || "http://127.0.0.1:4173/tests/fixtures/moka-like.html";
const bridgePort = 43000 + Math.floor(Math.random() * 900);
const browserToken = crypto.randomBytes(24).toString("base64url");
const mcpToken = crypto.randomBytes(24).toString("base64url");
const bridgeEntry = path.join(rootDir, "bridge", "bin", "form2offer-bridge.js");

function log(message) {
  process.stdout.write(`${message}\n`);
}

function writeBridgeConfig(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const config = {
    version: 1,
    host: "127.0.0.1",
    port: bridgePort,
    pairCode: "123456",
    browserTokenHashes: [crypto.createHash("sha256").update(browserToken, "utf8").digest("hex")],
    mcpToken,
    resumeRoot: "",
    sources: [],
    applicationsFile: path.join(dataDir, "applications.json"),
    resumeVersions: [{ id: "13", label: "渠道销售与商务客户发展", families: ["sales"], keywords: ["渠道", "客户"] }],
    candidate: { schoolTier: "other", degree: "master", classYear: 2027, majorKeywords: ["金融"] },
    codex: { enabled: false, command: "codex", timeoutMs: 180000 }
  };
  fs.writeFileSync(path.join(dataDir, "bridge-config.json"), JSON.stringify(config, null, 2));
  fs.writeFileSync(config.applicationsFile, JSON.stringify({ current: [{ company: "示例消费品", role: "电商运营", status: "submitted", scope: "company" }] }));
}

function createExtensionCopy() {
  const extensionDir = path.join(workDir, "extension");
  for (const name of ["src", "icons", "assets"]) {
    fs.cpSync(path.join(rootDir, name), path.join(extensionDir, name), { recursive: true });
  }
  for (const name of ["manifest.json", "LICENSE", "NOTICE"]) {
    fs.copyFileSync(path.join(rootDir, name), path.join(extensionDir, name));
  }
  const manifestPath = path.join(extensionDir, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  // 测试副本预先授予本机地址权限，相当于用户在设置页点了“允许本地 Agent 读取浏览器表单”。
  manifest.host_permissions = ["http://127.0.0.1/*"];
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return extensionDir;
}

function startMcpClient(dataDir) {
  const child = spawn(process.execPath, [bridgeEntry, "mcp", "--data-dir", dataDir], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  let buffer = "";
  const pending = new Map();
  let nextId = 1;
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (!line.trim()) continue;
      const message = JSON.parse(line);
      pending.get(message.id)?.(message);
    }
  });
  const rpc = (method, params) => new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
  const call = async (name, args = {}) => {
    const response = await rpc("tools/call", { name, arguments: args });
    const text = response.result?.content?.[0]?.text || "";
    if (response.result?.isError || response.error) {
      throw new Error(`${name} failed: ${text || JSON.stringify(response.error)}`);
    }
    return JSON.parse(text);
  };
  return { child, rpc, call };
}

async function waitFor(check, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function main() {
  const dataDir = path.join(workDir, "bridge-data");
  writeBridgeConfig(dataDir);
  const extensionDir = createExtensionCopy();
  const mcp = startMcpClient(dataDir);
  const init = await mcp.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "agent-link-e2e", version: "1" } });
  log(`MCP: ${init.result.serverInfo.name} ${init.result.serverInfo.version}`);

  // MCP 进程会自动拉起 Bridge（bridge_status 第一次调用时）。
  const status = await mcp.call("form2offer_bridge_status");
  assert.equal(status.version, require(path.join(rootDir, "bridge", "package.json")).version);
  log("Bridge auto-started by MCP: ok");

  const context = await chromium.launchPersistentContext(path.join(workDir, "chromium-profile"), {
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || chromium.executablePath(),
    headless: false,
    viewport: { width: 1280, height: 900 },
    args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`]
  });
  const pageErrors = [];
  context.on("page", (page) => page.on("pageerror", (error) => pageErrors.push(`${page.url()}: ${error.message}`)));
  try {
    let worker = context.serviceWorkers().find((item) => item.url().startsWith("chrome-extension://"));
    if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: 15000 });
    await worker.evaluate(async ({ bridgeUrl, token }) => {
      await chrome.storage.local.set({
        profileV2: {
          schemaVersion: 2,
          updatedAt: "",
          customSections: [],
          sections: {
            basic: { key: "basic", title: "基本信息", kind: "simple", values: { 姓名: "测试同学", 邮箱: "test@example.com" } },
            education: { key: "education", title: "教育经历", kind: "repeat", items: [{ title: "教育 1", values: { 学校: "示例大学", 专业: "金融", 学历: "硕士研究生", 专业排名: "前10%", 开始时间: "2025-09", 结束时间: "2027-06" } }] },
            internship: { key: "internship", title: "实习经历", kind: "repeat", items: [{ title: "实习 1", values: { 公司: "示例公司", 职位: "数据分析实习生", 开始时间: "2026-03", 结束时间: "2026-07" } }] }
          }
        },
        fillPolicy: { overwriteExisting: false, fillSensitive: false, fillDeclarations: false },
        agentConfig: { bridgeUrl, token, mode: "agent-pull", timeoutMs: 180000 },
        agentLink: { enabled: true, includeValues: true }
      });
    }, { bridgeUrl: `http://127.0.0.1:${bridgePort}`, token: browserToken });

    const formPage = await context.newPage();
    await formPage.goto(fixtureUrl);
    await formPage.bringToFront();

    const connected = await waitFor(async () => {
      const current = await mcp.call("form2offer_bridge_status");
      return current.browser?.connected ? current.browser : null;
    }, 40000, "extension to connect to the bridge");
    log(`Extension connected: ${connected.extensionVersion} canReadAllSites=${connected.canReadAllSites}`);

    const tabs = await mcp.call("form2offer_list_tabs", { urlContains: "moka-like" });
    assert.equal(tabs.tabs.length, 1);
    log(`list_tabs: ${tabs.tabs[0].title} (${tabs.tabs[0].platform || "未识别平台"})`);

    const read = await mcp.call("form2offer_read_form", { tabId: tabs.tabs[0].tabId });
    const session = read.session;
    const fields = session.request.scan.fields;
    const byLabel = (pattern) => fields.find((field) => pattern.test(field.label));
    assert.equal(byLabel(/^姓名$/)?.label, "姓名", "bilingual Moka title should normalize to 姓名");
    assert.equal(byLabel(/邮箱/).currentValue, "prefilled-wrong@example.com");
    assert.equal(byLabel(/身份证/).currentValue, "【已打码】");
    assert.equal(byLabel(/为什么申请/).maxLength, 300);
    assert.equal(session.context.platform?.id, "moka");
    assert.equal(session.context.applied.blocking, true);
    assert.equal(session.context.insight.analysis.primaryFamily.id, "sales");
    assert.equal(session.context.insight.recommendedResume.id, "13");
    log(`read_form: ${fields.length} fields, platform=${session.context.platform.name}, applied.blocking=${session.context.applied.blocking}`);

    const catalog = session.request.profileCatalog.fields;
    const pathFor = (label) => catalog.find((field) => field.label === label)?.path;
    const plan = {
      summary: "E2E：姓名、排名、实习开始时间与开放题。",
      warnings: ["投递记录显示该公司已投递。"],
      items: [
        { fieldId: byLabel(/^姓名$/).fieldId, sourcePath: pathFor("姓名"), confidence: 0.95, reason: "姓名" },
        { fieldId: byLabel(/专业排名/).fieldId, sourcePath: pathFor("专业排名"), confidence: 0.9, reason: "排名" },
        { fieldId: byLabel(/实习开始时间/).fieldId, sourcePath: catalog.find((field) => /实习/.test(field.path) && field.label === "开始时间")?.path || pathFor("开始时间"), confidence: 0.85, reason: "实习开始" },
        { fieldId: byLabel(/为什么申请/).fieldId, value: "实习中做过渠道数据分析，想把这段经历用在一线渠道开拓上。", confidence: 0.8, reason: "开放题" },
        { fieldId: byLabel(/身份证/).fieldId, value: "不应执行", confidence: 0.9, reason: "敏感字段应被拒绝" }
      ]
    };
    const reviewPromise = context.waitForEvent("page", { predicate: (page) => page.url().includes("agent-review.html"), timeout: 20000 });
    const submitted = await mcp.call("form2offer_submit_plan", { sessionId: session.id, plan });
    assert.equal(submitted.state, "review_ready");
    assert.ok(submitted.plan.rejected.some((item) => /sensitive|blocked/.test(item.reason)));
    const reviewPage = await reviewPromise;
    await reviewPage.waitForSelector("#applyBtn:not([disabled])", { timeout: 20000 });
    log("Review page opened automatically after submit_plan");

    const before = await formPage.evaluate(() => document.getElementById("candidateName").value);
    assert.equal(before, "", "page must not change before the user confirms");
    await reviewPage.click("#applyBtn");
    await reviewPage.waitForSelector(".feedback.success", { timeout: 30000 });

    const after = await formPage.evaluate(() => ({
      name: document.getElementById("candidateName").value,
      email: document.getElementById("email").value,
      rank: document.getElementById("rank").selectedOptions[0]?.textContent || "",
      internStart: document.getElementById("internStart").value,
      whyApply: document.getElementById("whyApply").value,
      idNumber: document.getElementById("idNumber").value,
      submitCount: window.__form2OfferSubmitCount,
      uploadCount: window.__form2OfferUploadCount
    }));
    log(`After confirm: ${JSON.stringify(after)}`);
    assert.equal(after.name, "测试同学");
    assert.equal(after.email, "prefilled-wrong@example.com", "existing values are not overwritten");
    assert.equal(after.rank, "前20%", "rank 前10% maps to the conservative 前20% bucket");
    assert.equal(after.internStart, "2026-03-01", "month-only start date projects to the first day");
    assert.match(after.whyApply, /渠道/);
    assert.equal(after.idNumber, "110101200001011234");
    assert.equal(after.submitCount, 0);
    assert.equal(after.uploadCount, 0);
    assert.deepEqual(pageErrors, []);
    await reviewPage.screenshot({ path: path.join(rootDir, "output", "playwright", "agent-review-e2e.png"), fullPage: true });
    log("Agent link E2E: PASS");
  } finally {
    await context.close().catch(() => undefined);
    mcp.child.kill();
    // 结束 MCP 自动拉起的 Bridge 进程。
    await fetch(`http://127.0.0.1:${bridgePort}/v1/shutdown`, { method: "POST", headers: { authorization: `Bearer ${mcpToken}` } }).catch(() => undefined);
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});

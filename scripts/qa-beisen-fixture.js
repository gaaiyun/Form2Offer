// 在北森 Phoenix 复刻页上跑真实扩展（本地规则，不调 AI），输出逐字段结果。
// 用法：node scripts/qa-beisen-fixture.js [--json out.json]
// 环境变量：FORM2OFFER_QA_PROFILE=含 profileV2 的备份 JSON（默认 sample-profile.json）
//          PLAYWRIGHT_CORE_PATH / PLAYWRIGHT_CHROMIUM_EXECUTABLE / FORM2OFFER_QA_TMP
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");

const { chromium } = require(process.env.PLAYWRIGHT_CORE_PATH || "playwright-core");
const rootDir = path.resolve(__dirname, "..");
const tmpRoot = process.env.FORM2OFFER_QA_TMP || os.tmpdir();
const profilePath = process.env.FORM2OFFER_QA_PROFILE || path.join(rootDir, "sample-profile.json");
const jsonOut = process.argv.includes("--json") ? process.argv[process.argv.indexOf("--json") + 1] : "";

function startServer() {
  const server = http.createServer((req, res) => {
    const file = path.join(rootDir, decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (!file.startsWith(rootDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { "content-type": file.endsWith(".html") ? "text/html; charset=utf-8" : "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

function copyExtension() {
  const dir = fs.mkdtempSync(path.join(tmpRoot, "form2offer-ext-"));
  for (const name of ["src", "icons", "assets"]) {
    if (fs.existsSync(path.join(rootDir, name))) fs.cpSync(path.join(rootDir, name), path.join(dir, name), { recursive: true });
  }
  for (const name of ["manifest.json", "sample-profile.json"]) fs.copyFileSync(path.join(rootDir, name), path.join(dir, name));
  const manifestPath = path.join(dir, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.host_permissions = ["http://127.0.0.1/*"];
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  // 调试用：FORM2OFFER_QA_PATCH 指向导出 [[文件, 查找, 替换], ...] 的模块，只改临时副本。
  if (process.env.FORM2OFFER_QA_PATCH) {
    for (const [file, find, replace] of require(path.resolve(process.env.FORM2OFFER_QA_PATCH))) {
      const target = path.join(dir, file);
      const source = fs.readFileSync(target, "utf8");
      if (!source.includes(find)) throw new Error(`patch target not found in ${file}: ${find.slice(0, 60)}`);
      fs.writeFileSync(target, source.replace(find, replace));
    }
  }
  return dir;
}

async function main() {
  const backup = JSON.parse(fs.readFileSync(profilePath, "utf8"));
  const fillPolicy = { overwriteExisting: false, fillSensitive: true, fillDeclarations: false, fillIdentity: false };
  const server = await startServer();
  const port = server.address().port;
  const extensionDir = copyExtension();
  const userDataDir = fs.mkdtempSync(path.join(tmpRoot, "form2offer-qa-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
    headless: false,
    viewport: { width: 1400, height: 1000 },
    args: ["--headless=new", `--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`]
  });
  const errors = [];
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker", { timeout: 15000 });
    await worker.evaluate(async ({ profileV2, fillPolicy }) => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      await chrome.storage.local.set({ profileV2, fillPolicy });
    }, { profileV2: backup.profileV2, fillPolicy });

    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.text().startsWith("[F2O-DEBUG]")) console.log(message.text());
    });
    await page.goto(`http://127.0.0.1:${port}/tests/fixtures/beisen-phoenix.html`);
    await page.bringToFront();

    const run = await worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      // 与 background.js 的 CONTENT_SCRIPT_FILES 保持一致。
      const files = ["src/safety-policy.js", "src/date-utils.js", "src/project-utils.js", "src/profile-utils.js",
        "src/job-tracker.js", "src/answer-library.js", "src/platform-knowledge.js", "src/fill-rules.js", "src/content.js"];
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files });
      const result = await chrome.tabs.sendMessage(tab.id, { type: "OJAF_START_AUTOFILL" });
      const debug = await chrome.tabs.sendMessage(tab.id, { type: "OJAF_GET_DEBUG_SNAPSHOT" });
      return { result, debug };
    });

    const form = await page.evaluate(() => Array.from(document.querySelectorAll(".form-item")).map((item) => {
      const label = item.querySelector(".form-item__text")?.textContent.trim() || "";
      const input = item.querySelector("input.phoenix-input__input, textarea");
      const select = item.querySelector(".phoenix-select");
      const radio = item.querySelector(".phoenix-radio--checked .phoenix-radio__radio-text");
      const value = radio?.textContent.trim() || select?.dataset.value || input?.value || "";
      const record = item.closest("[data-record]")?.getAttribute("data-record") || "";
      const now = item.closest(".fields-col")?.querySelector(".phoenix-checkbox__input")?.checked ? " [至今]" : "";
      const mark = (item.querySelector("[data-ojaf-mark]") || item.closest("[data-ojaf-mark]"))?.getAttribute("data-ojaf-mark") || "";
      const note = (item.querySelector("[data-ojaf-mark]") || {}).title || "";
      const fieldIds = Array.from(item.querySelectorAll("[data-ojaf-field-id]")).map((node) => node.getAttribute("data-ojaf-field-id"));
      return { record, label, value: value.slice(0, 40) + now, mark, note: note.slice(0, 80), fieldIds };
    }));

    const debug = run.debug?.data || run.debug || {};
    const resultById = new Map((debug.results || []).map((result) => [result.id, result]));
    const candidateById = new Map((debug.candidates || []).map((candidate) => [candidate.fieldId, candidate]));
    for (const row of form) {
      const fieldId = row.fieldIds.find((id) => candidateById.has(id)) || "";
      const candidate = candidateById.get(fieldId);
      const result = resultById.get(`candidate_${fieldId}`);
      row.source = candidate ? `${candidate.sourceSubsection || candidate.sourceCategory}/${candidate.sourceLabel} s=${candidate.score}${candidate.shouldAutoFill ? "" : " 待确认"}` : "";
      row.result = result ? (result.ok ? "ok" : `FAIL ${result.note}`) : "";
    }
    const out = { summary: run.result?.data?.summary || run.result?.data || run.result, candidates: debug.candidates, results: debug.results, scan: debug.scan, form, errors };
    if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(out, null, 2));
    console.log("records:", JSON.stringify(await page.evaluate(() => ({
      education: document.querySelectorAll('[data-repeat="education"] > [data-record]').length,
      internship: document.querySelectorAll('[data-repeat="internship"] > [data-record]').length
    }))));
    for (const row of form) console.log(`${row.record.padEnd(13)} ${row.label.padEnd(8)} = ${row.value.padEnd(30)} | ${row.source} | ${row.result}`);
    if (errors.length) console.log("page errors:", errors);
  } finally {
    await context.close();
    server.close();
    fs.rmSync(extensionDir, { recursive: true, force: true });
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

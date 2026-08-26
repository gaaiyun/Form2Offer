const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { CodexHost } = require("../bridge/src/codex-host.js");
const { SourceRegistry } = require("../bridge/src/sources.js");
const { validateAgentFillPlan } = require("../bridge/src/plan.js");

async function main() {
  const dataDir = path.join(__dirname, "..", "output", "codex-live", crypto.randomUUID());
  const sourceRoot = path.join(dataDir, "source");
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, "resume.md"), "# 虚构测试资料\n本科 GPA：3.80/4.00\n", "utf8");
  const registry = new SourceRegistry({ resumeRoot: sourceRoot, sources: ["resume.md"] });
  const session = {
    id: `session-${crypto.randomUUID()}`,
    request: {
      mode: "codex",
      page: { origin: "https://jobs.example.test", hostname: "jobs.example.test", title: "测试表单" },
      scan: { fields: [{ fieldId: "field-gpa", type: "text", label: "本科 GPA", canFill: true, options: [] }] },
      profileCatalog: { fields: [{ path: "profile.education.gpa", label: "教育经历 / 本科 GPA", aliases: ["绩点"] }] },
      jobContext: "纯虚构自动化回归"
    }
  };
  const host = new CodexHost({ command: "codex", timeoutMs: 180000, dataDir, sourceRegistry: registry });
  const task = host.run(session);
  try {
    const raw = await task.promise;
    const plan = validateAgentFillPlan(raw, session);
    assert.equal(plan.items.length, 1, JSON.stringify(plan));
    assert.equal(plan.items[0].sourcePath, "profile.education.gpa");
    process.stdout.write(`${JSON.stringify({ ok: true, sessionId: session.id, plan }, null, 2)}\n`);
  } finally {
    host.cleanup(task.taskDir);
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

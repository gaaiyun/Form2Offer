"use strict";

const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const { spawn } = require("node:child_process");

const BRIDGE_VERSION = require("../package.json").version;
const SUPPORTED_PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const MAX_WAIT_SECONDS = 600;
const MAX_PROFILE_FILE_BYTES = 900 * 1024;

const INSTRUCTIONS = [
  "Form2Offer 是本地网申填表助手。Agent 只提交填写方案，用户在扩展审阅页勾选确认后才会写入招聘网页。",
  "主动读取浏览器：form2offer_list_tabs 列出用户浏览器里打开的网页；form2offer_read_form 读取当前或指定标签页的表单（字段、选项、必填、字数上限、当前已填内容，证件号/密码/验证码会打码），同时返回一个可直接提交方案的 session。",
  "提交方案后扩展会自动弹出审阅页给用户确认。浏览器未连接时，提示用户打开 Edge、确认 Form2Offer 已配对并在设置页开启“允许本地 Agent 读取浏览器表单”。",
  "领取任务：用户在招聘页点“交给本地 Agent”（MCP 模式）后，用 form2offer_wait_for_session 等待或 form2offer_list_sessions 查看 awaiting_agent 任务。",
  "读任务：form2offer_get_session 返回字段（含 maxLength）、资料路径目录 profileCatalog，以及 context：平台坑点 tips/agentNotes、通用规则 generalRules、岗位速读 insight、投递查重 applied。",
  "出方案：普通字段优先给 sourcePath；开放题可直接给 value，但必须能在 form2offer_search_resume 找到证据，不编造经历和数字，并遵守 maxLength。",
  "context.applied.blocking 为 true 表示该公司已投递或结果未知，先提醒用户再继续；insight.assessment.verdict 为 block 表示有硬门槛不满足。",
  "证件、联系方式、家庭、健康、声明、上传、验证码和最终提交不会被执行，不要放进方案。",
  "资料底稿更新：把 Form2Offer 备份 JSON 用 form2offer_stage_profile 暂存，用户在扩展设置页预览后导入。"
].join("\n");

const PLAN_SCHEMA = {
  type: "object",
  required: ["items"],
  properties: {
    summary: { type: "string", description: "一两句话说明方案覆盖了哪些部分。" },
    warnings: { type: "array", items: { type: "string" }, description: "需要用户注意的问题，如已投递、门槛不满足、字段缺资料。" },
    items: {
      type: "array",
      items: {
        type: "object",
        required: ["fieldId"],
        properties: {
          fieldId: { type: "string", description: "来自 session.request.scan.fields 的 fieldId。" },
          sourcePath: { type: "string", description: "profileCatalog 中的 path；有它时不要给 value。" },
          value: { type: "string", description: "仅开放题等无对应资料路径时直接给文本。" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          risk: { type: "string", enum: ["standard"] },
          reason: { type: "string" },
          evidence: {
            type: "array",
            items: {
              type: "object",
              properties: { source: { type: "string" }, section: { type: "string" }, excerpt: { type: "string" } }
            }
          }
        }
      }
    }
  }
};

const TOOLS = [
  {
    name: "form2offer_bridge_status",
    title: "Bridge 状态",
    description: "Show Form2Offer Bridge status: version, approved resume sources, applications file, resume versions, staged profile and current sessions.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true }
  },
  {
    name: "form2offer_list_sessions",
    title: "列出任务",
    description: "List current Form2Offer browser form sessions waiting for an agent or review.",
    inputSchema: { type: "object", properties: { state: { type: "string", description: "awaiting_agent / queued / running / review_ready / failed / cancelled" } }, additionalProperties: false },
    annotations: { readOnlyHint: true }
  },
  {
    name: "form2offer_wait_for_session",
    title: "等待新任务",
    description: "Wait until the user hands a recruitment form to the local agent (state awaiting_agent by default). Returns as soon as one exists, or an empty list after the timeout.",
    inputSchema: {
      type: "object",
      properties: {
        state: { type: "string", default: "awaiting_agent" },
        timeoutSeconds: { type: "integer", minimum: 1, maximum: MAX_WAIT_SECONDS, default: 120 }
      },
      additionalProperties: false
    },
    annotations: { readOnlyHint: true }
  },
  {
    name: "form2offer_list_tabs",
    title: "列出浏览器标签页",
    description: "List http(s) tabs open in the user's browser (tabId, title, origin, path, active, detected recruitment platform). Requires the extension link to be enabled.",
    inputSchema: { type: "object", properties: { urlContains: { type: "string", description: "只列出 URL 含该文字的标签页" } }, additionalProperties: false },
    annotations: { readOnlyHint: true }
  },
  {
    name: "form2offer_read_form",
    title: "读取浏览器表单",
    description: "Read the application form in the user's browser tab (the active tab by default, or tabId / urlContains): fields with labels, options, required flags, maxLength and current values (secrets masked), platform tips, job insight and applied check. Returns a session you can answer with form2offer_submit_plan.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "integer", description: "form2offer_list_tabs 返回的 tabId；不填则读当前活动标签页" },
        urlContains: { type: "string", description: "按 URL 片段选择标签页" },
        includeValues: { type: "boolean", default: true, description: "是否带回网页当前已填内容（需扩展设置允许）" }
      },
      additionalProperties: false
    },
    annotations: { readOnlyHint: true }
  },
  {
    name: "form2offer_debug_autofill",
    title: "调试自动填写",
    description: "Debug the extension's autofill on a browser tab. mode=last returns the per-field record of the user's last “开始填写” run (matched profile field, score, policy decision, fill result note). mode=preview computes a read-only plan with the current profile and safety policy without clicking or writing.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "integer" },
        urlContains: { type: "string" },
        mode: { type: "string", enum: ["last", "preview"], default: "last" }
      },
      additionalProperties: false
    },
    annotations: { readOnlyHint: true }
  },
  {
    name: "form2offer_get_session",
    title: "读取任务",
    description: "Read one sanitized session: form fields (with maxLength), profile field paths, job context, and context with platform tips, job insight and applied check.",
    inputSchema: { type: "object", required: ["sessionId"], properties: { sessionId: { type: "string" } }, additionalProperties: false },
    annotations: { readOnlyHint: true }
  },
  {
    name: "form2offer_search_resume",
    title: "检索简历底稿",
    description: "Search redacted content in the user's explicitly approved resume source files. Use it to find evidence for every value you propose.",
    inputSchema: { type: "object", required: ["query"], properties: { query: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 20 } }, additionalProperties: false },
    annotations: { readOnlyHint: true }
  },
  {
    name: "form2offer_submit_plan",
    title: "提交填写方案",
    description: "Submit a structured AgentFillPlan for user review. This never writes the page directly; the user confirms each item in the extension.",
    inputSchema: { type: "object", required: ["sessionId", "plan"], properties: { sessionId: { type: "string" }, plan: PLAN_SCHEMA }, additionalProperties: false }
  },
  {
    name: "form2offer_cancel_session",
    title: "取消任务",
    description: "Cancel a Form2Offer session.",
    inputSchema: { type: "object", required: ["sessionId"], properties: { sessionId: { type: "string" } }, additionalProperties: false },
    annotations: { destructiveHint: true }
  },
  {
    name: "form2offer_platform_guide",
    title: "网申平台指南",
    description: "Get recorded behaviour of a Chinese recruitment platform (Moka, Beisen, 51job, HotJob, Feishu, bank portals…): resume parsing overwrite risk, save/submit evidence, apply limits, control quirks. Pass a page url or platform id; with neither, list all platforms.",
    inputSchema: { type: "object", properties: { url: { type: "string" }, platform: { type: "string" } }, additionalProperties: false },
    annotations: { readOnlyHint: true }
  },
  {
    name: "form2offer_analyze_job",
    title: "岗位速读",
    description: "Analyze a job description locally: job family, hard requirements (school tier, degree, English score, major, graduation year), apply limit, a verdict against the user's configured thresholds, and the recommended resume version.",
    inputSchema: { type: "object", required: ["text"], properties: { text: { type: "string" }, title: { type: "string" } }, additionalProperties: false },
    annotations: { readOnlyHint: true }
  },
  {
    name: "form2offer_check_applied",
    title: "投递查重",
    description: "Check the configured applications file for earlier applications to a company (aliases supported). blocking=true means submitted, offer or unknown result; do not apply again without the user's explicit decision.",
    inputSchema: { type: "object", properties: { company: { type: "string" }, role: { type: "string" }, hostname: { type: "string" } }, additionalProperties: false },
    annotations: { readOnlyHint: true }
  },
  {
    name: "form2offer_stage_profile",
    title: "暂存资料底稿",
    description: "Stage an updated Form2Offer profile backup (format Form2OfferProfileBackup) for the user to preview and import in the extension options page. Pass the JSON object as package, or an absolute .json filePath.",
    inputSchema: {
      type: "object",
      properties: {
        package: { type: "object" },
        filePath: { type: "string" },
        note: { type: "string", description: "说明这次更新改了什么，会显示给用户。" }
      },
      additionalProperties: false
    }
  }
];

function isConnectionError(error) {
  const code = error?.cause?.code || error?.code || "";
  return /ECONNREFUSED|ECONNRESET|UND_ERR_SOCKET|fetch failed/i.test(`${code} ${error?.message || ""}`);
}

function createHttpClient(options) {
  const baseUrl = String(options.baseUrl || "http://127.0.0.1:43127").replace(/\/$/, "");
  const token = String(options.token || "");
  const ensureRunning = typeof options.ensureRunning === "function" ? options.ensureRunning : null;
  const fetchImpl = options.fetchImpl || fetch;
  async function send(method, pathname, body, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${baseUrl}${pathname}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(body ? { "content-type": "application/json" } : {})
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw Object.assign(new Error(payload.error || `Bridge returned HTTP ${response.status}.`), { bridgeResponse: true });
      }
      return payload.data;
    } finally {
      clearTimeout(timer);
    }
  }
  async function request(method, pathname, body, requestOptions = {}) {
    const timeoutMs = Number(requestOptions.timeoutMs) || 30000;
    try {
      return await send(method, pathname, body, timeoutMs);
    } catch (error) {
      if (!ensureRunning || error.bridgeResponse || !isConnectionError(error)) {
        if (isConnectionError(error)) {
          throw new Error("Form2Offer Bridge 未运行：请运行 start-bridge.ps1 serve，或在 MCP 配置里去掉 --no-autostart。");
        }
        throw error;
      }
      await ensureRunning();
      return send(method, pathname, body, timeoutMs);
    }
  }
  return { request };
}

function readProfileFile(filePath) {
  const resolved = path.resolve(String(filePath || ""));
  if (!path.isAbsolute(String(filePath || "")) || path.extname(resolved).toLowerCase() !== ".json") {
    throw new Error("filePath 必须是 .json 文件的绝对路径。");
  }
  const stat = fs.statSync(resolved);
  if (stat.size > MAX_PROFILE_FILE_BYTES) throw new Error("资料文件过大。");
  return JSON.parse(fs.readFileSync(resolved, "utf8").replace(/^﻿/, ""));
}

async function waitForSession(client, args = {}) {
  const state = String(args.state || "awaiting_agent");
  const totalSeconds = Math.min(MAX_WAIT_SECONDS, Math.max(1, Number(args.timeoutSeconds) || 120));
  const deadline = Date.now() + totalSeconds * 1000;
  while (true) {
    const remaining = Math.ceil((deadline - Date.now()) / 1000);
    if (remaining <= 0) return { sessions: [], timedOut: true };
    const wait = Math.min(55, remaining);
    const result = await client.request("GET", `/v1/sessions?state=${encodeURIComponent(state)}&wait=${wait}`, undefined, { timeoutMs: (wait + 10) * 1000 });
    if (Array.isArray(result?.sessions) && result.sessions.length > 0) return { sessions: result.sessions, timedOut: false };
  }
}

async function callTool(client, name, args = {}) {
  switch (name) {
    case "form2offer_bridge_status":
      return client.request("GET", "/v1/status");
    case "form2offer_list_sessions":
      return client.request("GET", `/v1/sessions${args.state ? `?state=${encodeURIComponent(args.state)}` : ""}`);
    case "form2offer_wait_for_session":
      return waitForSession(client, args);
    case "form2offer_get_session":
      return client.request("GET", `/v1/sessions/${encodeURIComponent(args.sessionId)}`);
    case "form2offer_list_tabs":
      return client.request("POST", "/v1/browser/tabs", { urlContains: args.urlContains || "" }, { timeoutMs: 60000 });
    case "form2offer_debug_autofill":
      return client.request("POST", "/v1/browser/debug-autofill", {
        tabId: args.tabId,
        urlContains: args.urlContains || "",
        mode: args.mode === "preview" ? "preview" : "last"
      }, { timeoutMs: 100000 });
    case "form2offer_read_form":
      return client.request("POST", "/v1/browser/read-form", {
        tabId: args.tabId,
        urlContains: args.urlContains || "",
        includeValues: args.includeValues !== false
      }, { timeoutMs: 100000 });
    case "form2offer_search_resume":
      return client.request("POST", "/v1/search", { query: args.query, limit: args.limit });
    case "form2offer_submit_plan":
      return client.request("POST", `/v1/sessions/${encodeURIComponent(args.sessionId)}/plan`, args.plan);
    case "form2offer_cancel_session":
      return client.request("POST", `/v1/sessions/${encodeURIComponent(args.sessionId)}/cancel`, {});
    case "form2offer_platform_guide": {
      const target = args.url || args.platform || "";
      const query = args.url ? `?url=${encodeURIComponent(args.url)}` : args.platform ? `?id=${encodeURIComponent(args.platform)}` : "";
      return client.request("GET", `/v1/knowledge/platforms${target ? query : ""}`);
    }
    case "form2offer_analyze_job":
      return client.request("POST", "/v1/insight", { text: args.text, title: args.title });
    case "form2offer_check_applied":
      return client.request("POST", "/v1/applications/check", { company: args.company, role: args.role, hostname: args.hostname });
    case "form2offer_stage_profile": {
      const pkg = args.package || (args.filePath ? readProfileFile(args.filePath) : null);
      if (!pkg) throw new Error("需要提供 package 或 filePath。");
      return client.request("POST", "/v1/profile-package", { package: pkg, note: args.note || "" });
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// MCP 进程启动时 Bridge 不一定在运行；按需在后台拉起 serve（无窗口、与 MCP 进程分离）。
function createAutostart(options = {}) {
  const baseUrl = String(options.baseUrl || "").replace(/\/$/, "");
  const entry = options.entry;
  const dataDir = options.dataDir;
  const spawnImpl = options.spawnImpl || spawn;
  let pending = null;

  async function healthy() {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1500);
      const response = await fetch(`${baseUrl}/v1/health`, { signal: controller.signal });
      clearTimeout(timer);
      const payload = await response.json();
      return payload?.ok && payload?.data?.name === "Form2Offer Local Bridge";
    } catch {
      return false;
    }
  }

  async function start() {
    if (await healthy()) return true;
    const child = spawnImpl(process.execPath, [entry, "serve", "--data-dir", dataDir], {
      detached: true,
      stdio: "ignore",
      windowsHide: true
    });
    child.unref?.();
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      if (await healthy()) return true;
    }
    throw new Error("Form2Offer Bridge 自动启动失败，请手动运行 start-bridge.ps1 serve。");
  }

  return function ensureRunning() {
    if (!pending) {
      pending = start().finally(() => {
        pending = null;
      });
    }
    return pending;
  };
}

function negotiateProtocol(requested) {
  return SUPPORTED_PROTOCOLS.includes(requested) ? requested : SUPPORTED_PROTOCOLS[SUPPORTED_PROTOCOLS.length - 1];
}

function startMcpStdio(options = {}) {
  const client = options.client || createHttpClient(options);
  const input = options.input || process.stdin;
  const output = options.output || process.stdout;
  const rl = readline.createInterface({ input, crlfDelay: Infinity });

  function send(payload) {
    output.write(`${JSON.stringify(payload)}\n`);
  }

  rl.on("line", async (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (!Object.hasOwn(message, "id")) {
      return;
    }
    try {
      if (message.method === "initialize") {
        send({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            protocolVersion: negotiateProtocol(message.params?.protocolVersion),
            capabilities: { tools: {} },
            serverInfo: { name: "form2offer-local-bridge", title: "Form2Offer 本地网申助手", version: BRIDGE_VERSION },
            instructions: INSTRUCTIONS
          }
        });
      } else if (message.method === "tools/list") {
        send({ jsonrpc: "2.0", id: message.id, result: { tools: TOOLS } });
      } else if (message.method === "tools/call") {
        try {
          const result = await callTool(client, message.params?.name, message.params?.arguments || {});
          send({ jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result } });
        } catch (error) {
          send({ jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: error.message }], isError: true } });
        }
      } else if (message.method === "ping") {
        send({ jsonrpc: "2.0", id: message.id, result: {} });
      } else {
        send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not found" } });
      }
    } catch (error) {
      send({ jsonrpc: "2.0", id: message.id, error: { code: -32000, message: error.message } });
    }
  });
  return rl;
}

module.exports = { TOOLS, INSTRUCTIONS, createHttpClient, callTool, createAutostart, startMcpStdio, waitForSession, negotiateProtocol };

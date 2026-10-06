"use strict";

const http = require("node:http");
const { URL } = require("node:url");
const {
  MAX_BODY_BYTES,
  hashToken,
  randomPairCode,
  randomToken,
  timingSafeTokenMatch,
  isAllowedExtensionOrigin,
  sanitizePromptText
} = require("./security.js");
const { platformKnowledge } = require("./shared.js");
const { buildSessionContext, analyzeJob, checkAppliedFromConfig } = require("./context.js");
const { stageProfilePackage, readStagedProfile, clearStagedProfile } = require("./profile-package.js");
const { BrowserHub } = require("./browser-hub.js");

const BRIDGE_VERSION = require("../package.json").version;
const MAX_WAIT_SECONDS = 55;
const CAPABILITIES = ["sessions", "wait", "knowledge", "insight", "applications", "profile-staging", "browser"];
const BROWSER_WAIT_MS = 35000;

function sendJson(response, status, payload, origin = "") {
  if (response.writableEnded) return;
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...(isAllowedExtensionOrigin(origin) ? { "access-control-allow-origin": origin, vary: "Origin" } : {})
  });
  response.end(body);
}

function readJson(request, maxBytes = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(Object.assign(new Error("Request body is too large."), { statusCode: 413 }));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(Object.assign(new Error("Request body must be valid JSON."), { statusCode: 400 }));
      }
    });
    request.on("error", reject);
  });
}

function getBearerToken(request) {
  const match = String(request.headers.authorization || "").match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

// agent = MCP Client（持有 mcpToken）；browser = 已配对的扩展。
function getAuthRole(request, config) {
  const token = getBearerToken(request);
  if (!token) return null;
  if (config.mcpToken && token === config.mcpToken) return "agent";
  return config.browserTokenHashes.some((hash) => timingSafeTokenMatch(token, hash)) ? "browser" : null;
}

function isAuthorized(request, config) {
  return Boolean(getAuthRole(request, config));
}

function createBridgeServer(options) {
  const config = options.config;
  const dataDir = options.dataDir || "";
  const sessionStore = options.sessionStore;
  const sourceRegistry = options.sourceRegistry;
  const codexHost = options.codexHost;
  const agentHosts = options.agentHosts;
  const saveConfig = typeof options.saveConfig === "function" ? options.saveConfig : () => undefined;
  const waiters = new Set();
  const browserHub = options.browserHub || new BrowserHub({ config, version: BRIDGE_VERSION });
  const browserWaitMs = Number.isFinite(Number(options.browserWaitMs)) ? Number(options.browserWaitMs) : BROWSER_WAIT_MS;

  function notifyWaiters() {
    for (const waiter of Array.from(waiters)) {
      const sessions = sessionStore.list({ state: waiter.state });
      if (sessions.length > 0) {
        waiters.delete(waiter);
        waiter.resolve(sessions);
      }
    }
  }

  function waitForSessions(state, seconds, request) {
    return new Promise((resolve) => {
      const waiter = { state, resolve: (sessions) => { clearTimeout(timer); resolve(sessions); } };
      const timer = setTimeout(() => {
        waiters.delete(waiter);
        resolve(sessionStore.list({ state }));
      }, seconds * 1000);
      request.on("close", () => {
        clearTimeout(timer);
        waiters.delete(waiter);
      });
      waiters.add(waiter);
    });
  }

  async function startCodex(sessionId) {
    const session = sessionStore.getInternal(sessionId);
    if (!session || session.state !== "queued") return;
    sessionStore.transition(sessionId, "running");
    let task = null;
    try {
      const host = agentHosts?.get?.("codex") || codexHost;
      if (!host) throw new Error("Codex Agent Host is not registered.");
      task = host.run(session);
      session.cancel = task.cancel;
      const plan = await task.promise;
      sessionStore.submitPlan(sessionId, plan);
    } catch (error) {
      sessionStore.fail(sessionId, error);
    } finally {
      if (task?.taskDir) {
        const host = agentHosts?.get?.("codex") || codexHost;
        host?.cleanup?.(task.taskDir);
      }
    }
  }

  function requireDataDir() {
    if (!dataDir) throw Object.assign(new Error("Bridge data directory is not configured."), { statusCode: 503 });
    return dataDir;
  }

  const server = http.createServer(async (request, response) => {
    const origin = String(request.headers.origin || "");
    try {
      if (request.method === "OPTIONS") {
        if (!isAllowedExtensionOrigin(origin)) {
          sendJson(response, 403, { ok: false, error: "Origin is not allowed." });
          return;
        }
        response.writeHead(204, {
          "access-control-allow-origin": origin,
          "access-control-allow-methods": "GET,POST,OPTIONS",
          "access-control-allow-headers": "authorization,content-type",
          "access-control-max-age": "600",
          vary: "Origin"
        });
        response.end();
        return;
      }

      if (origin && !isAllowedExtensionOrigin(origin)) {
        sendJson(response, 403, { ok: false, error: "Origin is not allowed." });
        return;
      }

      const url = new URL(request.url, `http://${config.host}:${config.port}`);
      if (request.method === "GET" && url.pathname === "/v1/health") {
        sendJson(response, 200, {
          ok: true,
          data: {
            name: "Form2Offer Local Bridge",
            version: BRIDGE_VERSION,
            paired: config.browserTokenHashes.length > 0,
            capabilities: CAPABILITIES,
            agents: {
              codex: Boolean(config.codex.enabled && (agentHosts?.get?.("codex") || codexHost)),
              mcp: true
            }
          }
        }, origin);
        return;
      }

      if (request.method === "POST" && url.pathname === "/v1/pair") {
        if (!isAllowedExtensionOrigin(origin)) {
          sendJson(response, 403, { ok: false, error: "Pairing is only available to a Chrome extension origin." });
          return;
        }
        const body = await readJson(request, 4096);
        if (String(body.code || "") !== String(config.pairCode || "")) {
          sendJson(response, 401, { ok: false, error: "Pairing code is invalid." }, origin);
          return;
        }
        const token = randomToken();
        config.browserTokenHashes = [...config.browserTokenHashes, hashToken(token)].slice(-10);
        config.pairCode = randomPairCode();
        saveConfig(config);
        sendJson(response, 200, { ok: true, data: { token, paired: true } }, origin);
        return;
      }

      const role = getAuthRole(request, config);
      if (!role) {
        sendJson(response, 401, { ok: false, error: "Bridge authorization failed." }, origin);
        return;
      }

      if (request.method === "GET" && url.pathname === "/v1/sources") {
        sendJson(response, 200, { ok: true, data: { sources: sourceRegistry.list() } }, origin);
        return;
      }

      if (request.method === "GET" && url.pathname === "/v1/status") {
        sendJson(response, 200, {
          ok: true,
          data: {
            version: BRIDGE_VERSION,
            sources: sourceRegistry.list(),
            applicationsFile: config.applicationsFile ? { configured: true, ...checkAppliedFromConfig(config, {}) } : { configured: false },
            resumeVersions: (config.resumeVersions || []).map((version) => ({ id: version.id, label: version.label })),
            candidateConfigured: Object.keys(config.candidate || {}).length > 0,
            stagedProfile: dataDir ? readStagedProfile(dataDir) : { staged: false },
            browser: browserHub.status(),
            sessions: sessionStore.list().map((session) => ({ id: session.id, state: session.state, createdAt: session.createdAt }))
          }
        }, origin);
        return;
      }

      if (request.method === "GET" && url.pathname === "/v1/sessions") {
        const state = url.searchParams.get("state") || "";
        const wait = Math.min(MAX_WAIT_SECONDS, Math.max(0, Number(url.searchParams.get("wait")) || 0));
        let sessions = sessionStore.list({ state });
        if (sessions.length === 0 && wait > 0) {
          sessions = await waitForSessions(state, wait, request);
        }
        sendJson(response, 200, { ok: true, data: { sessions } }, origin);
        return;
      }

      if (request.method === "POST" && url.pathname === "/v1/sessions") {
        const body = await readJson(request);
        const session = sessionStore.create(body);
        const internal = sessionStore.getInternal(session.id);
        try {
          sessionStore.setContext(session.id, buildSessionContext(internal.request, config));
        } catch (error) {
          sessionStore.setContext(session.id, { error: sanitizePromptText(error.message, 300) });
        }
        const created = sessionStore.list().find((item) => item.id === session.id) || session;
        sendJson(response, 201, { ok: true, data: created }, origin);
        notifyWaiters();
        if (created.mode === "codex") {
          if (!config.codex.enabled) {
            sessionStore.fail(session.id, new Error("Codex Host is disabled."));
          } else {
            void startCodex(session.id);
          }
        }
        return;
      }

      // 停止 Bridge：只允许持有 mcpToken 的本机 Agent 或 CLI 调用。
      if (request.method === "POST" && url.pathname === "/v1/shutdown") {
        if (role !== "agent") {
          sendJson(response, 403, { ok: false, error: "Only the local CLI or an MCP agent can stop the bridge." }, origin);
          return;
        }
        sendJson(response, 200, { ok: true, data: { stopping: true } }, origin);
        if (typeof options.onShutdown === "function") setTimeout(() => options.onShutdown(), 50);
        return;
      }

      if (request.method === "GET" && url.pathname === "/v1/browser/status") {
        sendJson(response, 200, { ok: true, data: browserHub.status() }, origin);
        return;
      }

      // Agent 主动读取浏览器：由已连接的扩展执行，结果是一个可直接提交方案的会话。
      if (request.method === "POST" && url.pathname === "/v1/browser/tabs") {
        if (role !== "agent") {
          sendJson(response, 403, { ok: false, error: "Only an MCP agent can list browser tabs." }, origin);
          return;
        }
        const body = await readJson(request, 4096);
        const data = await browserHub.request("list_tabs", { urlContains: sanitizePromptText(body.urlContains, 200) }, { waitMs: browserWaitMs, timeoutMs: 15000 });
        sendJson(response, 200, { ok: true, data }, origin);
        return;
      }

      if (request.method === "POST" && url.pathname === "/v1/browser/read-form") {
        if (role !== "agent") {
          sendJson(response, 403, { ok: false, error: "Only an MCP agent can read browser forms." }, origin);
          return;
        }
        const body = await readJson(request, 4096);
        const result = await browserHub.request("read_form", {
          tabId: Number.isInteger(Number(body.tabId)) && Number(body.tabId) > 0 ? Number(body.tabId) : null,
          urlContains: sanitizePromptText(body.urlContains, 200),
          includeValues: body.includeValues !== false
        }, { waitMs: browserWaitMs, timeoutMs: 45000 });
        const session = result?.sessionId ? sessionStore.get(result.sessionId) : null;
        if (!session) throw Object.assign(new Error("扩展已读取表单，但没有生成会话。"), { statusCode: 502 });
        sendJson(response, 200, { ok: true, data: { tab: result.tab || null, session } }, origin);
        return;
      }

      if (request.method === "POST" && url.pathname === "/v1/search") {
        const body = await readJson(request, 32768);
        sendJson(response, 200, { ok: true, data: { results: sourceRegistry.search(body.query, { limit: body.limit }) } }, origin);
        return;
      }

      if (request.method === "GET" && url.pathname === "/v1/knowledge/platforms") {
        const target = url.searchParams.get("url") || url.searchParams.get("id") || "";
        if (!target) {
          const platforms = platformKnowledge.listPlatforms().map((platform) => ({
            id: platform.id,
            name: platform.name,
            family: platform.family,
            confidence: platform.confidence,
            hosts: platform.match.map((rule) => rule.host || rule.path).filter(Boolean)
          }));
          sendJson(response, 200, { ok: true, data: { platforms, generalRules: platformKnowledge.GENERAL_RULES.map((rule) => rule.text) } }, origin);
          return;
        }
        sendJson(response, 200, { ok: true, data: platformKnowledge.getPlatformGuide(target) }, origin);
        return;
      }

      if (request.method === "POST" && url.pathname === "/v1/insight") {
        const body = await readJson(request, 65536);
        const result = analyzeJob({
          title: sanitizePromptText(body.title, 160),
          description: sanitizePromptText(body.text, 12000)
        }, config);
        sendJson(response, 200, { ok: true, data: result }, origin);
        return;
      }

      if (request.method === "POST" && url.pathname === "/v1/applications/check") {
        const body = await readJson(request, 8192);
        const result = checkAppliedFromConfig(config, {
          company: sanitizePromptText(body.company, 120),
          role: sanitizePromptText(body.role, 160),
          hostname: sanitizePromptText(body.hostname, 160)
        });
        sendJson(response, 200, { ok: true, data: result }, origin);
        return;
      }

      if (url.pathname === "/v1/profile-package") {
        if (request.method === "POST") {
          if (role !== "agent") {
            sendJson(response, 403, { ok: false, error: "Only an MCP agent can stage a profile package." }, origin);
            return;
          }
          const body = await readJson(request, 1024 * 1024);
          sendJson(response, 200, { ok: true, data: stageProfilePackage(requireDataDir(), body.package, body.note) }, origin);
          return;
        }
        if (request.method === "GET") {
          const view = readStagedProfile(requireDataDir(), { includePackage: role === "browser" });
          sendJson(response, 200, { ok: true, data: view }, origin);
          return;
        }
      }

      if (request.method === "POST" && url.pathname === "/v1/profile-package/clear") {
        sendJson(response, 200, { ok: true, data: clearStagedProfile(requireDataDir()) }, origin);
        return;
      }

      const sessionMatch = url.pathname.match(/^\/v1\/sessions\/([^/]+)(?:\/(cancel|plan))?$/);
      if (sessionMatch && request.method === "GET" && !sessionMatch[2]) {
        const session = sessionStore.get(decodeURIComponent(sessionMatch[1]));
        if (!session) {
          sendJson(response, 404, { ok: false, error: "Session not found or expired." }, origin);
          return;
        }
        sendJson(response, 200, { ok: true, data: session }, origin);
        return;
      }
      if (sessionMatch && request.method === "POST" && sessionMatch[2] === "cancel") {
        sendJson(response, 200, { ok: true, data: sessionStore.cancel(decodeURIComponent(sessionMatch[1])) }, origin);
        return;
      }
      if (sessionMatch && request.method === "POST" && sessionMatch[2] === "plan") {
        const body = await readJson(request);
        const submitted = sessionStore.submitPlan(decodeURIComponent(sessionMatch[1]), body);
        sendJson(response, 200, { ok: true, data: submitted }, origin);
        notifyWaiters();
        // 通知扩展：Agent 主动发起的会话由扩展自动打开审阅页。
        browserHub.notify("plan_ready", { sessionId: submitted.id });
        return;
      }

      sendJson(response, 404, { ok: false, error: "Route not found." }, origin);
    } catch (error) {
      sendJson(response, Number(error.statusCode) || 500, { ok: false, error: error.message || "Bridge request failed." }, origin);
    }
  });

  server.on("upgrade", (request, socket) => browserHub.handleUpgrade(request, socket));

  return {
    server,
    browserHub,
    listen() {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(config.port, config.host, () => {
          server.off("error", reject);
          resolve(server.address());
        });
      });
    },
    close() {
      browserHub.close();
      for (const waiter of Array.from(waiters)) waiter.resolve([]);
      waiters.clear();
      server.closeAllConnections?.();
      return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  };
}

module.exports = { createBridgeServer, readJson, isAuthorized, getAuthRole, BRIDGE_VERSION };

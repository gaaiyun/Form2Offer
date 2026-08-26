"use strict";

const http = require("node:http");
const { URL } = require("node:url");
const {
  MAX_BODY_BYTES,
  hashToken,
  randomPairCode,
  randomToken,
  timingSafeTokenMatch,
  isAllowedExtensionOrigin
} = require("./security.js");

function sendJson(response, status, payload, origin = "") {
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

function isAuthorized(request, config) {
  const token = getBearerToken(request);
  if (!token) return false;
  if (token === config.mcpToken) return true;
  return config.browserTokenHashes.some((hash) => timingSafeTokenMatch(token, hash));
}

function createBridgeServer(options) {
  const config = options.config;
  const sessionStore = options.sessionStore;
  const sourceRegistry = options.sourceRegistry;
  const codexHost = options.codexHost;
  const agentHosts = options.agentHosts;
  const saveConfig = typeof options.saveConfig === "function" ? options.saveConfig : () => undefined;

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
            version: "0.11.0",
            paired: config.browserTokenHashes.length > 0,
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

      if (!isAuthorized(request, config)) {
        sendJson(response, 401, { ok: false, error: "Bridge authorization failed." }, origin);
        return;
      }

      if (request.method === "GET" && url.pathname === "/v1/sources") {
        sendJson(response, 200, { ok: true, data: { sources: sourceRegistry.list() } }, origin);
        return;
      }
      if (request.method === "GET" && url.pathname === "/v1/sessions") {
        sendJson(response, 200, { ok: true, data: { sessions: sessionStore.list({ state: url.searchParams.get("state") }) } }, origin);
        return;
      }
      if (request.method === "POST" && url.pathname === "/v1/sessions") {
        const body = await readJson(request);
        const session = sessionStore.create(body);
        sendJson(response, 201, { ok: true, data: session }, origin);
        if (session.mode === "codex") {
          if (!config.codex.enabled) {
            sessionStore.fail(session.id, new Error("Codex Host is disabled."));
          } else {
            void startCodex(session.id);
          }
        }
        return;
      }
      if (request.method === "POST" && url.pathname === "/v1/search") {
        const body = await readJson(request, 32768);
        sendJson(response, 200, { ok: true, data: { results: sourceRegistry.search(body.query, { limit: body.limit }) } }, origin);
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
        sendJson(response, 200, { ok: true, data: sessionStore.submitPlan(decodeURIComponent(sessionMatch[1]), body) }, origin);
        return;
      }

      sendJson(response, 404, { ok: false, error: "Route not found." }, origin);
    } catch (error) {
      sendJson(response, Number(error.statusCode) || 500, { ok: false, error: error.message || "Bridge request failed." }, origin);
    }
  });

  return {
    server,
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
      return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  };
}

module.exports = { createBridgeServer, readJson, isAuthorized };

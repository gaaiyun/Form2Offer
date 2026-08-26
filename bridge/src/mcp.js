"use strict";

const readline = require("node:readline");

const TOOLS = [
  {
    name: "form2offer_list_sessions",
    description: "List current Form2Offer browser form sessions waiting for an agent or review.",
    inputSchema: { type: "object", properties: { state: { type: "string" } }, additionalProperties: false }
  },
  {
    name: "form2offer_get_session",
    description: "Read one sanitized Form2Offer session, including form fields and profile field paths.",
    inputSchema: { type: "object", required: ["sessionId"], properties: { sessionId: { type: "string" } }, additionalProperties: false }
  },
  {
    name: "form2offer_search_resume",
    description: "Search redacted content in the user's explicitly approved resume source files.",
    inputSchema: { type: "object", required: ["query"], properties: { query: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 20 } }, additionalProperties: false }
  },
  {
    name: "form2offer_submit_plan",
    description: "Submit a structured AgentFillPlan for user review. This never writes the page directly.",
    inputSchema: { type: "object", required: ["sessionId", "plan"], properties: { sessionId: { type: "string" }, plan: { type: "object" } }, additionalProperties: false }
  },
  {
    name: "form2offer_cancel_session",
    description: "Cancel a Form2Offer session.",
    inputSchema: { type: "object", required: ["sessionId"], properties: { sessionId: { type: "string" } }, additionalProperties: false }
  }
];

function createHttpClient(options) {
  const baseUrl = String(options.baseUrl || "http://127.0.0.1:43127").replace(/\/$/, "");
  const token = String(options.token || "");
  async function request(method, pathname, body) {
    const response = await fetch(`${baseUrl}${pathname}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body ? { "content-type": "application/json" } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || `Bridge returned HTTP ${response.status}.`);
    }
    return payload.data;
  }
  return { request };
}

async function callTool(client, name, args = {}) {
  switch (name) {
    case "form2offer_list_sessions":
      return client.request("GET", `/v1/sessions${args.state ? `?state=${encodeURIComponent(args.state)}` : ""}`);
    case "form2offer_get_session":
      return client.request("GET", `/v1/sessions/${encodeURIComponent(args.sessionId)}`);
    case "form2offer_search_resume":
      return client.request("POST", "/v1/search", { query: args.query, limit: args.limit });
    case "form2offer_submit_plan":
      return client.request("POST", `/v1/sessions/${encodeURIComponent(args.sessionId)}/plan`, args.plan);
    case "form2offer_cancel_session":
      return client.request("POST", `/v1/sessions/${encodeURIComponent(args.sessionId)}/cancel`, {});
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
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
        send({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "form2offer-local-bridge", version: "0.11.0" } } });
      } else if (message.method === "tools/list") {
        send({ jsonrpc: "2.0", id: message.id, result: { tools: TOOLS } });
      } else if (message.method === "tools/call") {
        const result = await callTool(client, message.params?.name, message.params?.arguments || {});
        send({ jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result } });
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

module.exports = { TOOLS, createHttpClient, callTool, startMcpStdio };

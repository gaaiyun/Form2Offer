"use strict";

const crypto = require("node:crypto");
const { timingSafeTokenMatch, isAllowedExtensionOrigin } = require("./security.js");

// 扩展后台与 Bridge 之间的本机 WebSocket：Agent 通过 MCP 发起“列出标签页 / 读取表单”，
// 由已配对的扩展在浏览器里执行并回传结果。只接受 chrome-extension:// Origin 和已配对令牌。
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const MAX_MESSAGE_BYTES = 8 * 1024 * 1024;
const AUTH_TIMEOUT_MS = 5000;
const PING_INTERVAL_MS = 20000;

function encodeFrame(payload, opcode = 0x1) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), "utf8");
  let header;
  if (body.length < 126) {
    header = Buffer.from([0x80 | opcode, body.length]);
  } else if (body.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(body.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(body.length), 2);
  }
  return Buffer.concat([header, body]);
}

class ExtensionConnection {
  constructor(socket, hub) {
    this.id = crypto.randomUUID();
    this.socket = socket;
    this.hub = hub;
    this.buffer = Buffer.alloc(0);
    this.fragments = [];
    this.authenticated = false;
    this.info = {};
    this.connectedAt = new Date().toISOString();
    this.lastSeen = Date.now();
    this.pending = new Map();
    this.closed = false;
    this.authTimer = setTimeout(() => {
      this.hub.recordRejection("扩展连上后没有发送配对令牌（超时）");
      this.close(4001, "auth timeout");
    }, AUTH_TIMEOUT_MS);
    this.pingTimer = setInterval(() => this.sendJson({ type: "ping", at: Date.now() }), PING_INTERVAL_MS);
    socket.on("data", (chunk) => this.onData(chunk));
    socket.on("close", () => this.onClose());
    socket.on("error", () => this.onClose());
  }

  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 2) {
      const first = this.buffer[0];
      const second = this.buffer[1];
      const fin = Boolean(first & 0x80);
      const opcode = first & 0x0f;
      const masked = Boolean(second & 0x80);
      let length = second & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (this.buffer.length < 4) return;
        length = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (this.buffer.length < 10) return;
        length = Number(this.buffer.readBigUInt64BE(2));
        offset = 10;
      }
      if (length > MAX_MESSAGE_BYTES) {
        this.close(1009, "message too large");
        return;
      }
      const maskLength = masked ? 4 : 0;
      if (this.buffer.length < offset + maskLength + length) return;
      const mask = masked ? this.buffer.subarray(offset, offset + 4) : null;
      const payload = Buffer.from(this.buffer.subarray(offset + maskLength, offset + maskLength + length));
      if (mask) {
        for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4];
      }
      this.buffer = this.buffer.subarray(offset + maskLength + length);
      this.onFrame(fin, opcode, payload);
    }
  }

  onFrame(fin, opcode, payload) {
    if (opcode === 0x8) {
      this.close(1000, "bye");
      return;
    }
    if (opcode === 0x9) {
      this.write(encodeFrame(payload, 0xa));
      return;
    }
    if (opcode === 0xa) {
      this.lastSeen = Date.now();
      return;
    }
    if (opcode === 0x1 || opcode === 0x0) {
      this.fragments.push(payload);
      if (!fin) return;
      const text = Buffer.concat(this.fragments).toString("utf8");
      this.fragments = [];
      this.lastSeen = Date.now();
      let message;
      try {
        message = JSON.parse(text);
      } catch {
        return;
      }
      this.onMessage(message);
    }
  }

  onMessage(message) {
    if (!this.authenticated) {
      if (message?.type === "auth" && this.hub.isValidBrowserToken(message.token)) {
        this.authenticated = true;
        clearTimeout(this.authTimer);
        this.info = sanitizeInfo(message.info);
        this.sendJson({ type: "ready", version: this.hub.version });
        this.hub.onAuthenticated(this);
      } else {
        this.hub.recordRejection(message?.token ? "扩展的配对令牌不在本机 Bridge 的白名单里" : "扩展没有配对令牌");
        this.close(4003, "unauthorized");
      }
      return;
    }
    if (message?.type === "hello") {
      this.info = sanitizeInfo(message.info);
      return;
    }
    if (message?.type === "keepalive" || message?.type === "pong") return;
    if (message?.replyTo && this.pending.has(message.replyTo)) {
      const pending = this.pending.get(message.replyTo);
      this.pending.delete(message.replyTo);
      clearTimeout(pending.timer);
      if (message.ok) pending.resolve(message.data);
      else pending.reject(Object.assign(new Error(String(message.error || "浏览器扩展执行失败。")), { statusCode: 409 }));
    }
  }

  request(type, args, timeoutMs) {
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Object.assign(new Error("浏览器扩展没有在限定时间内响应。"), { statusCode: 504 }));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.sendJson({ id, type, args });
    });
  }

  sendJson(value) {
    this.write(encodeFrame(JSON.stringify(value)));
  }

  write(buffer) {
    if (!this.closed && this.socket.writable) this.socket.write(buffer);
  }

  close(code = 1000, reason = "") {
    if (this.closed) return;
    const body = Buffer.alloc(2 + Buffer.byteLength(reason));
    body.writeUInt16BE(code, 0);
    body.write(reason, 2);
    this.write(encodeFrame(body, 0x8));
    this.socket.end();
    this.onClose();
  }

  onClose() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.authTimer);
    clearInterval(this.pingTimer);
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(Object.assign(new Error("浏览器扩展连接已断开。"), { statusCode: 503 }));
    }
    this.pending.clear();
    this.hub.onClosed(this);
  }
}

function sanitizeInfo(info = {}) {
  const source = info && typeof info === "object" ? info : {};
  return {
    extensionVersion: String(source.extensionVersion || "").slice(0, 40),
    browser: String(source.browser || "").slice(0, 120),
    linkEnabled: Boolean(source.linkEnabled),
    includeValues: Boolean(source.includeValues),
    canReadAllSites: Boolean(source.canReadAllSites)
  };
}

class BrowserHub {
  constructor(options = {}) {
    this.config = options.config;
    this.version = options.version || "";
    this.connections = new Set();
    this.waiters = new Set();
    this.lastRejection = null;
  }

  // 连不上时最难排查：记下最近一次拒绝的原因，bridge_status 会带出来。
  recordRejection(reason, origin = "") {
    this.lastRejection = { at: new Date().toISOString(), reason, ...(origin ? { origin: origin.slice(0, 80) } : {}) };
  }

  isValidBrowserToken(token) {
    const value = String(token || "");
    return Boolean(value) && this.config.browserTokenHashes.some((hash) => timingSafeTokenMatch(value, hash));
  }

  handleUpgrade(request, socket) {
    const origin = String(request.headers.origin || "");
    const key = String(request.headers["sec-websocket-key"] || "");
    const pathname = String(request.url || "").split("?")[0];
    if (pathname !== "/v1/ws" || !key || !isAllowedExtensionOrigin(origin) || String(request.headers.upgrade || "").toLowerCase() !== "websocket") {
      this.recordRejection(!isAllowedExtensionOrigin(origin) ? "握手来源不是浏览器扩展" : "不是有效的 WebSocket 握手", origin);
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    const accept = crypto.createHash("sha1").update(`${key}${WS_GUID}`).digest("base64");
    socket.write([
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "",
      ""
    ].join("\r\n"));
    socket.setNoDelay?.(true);
    new ExtensionConnection(socket, this);
  }

  onAuthenticated(connection) {
    this.connections.add(connection);
    for (const waiter of Array.from(this.waiters)) {
      this.waiters.delete(waiter);
      waiter(connection);
    }
  }

  onClosed(connection) {
    this.connections.delete(connection);
  }

  latest() {
    return Array.from(this.connections).filter((connection) => !connection.closed).sort((left, right) => right.lastSeen - left.lastSeen)[0] || null;
  }

  waitForConnection(timeoutMs) {
    const current = this.latest();
    if (current || timeoutMs <= 0) return Promise.resolve(current);
    return new Promise((resolve) => {
      const waiter = (connection) => {
        clearTimeout(timer);
        resolve(connection);
      };
      const timer = setTimeout(() => {
        this.waiters.delete(waiter);
        resolve(this.latest());
      }, timeoutMs);
      this.waiters.add(waiter);
    });
  }

  async request(type, args = {}, options = {}) {
    const connection = await this.waitForConnection(Number(options.waitMs) || 0);
    if (!connection) {
      throw Object.assign(new Error("浏览器扩展未连接：请确认 Edge/Chrome 已打开，Form2Offer 已与 Bridge 配对，并在扩展设置页开启“允许本地 Agent 读取浏览器表单”。"), { statusCode: 503 });
    }
    return connection.request(type, args, Number(options.timeoutMs) || 30000);
  }

  notify(type, payload = {}) {
    for (const connection of this.connections) connection.sendJson({ type, ...payload });
  }

  status() {
    const connection = this.latest();
    return {
      connected: Boolean(connection),
      connections: this.connections.size,
      connectedAt: connection?.connectedAt || "",
      lastSeen: connection ? new Date(connection.lastSeen).toISOString() : "",
      ...(connection ? connection.info : {}),
      ...(!connection && this.lastRejection ? { lastRejection: this.lastRejection } : {})
    };
  }

  close() {
    for (const connection of Array.from(this.connections)) connection.close(1001, "bridge stopping");
    for (const waiter of Array.from(this.waiters)) waiter(null);
    this.waiters.clear();
  }
}

module.exports = { BrowserHub, encodeFrame };

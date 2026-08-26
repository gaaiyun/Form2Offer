"use strict";

class AgentHostRegistry {
  constructor() {
    this.hosts = new Map();
  }

  register(name, host) {
    const id = String(name || "").trim();
    if (!id || !host || typeof host.run !== "function") throw new Error("Agent Host requires a name and run() implementation.");
    this.hosts.set(id, host);
    return this;
  }

  get(name) {
    return this.hosts.get(String(name || "")) || null;
  }

  list() {
    return Array.from(this.hosts.keys());
  }
}

module.exports = { AgentHostRegistry };

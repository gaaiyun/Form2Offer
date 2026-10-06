"use strict";

const crypto = require("node:crypto");
const { sanitizeSessionRequest } = require("./security.js");
const { validateAgentFillPlan } = require("./plan.js");

const TERMINAL_STATES = new Set(["review_ready", "failed", "cancelled", "expired"]);

class SessionStore {
  constructor(options = {}) {
    this.sessions = new Map();
    this.ttlMs = Math.max(60000, Number(options.ttlMs) || 30 * 60 * 1000);
    this.maxSessions = Math.max(1, Number(options.maxSessions) || 50);
    this.onCreate = typeof options.onCreate === "function" ? options.onCreate : null;
  }

  create(request) {
    this.prune();
    if (this.sessions.size >= this.maxSessions) {
      const oldest = Array.from(this.sessions.values()).sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
      if (oldest) {
        this.sessions.delete(oldest.id);
      }
    }
    const now = new Date().toISOString();
    const normalizedRequest = sanitizeSessionRequest(request);
    if (normalizedRequest.scan.fields.length === 0) {
      throw new Error("Session requires at least one form field.");
    }
    const session = {
      id: `session-${crypto.randomUUID()}`,
      state: normalizedRequest.mode === "agent-pull" ? "awaiting_agent" : "queued",
      request: normalizedRequest,
      plan: null,
      context: null,
      error: "",
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(Date.now() + this.ttlMs).toISOString(),
      cancel: null
    };
    this.sessions.set(session.id, session);
    if (this.onCreate) {
      queueMicrotask(() => this.onCreate(session));
    }
    return this.publicView(session);
  }

  getInternal(id) {
    this.prune();
    return this.sessions.get(String(id || "")) || null;
  }

  get(id) {
    const session = this.getInternal(id);
    return session ? this.publicView(session, { includeRequest: true }) : null;
  }

  list(options = {}) {
    this.prune();
    const state = String(options.state || "");
    return Array.from(this.sessions.values())
      .filter((session) => !state || session.state === state)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((session) => this.publicView(session));
  }

  setContext(id, context) {
    const session = this.getInternal(id);
    if (!session) {
      throw new Error("Session not found or expired.");
    }
    session.context = context || null;
    return this.publicView(session);
  }

  transition(id, state, patch = {}) {
    const session = this.getInternal(id);
    if (!session) {
      throw new Error("Session not found or expired.");
    }
    if (TERMINAL_STATES.has(session.state) && state !== session.state) {
      throw new Error(`Session is already ${session.state}.`);
    }
    Object.assign(session, patch, { state, updatedAt: new Date().toISOString() });
    return this.publicView(session);
  }

  submitPlan(id, input) {
    const session = this.getInternal(id);
    if (!session) {
      throw new Error("Session not found or expired.");
    }
    if (["cancelled", "expired"].includes(session.state)) {
      throw new Error(`Cannot submit a plan to a ${session.state} session.`);
    }
    if (session.plan) {
      throw new Error("A plan has already been submitted for this session.");
    }
    const plan = validateAgentFillPlan(input, session);
    return this.transition(id, "review_ready", { plan, error: "", cancel: null });
  }

  cancel(id) {
    const session = this.getInternal(id);
    if (!session) {
      throw new Error("Session not found or expired.");
    }
    if (typeof session.cancel === "function") {
      session.cancel();
    }
    return this.transition(id, "cancelled", { cancel: null });
  }

  fail(id, error) {
    const session = this.getInternal(id);
    if (!session || session.state === "cancelled") {
      return session ? this.publicView(session) : null;
    }
    return this.transition(id, "failed", {
      error: String(error?.message || error || "Agent task failed.").slice(0, 1000),
      cancel: null
    });
  }

  prune(now = Date.now()) {
    for (const session of this.sessions.values()) {
      if (Date.parse(session.expiresAt) <= now) {
        if (typeof session.cancel === "function") {
          session.cancel();
        }
        this.sessions.delete(session.id);
      }
    }
  }

  publicView(session, options = {}) {
    const view = {
      id: session.id,
      state: session.state,
      page: session.request.page,
      mode: session.request.mode,
      initiator: session.request.initiator || "user",
      job: { company: session.request.job?.company || "", title: session.request.job?.title || "" },
      platform: session.context?.platform ? { id: session.context.platform.id, name: session.context.platform.name } : null,
      fieldCount: session.request.scan.fields.length,
      plan: session.plan,
      error: session.error,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      expiresAt: session.expiresAt
    };
    if (options.includeRequest) {
      view.request = session.request;
      view.context = session.context;
    }
    return view;
  }
}

module.exports = { SessionStore, TERMINAL_STATES };

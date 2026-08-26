"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { redactAgentSourceText, sanitizePromptText } = require("./security.js");

const BLOCKED_DIRECTORY_NAMES = new Set(["_backup", "backup", "tmp", "output", "releases"]);
const ALLOWED_EXTENSIONS = new Set([".md", ".txt", ".js", ".json", ".yaml", ".yml"]);

class SourceRegistry {
  constructor(config = {}) {
    this.resumeRoot = config.resumeRoot ? fs.realpathSync.native(path.resolve(config.resumeRoot)) : "";
    this.sourcePaths = (Array.isArray(config.sources) ? config.sources : [])
      .map((value) => String(value || "").trim().replace(/\\/g, "/"))
      .filter(Boolean);
  }

  resolveApprovedSource(relativePath) {
    if (!this.resumeRoot) {
      throw new Error("Resume root is not configured.");
    }
    const requested = String(relativePath || "").trim().replace(/\\/g, "/");
    if (!this.sourcePaths.includes(requested)) {
      throw new Error("Source is not in the approved whitelist.");
    }
    const segments = requested.split(/[\\/]+/).filter(Boolean);
    if (segments.some((segment) => BLOCKED_DIRECTORY_NAMES.has(segment.toLowerCase()))) {
      throw new Error("Backup, output, release, and temporary directories are not allowed.");
    }
    const candidate = path.resolve(this.resumeRoot, requested.split("/").join(path.sep));
    if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) {
      throw new Error(`Approved source does not exist: ${requested}`);
    }
    const real = fs.realpathSync.native(candidate);
    const relative = path.relative(this.resumeRoot, real);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("Approved source resolves outside the resume root.");
    }
    if (!ALLOWED_EXTENSIONS.has(path.extname(real).toLowerCase())) {
      throw new Error("Source type is not allowed.");
    }
    return real;
  }

  list() {
    return this.sourcePaths.map((relativePath) => {
      try {
        const absolutePath = this.resolveApprovedSource(relativePath);
        const stat = fs.statSync(absolutePath);
        return {
          id: relativePath,
          relativePath,
          available: true,
          size: stat.size,
          updatedAt: stat.mtime.toISOString()
        };
      } catch (error) {
        return {
          id: relativePath,
          relativePath,
          available: false,
          error: error.message
        };
      }
    });
  }

  read(relativePath, maxLength = 200000) {
    const absolutePath = this.resolveApprovedSource(relativePath);
    const content = fs.readFileSync(absolutePath, "utf8");
    return {
      source: relativePath.replace(/\\/g, "/"),
      content: redactAgentSourceText(content, maxLength)
    };
  }

  search(query, options = {}) {
    const needle = sanitizePromptText(query, 200).toLocaleLowerCase();
    const limit = Math.min(20, Math.max(1, Number(options.limit) || 8));
    if (!needle) {
      return [];
    }
    const results = [];
    for (const source of this.list().filter((item) => item.available)) {
      const { content } = this.read(source.relativePath, 300000);
      const lines = content.split(/\r?\n/);
      lines.forEach((line, index) => {
        if (results.length >= limit || !line.toLocaleLowerCase().includes(needle)) {
          return;
        }
        results.push({
          source: source.relativePath,
          line: index + 1,
          excerpt: line.trim().slice(0, 600)
        });
      });
      if (results.length >= limit) {
        break;
      }
    }
    return results;
  }

  buildContextBundle(maxLength = 320000) {
    const parts = [];
    let remaining = maxLength;
    for (const source of this.list().filter((item) => item.available)) {
      if (remaining <= 0) {
        break;
      }
      const result = this.read(source.relativePath, remaining);
      const block = `\n\n# 来源：${result.source}\n\n${result.content}`;
      parts.push(block.slice(0, remaining));
      remaining -= block.length;
    }
    return parts.join("").trim();
  }
}

module.exports = { SourceRegistry, BLOCKED_DIRECTORY_NAMES, ALLOWED_EXTENSIONS };

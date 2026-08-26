"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { randomPairCode, randomToken } = require("./security.js");

const CONFIG_VERSION = 1;

function getDefaultDataDir() {
  if (process.platform === "win32" && fs.existsSync("G:\\")) {
    return "G:\\Form2Offer\\BridgeData";
  }
  return path.join(process.env.LOCALAPPDATA || os.homedir(), "Form2Offer", "BridgeData");
}

function getConfigPath(dataDir) {
  return path.join(path.resolve(dataDir || getDefaultDataDir()), "bridge-config.json");
}

function createDefaultConfig(overrides = {}) {
  return {
    version: CONFIG_VERSION,
    host: "127.0.0.1",
    port: 43127,
    pairCode: randomPairCode(),
    browserTokenHashes: [],
    mcpToken: randomToken(),
    resumeRoot: "",
    sources: [],
    codex: {
      enabled: true,
      command: "codex",
      timeoutMs: 180000
    },
    ...overrides
  };
}

function normalizeConfig(input = {}) {
  const base = createDefaultConfig();
  const source = input && typeof input === "object" ? input : {};
  return {
    ...base,
    ...source,
    version: CONFIG_VERSION,
    host: "127.0.0.1",
    port: Math.min(65535, Math.max(1024, Number(source.port) || base.port)),
    pairCode: String(source.pairCode || base.pairCode).slice(0, 20),
    browserTokenHashes: Array.isArray(source.browserTokenHashes)
      ? source.browserTokenHashes.filter((value) => /^[a-f0-9]{64}$/i.test(String(value))).slice(-10)
      : [],
    mcpToken: String(source.mcpToken || base.mcpToken),
    resumeRoot: String(source.resumeRoot || "").trim(),
    sources: Array.isArray(source.sources)
      ? source.sources.map((value) => String(value || "").trim()).filter(Boolean).slice(0, 20)
      : [],
    codex: {
      ...base.codex,
      ...(source.codex && typeof source.codex === "object" ? source.codex : {}),
      enabled: source.codex?.enabled !== false,
      command: String(source.codex?.command || base.codex.command).trim(),
      timeoutMs: Math.min(600000, Math.max(15000, Number(source.codex?.timeoutMs) || base.codex.timeoutMs))
    }
  };
}

function readConfig(dataDir) {
  const configPath = getConfigPath(dataDir);
  if (!fs.existsSync(configPath)) {
    return { config: createDefaultConfig(), configPath, exists: false };
  }
  return {
    config: normalizeConfig(JSON.parse(fs.readFileSync(configPath, "utf8"))),
    configPath,
    exists: true
  };
}

function writeConfig(dataDir, config) {
  const configPath = getConfigPath(dataDir);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const normalized = normalizeConfig(config);
  const tempPath = `${configPath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(normalized, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tempPath, configPath);
  return { config: normalized, configPath };
}

function buildDefaultSources(resumeRoot, jobSource = "") {
  if (!resumeRoot) {
    return [];
  }
  const sources = [
    "岑锴源_简历底稿.md",
    path.join("docs", "简历事实口径与红线.md"),
    path.join("docs", "版本清单.md")
  ];
  if (jobSource) {
    sources.push(jobSource);
  }
  return sources;
}

module.exports = {
  CONFIG_VERSION,
  getDefaultDataDir,
  getConfigPath,
  createDefaultConfig,
  normalizeConfig,
  readConfig,
  writeConfig,
  buildDefaultSources
};

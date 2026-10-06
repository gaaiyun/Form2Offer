#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { readConfig, writeConfig, buildDefaultSources, getDefaultDataDir } = require("../src/config.js");
const { SourceRegistry } = require("../src/sources.js");
const { SessionStore } = require("../src/session-store.js");
const { CodexHost } = require("../src/codex-host.js");
const { AgentHostRegistry } = require("../src/agent-host.js");
const { createBridgeServer } = require("../src/server.js");
const { startMcpStdio, createAutostart, createHttpClient } = require("../src/mcp.js");
const { stageProfilePackage, readStagedProfile } = require("../src/profile-package.js");

const BRIDGE_VERSION = require("../package.json").version;

function parseArgs(argv) {
  const result = { command: argv[0] || "serve" };
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    const value = argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[++index] : true;
    result[key] = value;
  }
  return result;
}

function resolveDataDir(args) {
  return path.resolve(String(args.dataDir || process.env.FORM2OFFER_BRIDGE_DATA_DIR || getDefaultDataDir()));
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(String(filePath)), "utf8").replace(/^﻿/, ""));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dataDir = resolveDataDir(args);
  const loaded = readConfig(dataDir);
  let config = loaded.config;

  if (args.command === "init") {
    const resumeRoot = String(args.resumeRoot || config.resumeRoot || "").trim();
    const jobSource = String(args.jobSource || "").trim();
    const customSources = String(args.sources || "").split(",").map((value) => value.trim()).filter(Boolean);
    config = {
      ...config,
      resumeRoot,
      sources: resumeRoot
        ? (customSources.length > 0 ? [...customSources, ...(jobSource ? [jobSource] : [])] : buildDefaultSources(resumeRoot, jobSource))
        : config.sources,
      applicationsFile: typeof args.applicationsFile === "string" ? args.applicationsFile : config.applicationsFile,
      port: Number(args.port) || config.port,
      codex: {
        ...config.codex,
        command: String(args.codexCommand || config.codex.command),
        enabled: args.disableCodex ? false : config.codex.enabled
      }
    };
    const saved = writeConfig(dataDir, config);
    process.stdout.write(`Config: ${saved.configPath}\nPairing code: ${saved.config.pairCode}\n`);
    return;
  }

  if (!loaded.exists) {
    ({ config } = writeConfig(dataDir, config));
  }

  // configure --from <json>：合并 applicationsFile / resumeVersions / candidate / sources / resumeRoot。
  if (args.command === "configure") {
    if (!args.from) throw new Error("configure 需要 --from <json 文件>。");
    const patch = readJsonFile(args.from);
    const allowed = ["applicationsFile", "resumeVersions", "candidate", "sources", "resumeRoot"];
    const next = { ...config };
    const updated = allowed.filter((key) => Object.hasOwn(patch, key));
    for (const key of updated) next[key] = patch[key];
    const saved = writeConfig(dataDir, next);
    process.stdout.write(`Config: ${saved.configPath}\nUpdated: ${updated.join(", ") || "(none)"}\n`);
    return;
  }

  // stage-profile --file <backup.json> [--note 说明]：不经 MCP 直接暂存资料底稿，供扩展设置页导入。
  if (args.command === "stage-profile") {
    if (!args.file) throw new Error("stage-profile 需要 --file <Form2Offer 备份 JSON>。");
    const result = stageProfilePackage(dataDir, readJsonFile(args.file), typeof args.note === "string" ? args.note : "");
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (args.command === "status") {
    process.stdout.write(`${JSON.stringify({
      version: BRIDGE_VERSION,
      dataDir,
      configPath: loaded.configPath,
      url: `http://${config.host}:${config.port}`,
      pairCode: config.pairCode,
      pairedBrowsers: config.browserTokenHashes.length,
      resumeRoot: config.resumeRoot,
      sources: config.sources,
      applicationsFile: config.applicationsFile,
      resumeVersions: config.resumeVersions.map((version) => `${version.id} ${version.label}`),
      candidate: config.candidate,
      stagedProfile: readStagedProfile(dataDir),
      codex: config.codex
    }, null, 2)}\n`);
    return;
  }

  if (args.command === "mcp") {
    const baseUrl = `http://${config.host}:${config.port}`;
    // 默认在 Bridge 未运行时自动拉起 serve；--no-autostart 关闭。
    const ensureRunning = args.noAutostart ? null : createAutostart({ baseUrl, entry: __filename, dataDir });
    const client = createHttpClient({ baseUrl, token: config.mcpToken, ensureRunning });
    startMcpStdio({ client });
    if (ensureRunning) {
      ensureRunning().catch(() => undefined);
    }
    return;
  }

  if (args.command !== "serve") {
    throw new Error(`Unknown command: ${args.command}`);
  }

  const sourceRegistry = new SourceRegistry(config);
  const codexHost = new CodexHost({
    command: config.codex.command,
    timeoutMs: config.codex.timeoutMs,
    dataDir,
    sourceRegistry
  });
  const sessionStore = new SessionStore();
  const agentHosts = new AgentHostRegistry().register("codex", codexHost);
  const bridge = createBridgeServer({
    config,
    dataDir,
    sessionStore,
    sourceRegistry,
    codexHost,
    agentHosts,
    saveConfig: (next) => {
      config = writeConfig(dataDir, next).config;
    }
  });
  const address = await bridge.listen();
  process.stdout.write(`Form2Offer Local Bridge ${BRIDGE_VERSION}\n`);
  process.stdout.write(`Listening: http://${address.address}:${address.port}\n`);
  process.stdout.write(`Pairing code: ${config.pairCode}\n`);
  process.stdout.write(`Approved sources: ${sourceRegistry.list().filter((source) => source.available).length}\n`);

  const stop = async () => {
    await bridge.close();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});

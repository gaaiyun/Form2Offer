#!/usr/bin/env node
"use strict";

const path = require("node:path");
const { readConfig, writeConfig, buildDefaultSources, getDefaultDataDir } = require("../src/config.js");
const { SourceRegistry } = require("../src/sources.js");
const { SessionStore } = require("../src/session-store.js");
const { CodexHost } = require("../src/codex-host.js");
const { AgentHostRegistry } = require("../src/agent-host.js");
const { createBridgeServer } = require("../src/server.js");
const { startMcpStdio } = require("../src/mcp.js");

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

  if (args.command === "status") {
    process.stdout.write(`${JSON.stringify({
      dataDir,
      configPath: loaded.configPath,
      url: `http://${config.host}:${config.port}`,
      pairCode: config.pairCode,
      pairedBrowsers: config.browserTokenHashes.length,
      resumeRoot: config.resumeRoot,
      sources: config.sources,
      codex: config.codex
    }, null, 2)}\n`);
    return;
  }

  if (args.command === "mcp") {
    startMcpStdio({ baseUrl: `http://${config.host}:${config.port}`, token: config.mcpToken });
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
    sessionStore,
    sourceRegistry,
    codexHost,
    agentHosts,
    saveConfig: (next) => {
      config = writeConfig(dataDir, next).config;
    }
  });
  const address = await bridge.listen();
  process.stdout.write(`Form2Offer Local Bridge 0.11.0\n`);
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

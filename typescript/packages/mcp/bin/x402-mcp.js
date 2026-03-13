#!/usr/bin/env node
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const entryPath = path.resolve(__dirname, "../src/command/mcp-server.ts");
const packageRoot = path.resolve(__dirname, "..");
const tsxLoaderPath = path.resolve(packageRoot, "node_modules/tsx/dist/loader.mjs");

const result = spawnSync(
  process.execPath,
  ["--import", tsxLoaderPath, entryPath, ...process.argv.slice(2)],
  {
    stdio: "inherit",
    env: process.env,
    cwd: packageRoot,
  },
);

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 0);

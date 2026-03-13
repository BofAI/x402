#!/usr/bin/env node
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const entryPath = path.resolve(__dirname, "../src/command/mcp-server.ts");

const result = spawnSync(
  process.execPath,
  ["--import", "tsx", entryPath, ...process.argv.slice(2)],
  {
    stdio: "inherit",
    env: process.env,
  },
);

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 0);

#!/usr/bin/env node
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { createRequire } = require("node:module");

const cliPath = path.resolve(__dirname, "../src/command/cli.ts");
const packageRoot = path.resolve(__dirname, "..");
const requireFromPackage = createRequire(path.join(packageRoot, "package.json"));
const tsxLoaderPath = requireFromPackage.resolve("tsx");

const result = spawnSync(
  process.execPath,
  ["--import", tsxLoaderPath, cliPath, ...process.argv.slice(2)],
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

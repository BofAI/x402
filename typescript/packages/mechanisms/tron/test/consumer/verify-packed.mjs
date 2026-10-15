import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const source = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(source, "../..");
const temp = mkdtempSync(join(tmpdir(), "tron-packed-"));
const run = (bin, args, cwd = temp) =>
  execFileSync(bin, args, { cwd, stdio: "pipe", encoding: "utf8" });
try {
  const packed = JSON.parse(
    run("npm", ["pack", "--json", "--pack-destination", temp], packageDir),
  )[0];
  writeFileSync(
    join(temp, "package.json"),
    JSON.stringify({
      private: true,
      dependencies: {
        "@bankofai/x402-tron": `file:${join(temp, packed.filename)}`,
        "@x402/core": "2.28.0",
        typescript: "5.7.3",
        "@types/node": "22.19.17",
      },
    }),
  );
  run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"]);
  const lock = readFileSync(join(temp, "package-lock.json"), "utf8");
  for (const forbidden of ["@bankofai/x402-core", "@bankofai/agent-wallet"]) {
    if (lock.includes(forbidden))
      throw new Error(`Basic consumer unexpectedly installs ${forbidden}`);
  }
  for (const file of ["payment.mts", "payment.cts"]) cpSync(join(source, file), join(temp, file));
  writeFileSync(
    join(temp, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        skipLibCheck: false,
        outDir: "compiled",
        types: ["node"],
      },
      include: ["payment.mts", "payment.cts"],
    }),
  );
  run(process.execPath, [
    join(temp, "node_modules/typescript/bin/tsc"),
    "--project",
    "tsconfig.json",
  ]);
  run(process.execPath, ["compiled/payment.mjs"]);
  run(process.execPath, ["compiled/payment.cjs"]);
  const manifest = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
  for (const entry of Object.keys(manifest.exports)) {
    const specifier = entry === "." ? manifest.name : manifest.name + entry.slice(1);
    run(process.execPath, [
      "--input-type=module",
      "-e",
      `await import(${JSON.stringify(specifier)})`,
    ]);
    run(process.execPath, ["-e", `require(${JSON.stringify(specifier)})`]);
  }
  console.log(
    `Packed consumers passed: ESM + CJS strict types, payments and ${Object.keys(manifest.exports).length} entrypoints; no old Core or Agent Wallet.`,
  );
} catch (error) {
  if (error.stdout) process.stderr.write(error.stdout);
  if (error.stderr) process.stderr.write(error.stderr);
  throw error;
} finally {
  rmSync(temp, { recursive: true, force: true });
}

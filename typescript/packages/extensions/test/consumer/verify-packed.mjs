import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  cpSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const source = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(source, "../..");
const tronDir = resolve(packageDir, "../mechanisms/tron");
const temp = mkdtempSync(join(tmpdir(), "tron-extensions-packed-"));
const run = (bin, args, cwd = temp) =>
  execFileSync(bin, args, { cwd, stdio: "pipe", encoding: "utf8" });
try {
  for (const dir of [tronDir, packageDir])
    run("npx", ["--yes", "pnpm@11.1.1", "pack", "--pack-destination", temp], dir);
  const tarballs = readdirSync(temp).filter(name => name.endsWith(".tgz"));
  const dependencies = { "@x402/core": "2.28.0", typescript: "5.7.3", "@types/node": "22.19.17" };
  for (const name of tarballs)
    dependencies[
      name.includes("tron-extensions") ? "@bankofai/x402-tron-extensions" : "@bankofai/x402-tron"
    ] = `file:${join(temp, name)}`;
  writeFileSync(join(temp, "package.json"), JSON.stringify({ private: true, dependencies }));
  run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"]);
  const lock = readFileSync(join(temp, "package-lock.json"), "utf8");
  for (const forbidden of [
    "@bankofai/x402-core",
    "@bankofai/agent-wallet",
    '"node_modules/@bankofai/x402-extensions"',
  ]) {
    if (lock.includes(forbidden)) throw new Error(`Unexpected runtime dependency ${forbidden}`);
  }
  for (const file of ["payment.mts", "payment.cts", "sponsored-payment.mjs"])
    cpSync(join(source, file), join(temp, file));
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
  for (const format of ["mjs", "cjs"]) run(process.execPath, [`compiled/payment.${format}`]);
  for (const format of ["esm", "cjs"]) run(process.execPath, ["sponsored-payment.mjs", format]);
  for (const dir of [tronDir, packageDir]) {
    const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    for (const field of ["main", "module", "types"]) {
      if (!existsSync(join(temp, "node_modules", manifest.name, manifest[field])))
        throw new Error(`${manifest.name}: missing ${field} entry ${manifest[field]}`);
    }
    for (const entry of Object.keys(manifest.exports)) {
      const specifier = entry === "." ? manifest.name : manifest.name + entry.slice(1);
      run(process.execPath, [
        "--input-type=module",
        "-e",
        `await import(${JSON.stringify(specifier)})`,
      ]);
      run(process.execPath, ["-e", `require(${JSON.stringify(specifier)})`]);
    }
  }
  console.log(
    "Packed TRON + extension consumers passed: strict ESM/CJS, real Approval signatures, runtime registration and pre-approved ordinary payments; no old Core, generic extensions or Agent Wallet.",
  );
} catch (error) {
  if (error.stdout) process.stderr.write(error.stdout);
  if (error.stderr) process.stderr.write(error.stderr);
  throw error;
} finally {
  rmSync(temp, { recursive: true, force: true });
}

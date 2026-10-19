/**
 * Capture TRON SDK logs through its public logger, without keys or network I/O.
 * Official Core and extension packages retain their own logging behavior.
 *
 * Run: pnpm dev:logging, then inspect ./x402.log.
 */
import { createWriteStream } from "node:fs";
import { resolve } from "node:path";
import { setLogger, noopLogger, type Logger } from "@bankofai/x402-tron";
import { resolveTronRpcUrl } from "@bankofai/x402-tron/rpc";

const LOG_FILE = resolve(process.cwd(), "x402.log");

/**
 * A minimal file logger. Writes one line per call and also tees to the console
 * so you can watch it live. Real apps would hand the SDK a pino/winston adapter
 * instead — the shape is the same four methods.
 *
 * @param path - Destination log file path.
 * @returns A {@link Logger} that appends to the file (and echoes to stdout).
 */
function fileLogger(path: string): Logger {
  const out = createWriteStream(path, { flags: "a" });
  const write =
    (level: string) =>
    (...args: unknown[]) => {
      const line = `${new Date().toISOString()} ${level} ${args
        .map(a => (typeof a === "string" ? a : JSON.stringify(a)))
        .join(" ")}`;
      out.write(`${line}\n`);
      console.log(line); // tee to stdout so the example is visible when run
    };
  return {
    debug: write("DEBUG"),
    info: write("INFO"),
    warn: write("WARN"),
    error: write("ERROR"),
  };
}

/** Demonstrates the default, custom, and silent TRON log sinks without RPC calls. */
function main(): void {
  // Each network emits its fallback warning once per process.
  console.log("--- default TRON logger ---");
  resolveTronRpcUrl("tron:3448148188");

  console.log(`--- capture TRON logs in ${LOG_FILE} ---`);
  setLogger(fileLogger(LOG_FILE));
  resolveTronRpcUrl("tron:728126428");

  console.log("--- silence TRON logs ---");
  setLogger(noopLogger);
  resolveTronRpcUrl("tron:2494104990");

  console.log(`Inspect captured TRON output: ${LOG_FILE}`);
}

main();

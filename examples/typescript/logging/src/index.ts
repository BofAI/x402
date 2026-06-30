/**
 * Logging example — redirect ALL `@bankofai/x402-*` SDK logs to a file.
 *
 * The SDK writes every log line through one process-global logger. By default it
 * writes to `console`; calling `setLogger(...)` once at startup re-routes every
 * package (core, mechanisms, http middleware, extensions) — no per-call wiring,
 * no change to any SDK function signature.
 *
 * This script installs a file logger, then triggers a real SDK code path
 * (`validateBazaarRouteExtensions` with a malformed route) so you can see genuine
 * SDK output land in the file — offline, no keys, no network.
 *
 * Run:  pnpm dev:logging      (from examples/typescript)
 * Then: cat ./x402.log
 */
import { createWriteStream } from "node:fs";
import { resolve } from "node:path";
import { setLogger, noopLogger, type Logger } from "@bankofai/x402-core";
import { validateBazaarRouteExtensions } from "@bankofai/x402-extensions/bazaar";

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

// A route whose bazaar extension is malformed — the SDK warns about it.
const badRoutes = {
  "GET /weather": {
    accepts: { scheme: "exact", payTo: "0x0", price: "$0.01", network: "eip155:97" },
    extensions: { bazaar: "not-an-object" },
  },
};

function main(): void {
  // 1) Default behavior (console) — no setLogger call yet.
  console.log("--- before setLogger: SDK logs go to console ---");
  validateBazaarRouteExtensions(badRoutes as never);

  // 2) Redirect every SDK log to the file (one call, global).
  console.log(`\n--- after setLogger: SDK logs now also captured in ${LOG_FILE} ---`);
  setLogger(fileLogger(LOG_FILE));
  validateBazaarRouteExtensions(badRoutes as never);

  // 3) Silence the SDK entirely.
  console.log("\n--- after setLogger(noopLogger): SDK is silent ---");
  setLogger(noopLogger);
  validateBazaarRouteExtensions(badRoutes as never);
  console.log("(nothing logged above — SDK silenced)\n");

  console.log(`Done. Inspect captured SDK output:\n  cat ${LOG_FILE}`);
}

main();

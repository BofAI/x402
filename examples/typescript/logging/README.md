# logging — redirect SDK logs to a file

Shows how a third-party app captures **all** `@bankofai/x402-*` log output (across
core, mechanisms, http middleware, extensions) by installing one process-global
logger — no per-call wiring, no change to any SDK signature.

## Run

```bash
pnpm install            # from examples/typescript (links local SDK)
pnpm dev:logging        # runs this example
cat ./x402.log          # captured SDK output
```

No keys, no network, no chain — it triggers a real SDK log path
(`validateBazaarRouteExtensions` on a malformed route) so you see genuine SDK
lines, not a synthetic print.

## What it demonstrates

| Step | Call | Effect |
|---|---|---|
| 1 | (default) | SDK logs go to `console` — behavior when you do nothing |
| 2 | `setLogger(fileLogger("x402.log"))` | every SDK log line is captured to the file |
| 3 | `setLogger(noopLogger)` | the SDK goes silent |

## The contract

```ts
import { setLogger, noopLogger, getLogger, consoleLogger, type Logger } from "@bankofai/x402-core";

// Logger is console-shaped — four methods, variadic args:
interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

setLogger(myLogger);   // call once at startup; affects all SDK packages
```

- **Default is `console`** — omitting `setLogger` keeps today's behavior.
- It's a **global** logger (not per-instance). Components are not distinguished;
  the message text carries any `[x402]` / `[tron]` prefix the SDK already adds.

> **Facilitator verify/settle logs are opt-in.** The `x402Facilitator` body stays
> byte-identical to upstream, so it emits no verify/settle logs on its own.
> Construct it via `createFacilitator()` (or call `attachFacilitatorLogging(f)`)
> to register that observability on its hooks — those lines then flow through the
> same global logger set here. See `examples/typescript/facilitator/gasfree`.

## Adapting a real logger

`pino` (arg order is `(obj, msg)`, so adapt):

```ts
import pino from "pino";
const p = pino(pino.destination("./x402.log"));
setLogger({
  debug: (m, f) => p.debug(f ?? {}, String(m)),
  info:  (m, f) => p.info(f ?? {}, String(m)),
  warn:  (m, f) => p.warn(f ?? {}, String(m)),
  error: (m, f) => p.error(f ?? {}, String(m)),
});
```

`winston` (arg order already matches):

```ts
import { createLogger, transports, format } from "winston";
const w = createLogger({
  format: format.combine(format.timestamp(), format.json()),
  transports: [new transports.File({ filename: "./x402.log" })],
});
setLogger({ debug: w.debug.bind(w), info: w.info.bind(w), warn: w.warn.bind(w), error: w.error.bind(w) });
```

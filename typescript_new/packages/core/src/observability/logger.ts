/**
 * SDK-wide logger — BankofAI overlay, NOT from upstream.
 *
 * A single process-global logger every SDK module writes through, so consumers
 * can redirect/capture/silence all x402 output (e.g. to a file) without the SDK
 * threading a logger through every signature. This is a NEW overlay file; the
 * only upstream-touching change is swapping `console.*` call sites for `log.*`.
 *
 * Design:
 * - {@link Logger} is `console`-shaped (variadic) so call sites are a pure
 *   `console.X(...)` → `log.X(...)` swap. `console.log(...)` maps to `log.info`.
 * - {@link log} is a thin proxy that reads the active logger at call time, so
 *   {@link setLogger} works regardless of import order.
 * - Default is {@link consoleLogger} → behavior is unchanged until a consumer
 *   opts in. There is no per-component logger; the message text carries any
 *   `[component]` prefix the call site already includes.
 *
 * @example
 * ```ts
 * import { setLogger } from "@bankofai/x402-core";
 * setLogger(myFileLogger);   // all SDK logging now flows here
 * ```
 */

/** Log sink the SDK writes through. Signatures mirror `console` for drop-in use. */
export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

/** Default logger: writes to `console`, reproducing the SDK's prior output. */
export const consoleLogger: Logger = {
  debug: (...args) => console.debug(...args),
  info: (...args) => console.info(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args),
};

/** Logger that discards everything — pass to {@link setLogger} to silence the SDK. */
export const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

let active: Logger = consoleLogger;

/**
 * Install the process-global logger used by all SDK code.
 *
 * @param logger - The logger to route SDK output through.
 */
export function setLogger(logger: Logger): void {
  active = logger;
}

/**
 * Reset the global logger to {@link consoleLogger}. Primarily for tests, to
 * avoid one suite's logger leaking into the next.
 */
export function resetLogger(): void {
  active = consoleLogger;
}

/**
 * The currently installed logger.
 *
 * @returns The active logger (defaults to {@link consoleLogger}).
 */
export function getLogger(): Logger {
  return active;
}

/**
 * The handle SDK modules import and write through. Each method dispatches to the
 * active logger at call time, so a later {@link setLogger} still takes effect.
 */
export const log: Logger = {
  debug: (...args) => active.debug(...args),
  info: (...args) => active.info(...args),
  warn: (...args) => active.warn(...args),
  error: (...args) => active.error(...args),
};

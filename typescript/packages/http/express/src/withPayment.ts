/**
 * Per-route payment HOF for Express.
 *
 * Provides a declarative way to protect individual Express routes with x402 payment
 * requirements, as an alternative to the global middleware approach.
 */

import {
  x402HTTPResourceServer,
  type PaywallConfig,
  type PaywallProvider,
} from "@bankofai/x402-core/server";
import type { x402ResourceServer } from "@bankofai/x402-core/server";
import type { PaymentOption } from "@bankofai/x402-core/server";
import { paymentMiddlewareFromHTTPServer } from "./index.js";

/**
 * Optional configuration for the withPayment HOF.
 */
export interface WithPaymentOptions {
  description?: string;
  mimeType?: string;
  paywallConfig?: PaywallConfig;
  paywall?: PaywallProvider;
  extensions?: Record<string, unknown>;
}

/**
 * Express per-route payment HOF.
 *
 * Returns an Express middleware that enforces x402 payment for a single route.
 * Internally constructs a wildcard-matched x402HTTPResourceServer and delegates
 * to the existing paymentMiddlewareFromHTTPServer logic.
 *
 * @param accepts - Payment option(s) for this route
 * @param server - Pre-configured x402ResourceServer instance
 * @param options - Optional route metadata and paywall configuration
 * @returns Express middleware handler
 *
 * @example
 * ```typescript
 * import { withPayment } from "@bankofai/x402-express";
 *
 * app.get("/weather",
 *   withPayment({ scheme: "exact", network: "eip155:8453", payTo: addr, price: "$0.01" }, server),
 *   (req, res) => { res.json({ report: "sunny" }); }
 * );
 * ```
 */
export function withPayment(
  accepts: PaymentOption | PaymentOption[],
  server: x402ResourceServer,
  options?: WithPaymentOptions,
) {
  const routeConfig = {
    accepts,
    description: options?.description,
    mimeType: options?.mimeType,
    extensions: options?.extensions,
  };

  const httpServer = new x402HTTPResourceServer(server, { "*": routeConfig });

  return paymentMiddlewareFromHTTPServer(httpServer, options?.paywallConfig, options?.paywall);
}

/**
 * Per-route payment HOF for Next.js App Router.
 *
 * Provides a simplified API for protecting individual Next.js route handlers
 * with x402 payment requirements, wrapping the existing withX402 function.
 */

import type { x402ResourceServer } from "@bankofai/x402-core/server";
import type { PaywallConfig, PaywallProvider, PaymentOption } from "@bankofai/x402-core/server";
import type { NextRequest, NextResponse } from "next/server";
import { withX402 } from "./index.js";

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
 * Next.js per-route payment HOF.
 *
 * Wraps a Next.js App Router route handler with x402 payment protection.
 * This is a simplified version of withX402 that accepts PaymentOption(s)
 * directly instead of a full RouteConfig.
 *
 * @param handler - The route handler to protect
 * @param accepts - Payment option(s) for this route
 * @param server - Pre-configured x402ResourceServer instance
 * @param options - Optional route metadata and paywall configuration
 * @returns A wrapped Next.js route handler
 *
 * @example
 * ```typescript
 * import { withPayment } from "@bankofai/x402-next";
 *
 * const handler = async (req: NextRequest) => {
 *   return NextResponse.json({ data: "premium" });
 * };
 *
 * export const GET = withPayment(
 *   handler,
 *   { scheme: "exact", network: "eip155:8453", payTo: addr, price: "$0.01" },
 *   server,
 * );
 * ```
 */
export function withPayment<T = unknown>(
  handler: (request: NextRequest) => Promise<NextResponse<T>>,
  accepts: PaymentOption | PaymentOption[],
  server: x402ResourceServer,
  options?: WithPaymentOptions,
): (request: NextRequest) => Promise<NextResponse<T>> {
  const routeConfig = {
    accepts,
    description: options?.description,
    mimeType: options?.mimeType,
    extensions: options?.extensions,
  };

  return withX402(handler, routeConfig, server, options?.paywallConfig, options?.paywall);
}

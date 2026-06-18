import type { PaymentRequirements } from "@bankofai/x402-core/types";
import type { SelectPaymentRequirements } from "@bankofai/x402-core/client";
import { getDecimals } from "./tokens";

/**
 * Token selection strategies for choosing which TRON token to pay with.
 *
 * All supported tokens are stablecoins, so selection normalizes raw amounts by
 * token decimals to compare real value (lower is cheaper for the payer). This
 * lives in `@bankofai/x402-tron` (not core) because decimals come from the TRON token
 * registry — core stays chain-agnostic.
 */
export interface TokenSelectionStrategy {
  /**
   * Choose one requirement from the available options.
   *
   * @param accepts - The candidate payment requirements.
   * @returns The selected requirement.
   */
  select(accepts: PaymentRequirements[]): PaymentRequirements;
}

/**
 * Normalize a requirement's amount to real value using token decimals.
 *
 * @param req - The payment requirement.
 * @returns The decimal-normalized cost.
 */
function normalizedCost(req: PaymentRequirements): number {
  const decimals = getDecimals(req.network, req.asset);
  return Number(BigInt(req.amount)) / 10 ** decimals;
}

/**
 * Default strategy: normalize by token decimals and pick the cheapest option.
 *
 * Ranks tokens with different precisions fairly (e.g. USDT 6 vs USDD 18).
 */
export class CheapestTokenSelectionStrategy implements TokenSelectionStrategy {
  /**
   * Pick the cheapest requirement by decimal-normalized value.
   *
   * @param accepts - The candidate payment requirements.
   * @returns The cheapest requirement.
   */
  select(accepts: PaymentRequirements[]): PaymentRequirements {
    if (accepts.length === 0) {
      throw new Error("No payment options available");
    }
    let best = accepts[0]!;
    let bestCost = normalizedCost(best);
    for (let i = 1; i < accepts.length; i++) {
      const cost = normalizedCost(accepts[i]!);
      if (cost < bestCost) {
        best = accepts[i]!;
        bestCost = cost;
      }
    }
    return best;
  }
}

/** Default token selection strategy for TRON. */
export const DefaultTokenSelectionStrategy = CheapestTokenSelectionStrategy;

/**
 * Build a synchronous x402Client `paymentRequirementsSelector` that picks the
 * cheapest TRON token by decimal-normalized value.
 *
 * Pass to `new x402Client(selector)` or `x402Client.fromConfig`. Intended for
 * TRON-only clients; for mixed-chain clients, provide a selector that routes by
 * network first.
 *
 * @param strategy - The selection strategy (defaults to cheapest).
 * @returns A selector compatible with x402Client.
 */
export function createCheapestTokenSelector(
  strategy: TokenSelectionStrategy = new CheapestTokenSelectionStrategy(),
): SelectPaymentRequirements {
  return (_x402Version: number, accepts: PaymentRequirements[]) => strategy.select(accepts);
}

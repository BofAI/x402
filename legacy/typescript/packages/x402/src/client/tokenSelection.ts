/**
 * Token selection strategies for choosing which token to pay with.
 *
 * All tokens are assumed to be stablecoins, so selection normalizes raw amounts
 * by token decimals to compare real value (lower is better for the payer).
 */

import { findByAddress } from '../tokens.js';
import type { PaymentRequirements } from '../types/index.js';

/** Strategy for selecting which payment option to use */
export interface TokenSelectionStrategy {
  select(accepts: PaymentRequirements[]): PaymentRequirements;
}

function getDecimals(req: PaymentRequirements): number {
  const token = findByAddress(req.network, req.asset);
  return token?.decimals ?? 6;
}

function normalizedCost(req: PaymentRequirements): number {
  const decimals = getDecimals(req);
  return Number(BigInt(req.amount)) / 10 ** decimals;
}

/**
 * Default strategy: normalize by token decimals, pick cheapest.
 *
 * Compares real value (amount / 10^decimals) so that tokens with
 * different precisions (e.g. USDT 6, USDD 18) are ranked fairly.
 */
export class CheapestTokenSelectionStrategy implements TokenSelectionStrategy {
  select(accepts: PaymentRequirements[]): PaymentRequirements {
    if (accepts.length === 0) {
      throw new Error('No payment options available');
    }

    let best = accepts[0];
    let bestCost = normalizedCost(best);

    for (let i = 1; i < accepts.length; i++) {
      const cost = normalizedCost(accepts[i]);
      if (cost < bestCost) {
        best = accepts[i];
        bestCost = cost;
      }
    }

    return best;
  }
}

export const DefaultTokenSelectionStrategy = CheapestTokenSelectionStrategy;

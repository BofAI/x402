import type { PaymentRequirements } from "@bankofai/x402-core/types";
import { CheapestTokenSelectionStrategy, type TokenSelectionStrategy } from "./tokenSelection";

/**
 * Balance-aware payment selection for TRON.
 *
 * core's policy/selector pipeline is synchronous, so balance filtering (which
 * needs async on-chain reads) is provided here as explicit helpers an
 * application calls before creating a payment payload — keeping core unchanged.
 */

/** A TRON client scheme that can report the payer's balance. */
export interface BalanceCheckable {
  /**
   * Return the payer's spendable balance for an asset on a network.
   *
   * @param asset - The TRC-20 contract address.
   * @param network - The network identifier.
   * @returns The balance in smallest units.
   */
  checkBalance(asset: string, network: string): Promise<bigint>;

  /**
   * Estimate the total deduction required to fulfill a requirement,
   * including scheme-specific fees (e.g. GasFree transferFee/activateFee).
   *
   * When omitted, the cost defaults to req.amount (no extra fees).
   *
   * @param req - The payment requirement.
   * @returns The estimated total cost in smallest units.
   */
  estimateCost?(req: PaymentRequirements): Promise<bigint>;
}

/**
 * Filter out requirements the payer cannot afford.
 *
 * Requirements whose balance cannot be determined are kept, deferring the
 * decision to createPaymentPayload.
 *
 * @param scheme - A client scheme exposing checkBalance (and optionally
 *   estimateCost for schemes with extra on-chain fees, e.g. GasFree).
 * @param accepts - The candidate payment requirements.
 * @returns The affordable subset (possibly empty).
 */
export async function filterAffordableRequirements(
  scheme: BalanceCheckable,
  accepts: PaymentRequirements[],
): Promise<PaymentRequirements[]> {
  const affordable: PaymentRequirements[] = [];
  for (const req of accepts) {
    let balance: bigint;
    try {
      balance = await scheme.checkBalance(req.asset, req.network);
    } catch {
      // Cannot determine balance; keep and let createPaymentPayload decide.
      affordable.push(req);
      continue;
    }
    let needed = BigInt(req.amount);
    if (scheme.estimateCost) {
      try {
        needed = await scheme.estimateCost(req);
      } catch {
        // Cannot estimate scheme-specific cost; defer to createPaymentPayload.
        affordable.push(req);
        continue;
      }
    }
    if (balance >= needed) {
      affordable.push(req);
    }
  }
  return affordable;
}

/**
 * Choose the best affordable requirement: filter by balance, then apply a
 * selection strategy (cheapest by default).
 *
 * @param scheme - A client scheme exposing checkBalance.
 * @param accepts - The candidate payment requirements.
 * @param strategy - The selection strategy among affordable options.
 * @returns The selected requirement, or undefined when none are affordable.
 */
export async function selectAffordableRequirement(
  scheme: BalanceCheckable,
  accepts: PaymentRequirements[],
  strategy: TokenSelectionStrategy = new CheapestTokenSelectionStrategy(),
): Promise<PaymentRequirements | undefined> {
  const affordable = await filterAffordableRequirements(scheme, accepts);
  if (affordable.length === 0) {
    return undefined;
  }
  return strategy.select(affordable);
}

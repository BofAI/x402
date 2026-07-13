import type { PaymentRequirements } from "@bankofai/x402-core/types";
import { CheapestTokenSelectionStrategy, type TokenSelectionStrategy } from "./tokenSelection";
import { readFeeFromExtra } from "./fee";

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
}

/**
 * Filter out requirements the payer cannot afford.
 *
 * Requirements whose balance cannot be determined are kept, deferring the
 * decision to createPaymentPayload. Only `exact_gasfree` adds its enforced
 * relayer fee to the required amount; `exact` and `upto` proxies transfer
 * exactly `amount` and carry no fee, so stale `extra.fee` metadata is ignored.
 *
 * @param scheme - A client scheme exposing checkBalance.
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
    if (req.scheme === "exact_gasfree") {
      const fee = readFeeFromExtra(req.extra);
      if (fee) {
        needed += BigInt(fee.feeAmount);
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

/**
 * Payment policies for filtering or reordering payment requirements.
 *
 * Policies are applied in order after mechanism filtering and before token selection.
 */

import { findByAddress } from '../tokens.js';
import type { PaymentRequirements } from '../types/index.js';
import type { PaymentPolicy } from './x402Client.js';
import type { X402Client } from './x402Client.js';

function getDecimals(req: PaymentRequirements): number {
  const token = findByAddress(req.network, req.asset);
  return token?.decimals ?? 6;
}

/**
 * Policy that filters out requirements with insufficient balance.
 *
 * When the server accepts multiple tokens (e.g. USDT and USDD),
 * this policy checks the balance for each payment option via the
 * mechanism's checkBalance() and removes requirements the user
 * cannot afford.
 *
 * Mechanisms are auto-resolved from registered entries via the
 * X402Client instance passed at construction time.
 *
 * Usage:
 *   x402.registerPolicy(SufficientBalancePolicy);
 *
 * If no mechanism is registered for a requirement's scheme+network,
 * that requirement is skipped (excluded from results).
 *
 * If all requirements are unaffordable, returns an empty array so the
 * caller can raise an appropriate error.
 */
export class SufficientBalancePolicy implements PaymentPolicy {
  private client: X402Client;

  constructor(client: X402Client) {
    this.client = client;
  }

  async apply(requirements: PaymentRequirements[]): Promise<PaymentRequirements[]> {
    const affordable: PaymentRequirements[] = [];
    for (const req of requirements) {
      const mechanism = this.client.resolveMechanism(req.scheme, req.network);
      if (!mechanism) {
        console.debug(`[x402] No mechanism for scheme=${req.scheme} network=${req.network} (skipped)`);
        continue;
      }

      let balance: bigint;
      try {
        if (mechanism.checkBalance) {
          balance = await mechanism.checkBalance(req.asset, req.network);
        } else {
          const signer = mechanism.getSigner?.();
          if (!signer) {
            // Cannot determine balance; keep the requirement and let
            // createPaymentPayload decide.
            affordable.push(req);
            continue;
          }
          balance = await signer.checkBalance(req.asset, req.network);
        }
      } catch (err) {
        console.warn(`[x402] checkBalance raised for ${req.asset} on ${req.network}; keeping requirement.`, err);
        affordable.push(req);
        continue;
      }

      let needed = BigInt(req.amount);
      if (req.extra?.fee?.feeAmount) {
        needed += BigInt(req.extra.fee.feeAmount);
      }
      const decimals = getDecimals(req);
      const token = findByAddress(req.network, req.asset);
      const symbol = token?.symbol ?? req.asset.slice(0, 8);
      const divisor = 10 ** decimals;
      const hBalance = (Number(balance) / divisor).toFixed(decimals);
      const hNeeded = (Number(needed) / divisor).toFixed(decimals);
      if (balance >= needed) {
        console.log(
          `[x402] ${symbol} on ${req.network}: balance=${hBalance} >= needed=${hNeeded} (OK)`
        );
        affordable.push(req);
      } else {
        console.log(
          `[x402] ${symbol} on ${req.network}: balance=${hBalance} < needed=${hNeeded} (skipped)`
        );
      }
    }
    if (affordable.length === 0) {
      console.error('[x402] All payment requirements filtered: insufficient balance');
    }
    return affordable;
  }
}

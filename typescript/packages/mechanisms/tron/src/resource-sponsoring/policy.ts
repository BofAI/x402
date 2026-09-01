import { TronWeb } from "tronweb";
import { normalizeTronNetwork } from "../network";
import type { Trc20ResourceSponsoringPolicy, Trc20SponsoringPolicyDecision } from "./types";

/** Bounds for a local allowlist-and-cost sponsorship policy. */
export interface StaticTrc20ResourceSponsoringPolicyOptions {
  readonly allowedNetworks: readonly string[];
  readonly allowedAssets: Readonly<Record<string, readonly string[]>>;
  readonly maxReplacementCost?: bigint;
  readonly budgetUnits?: (replacementCost: bigint) => bigint;
}

/**
 * Normalizes a TRON address for allowlist comparison.
 *
 * @param address - Base58Check or hexadecimal TRON address.
 * @returns Lowercase 21-byte hexadecimal address.
 */
function normalizeAddress(address: string): string {
  return TronWeb.address.toHex(address).toLowerCase();
}

/**
 * Creates a deterministic local policy suitable for composition with tenant credit admission.
 *
 * @param options - Network, token, and replacement-cost bounds.
 * @returns A read-only sponsorship policy.
 */
export function createStaticTrc20ResourceSponsoringPolicy(
  options: StaticTrc20ResourceSponsoringPolicyOptions,
): Trc20ResourceSponsoringPolicy {
  const networks = new Set(options.allowedNetworks.map(normalizeTronNetwork));
  const assets = new Map(
    Object.entries(options.allowedAssets).map(([network, addresses]) => [
      normalizeTronNetwork(network),
      new Set(addresses.map(normalizeAddress)),
    ]),
  );
  return {
    async preview(request, plan): Promise<Trc20SponsoringPolicyDecision> {
      const network = normalizeTronNetwork(request.network);
      if (!networks.has(network)) {
        return { allowed: false, reason: "unsupported_network" };
      }
      if (!assets.get(network)?.has(normalizeAddress(request.asset))) {
        return { allowed: false, reason: "approval_asset_not_allowed" };
      }
      if (options.maxReplacementCost != null && plan.replacementCost > options.maxReplacementCost) {
        return { allowed: false, reason: "sponsor_cost_exceeds_cap" };
      }
      return {
        allowed: true,
        budgetUnits: options.budgetUnits?.(plan.replacementCost) ?? plan.replacementCost,
      };
    },
  };
}

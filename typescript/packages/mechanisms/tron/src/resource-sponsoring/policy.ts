/* eslint-disable jsdoc/require-jsdoc, jsdoc/require-param, jsdoc/require-returns */
import { TronWeb } from "tronweb";
import type { Trc20ResourceSponsoringPolicy, Trc20SponsoringPolicyDecision } from "./types";

/** Bounds for a local allowlist-and-cost sponsorship policy. */
export interface StaticTrc20ResourceSponsoringPolicyOptions {
  readonly allowedNetworks: readonly string[];
  readonly allowedAssets: Readonly<Record<string, readonly string[]>>;
  readonly maxReplacementCost?: bigint;
  readonly budgetUnits?: (replacementCost: bigint) => bigint;
}

function normalizeAddress(address: string): string {
  return TronWeb.address.toHex(address).toLowerCase();
}

/** Creates a deterministic local policy suitable for composition with tenant credit admission. */
export function createStaticTrc20ResourceSponsoringPolicy(
  options: StaticTrc20ResourceSponsoringPolicyOptions,
): Trc20ResourceSponsoringPolicy {
  const networks = new Set(options.allowedNetworks);
  const assets = new Map(
    Object.entries(options.allowedAssets).map(([network, addresses]) => [
      network,
      new Set(addresses.map(normalizeAddress)),
    ]),
  );
  return {
    async preview(request, plan): Promise<Trc20SponsoringPolicyDecision> {
      if (!networks.has(request.network)) {
        return { allowed: false, reason: "unsupported_network" };
      }
      if (!assets.get(request.network)?.has(normalizeAddress(request.asset))) {
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

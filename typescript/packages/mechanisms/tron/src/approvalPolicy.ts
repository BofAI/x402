import { TronWeb } from "tronweb";
import type { Network } from "@bankofai/x402-core/types";
import { findByAddress } from "./shared/tokens";

/** How a TRC-20 token permits an existing non-zero Approval to be updated. */
export type Trc20ApprovalUpdateStrategy = "zero-first" | "direct-overwrite" | "unsupported";

/** Shared token Approval policy used by sponsored and self-funded Client paths. */
export interface Trc20ApprovalPolicy {
  strategyFor(network: string, token: string): Trc20ApprovalUpdateStrategy;
}

/** Configuration for a normalized per-network Approval policy. */
export interface CreateTrc20ApprovalPolicyOptions {
  readonly allowedAssets?: Readonly<Record<string, readonly string[]>>;
  readonly strategies?: Readonly<
    Record<string, Readonly<Record<string, Trc20ApprovalUpdateStrategy>>>
  >;
}

/**
 * Normalizes a TRON address for policy lookup.
 *
 * @param address - Base58Check or hexadecimal TRON address.
 * @returns Lowercase 21-byte hexadecimal address.
 */
function normalizeAddress(address: string): string {
  return TronWeb.address.toHex(address).toLowerCase();
}

/**
 * Creates an immutable per-token Approval update policy.
 *
 * Explicit strategies take precedence. Assets in `allowedAssets` and built-in
 * Permit2 assets default conservatively to `zero-first`; unknown assets are
 * unsupported.
 *
 * @param options - Optional asset allowlist and explicit token strategies.
 * @returns A shared policy resolver.
 */
export function createTrc20ApprovalPolicy(
  options: CreateTrc20ApprovalPolicyOptions = {},
): Trc20ApprovalPolicy {
  const allowedAssets = new Map(
    Object.entries(options.allowedAssets ?? {}).map(([network, assets]) => [
      network,
      new Set(assets.map(normalizeAddress)),
    ]),
  );
  const strategies = new Map(
    Object.entries(options.strategies ?? {}).map(([network, entries]) => [
      network,
      new Map(
        Object.entries(entries).map(([token, strategy]) => [normalizeAddress(token), strategy]),
      ),
    ]),
  );

  return {
    strategyFor(network, token) {
      const normalized = normalizeAddress(token);
      const configured = strategies.get(network)?.get(normalized);
      if (configured) return configured;
      if (allowedAssets.get(network)?.has(normalized)) return "zero-first";
      return findByAddress(network as Network, token)?.assetTransferMethod === "permit2"
        ? "zero-first"
        : "unsupported";
    },
  };
}

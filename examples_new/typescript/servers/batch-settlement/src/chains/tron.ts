/**
 * TRON setup for the batch-settlement resource server — mirrors the EVM module.
 *
 * Key-less: registers the `batch-settlement` server scheme, advertises `accepts`,
 * and runs a `BatchSettlementChannelManager` that claims + settles to `payTo`.
 * The `receiverAuthorizer` comes from the facilitator (`/supported`).
 *
 * `tron:nile` USDT IS in the default-asset registry, so the channel manager is
 * built via `scheme.createChannelManager()` (it resolves the token) and the price
 * is given in `"$"` form (the scheme maps it to the default asset). USDT is a
 * Permit2 token (no ERC-3009), so the client deposits via Permit2 — the payer
 * needs a one-time `approve(Permit2)` (the shipped client auto-broadcasts it).
 */
import { BatchSettlementServerScheme } from "@bankofai/x402-tron/batch-settlement/server";
import type { FacilitatorClient } from "@bankofai/x402-core/server";
import type { x402ResourceServer } from "@bankofai/x402-express";

import type { StoppableManager } from "./evm.js";

// Switch to "tron:mainnet" for production (REAL FUNDS): USDT is registered there
// too — only the facilitator/client TronWeb `fullHost` must point at mainnet.
export const TRON_NETWORK: `${string}:${string}` = "tron:nile";

/** TRON is enabled when a payout address is configured. */
export function hasTron(): boolean {
  return !!process.env.TRON_ADDRESS;
}

/**
 * Registers the TRON `batch-settlement` server scheme and starts its channel
 * manager.
 *
 * @param resourceServer - The resource server to register on.
 * @param facilitator - Facilitator client the channel manager submits claims/settles through.
 * @returns The started channel manager (for graceful shutdown).
 */
export function registerTron(
  resourceServer: x402ResourceServer,
  facilitator: FacilitatorClient,
): StoppableManager[] {
  const payTo = process.env.TRON_ADDRESS as string;
  const scheme = new BatchSettlementServerScheme(payTo);
  resourceServer.register(TRON_NETWORK, scheme);

  const manager = scheme.createChannelManager(facilitator, TRON_NETWORK);
  manager.start({
    claimIntervalSecs: 60,
    settleIntervalSecs: 120,
    refundIntervalSecs: 180,
    maxClaimsPerBatch: 100,
    selectRefundChannels: (channels, context) =>
      channels.filter(channel => {
        if (BigInt(channel.balance) === 0n) return false;
        if (channel.pendingRequest && channel.pendingRequest.expiresAt > context.now) return false;
        return context.now - channel.lastRequestTimestamp >= 180_000;
      }),
    onClaim: r => console.log(`[tron] claimed ${r.vouchers} vouchers (tx ${r.transaction})`),
    onSettle: r => console.log(`[tron] settled to ${payTo} (tx ${r.transaction})`),
    onRefund: r => console.log(`[tron] refunded channel ${r.channel} (tx ${r.transaction})`),
    onError: e => console.error("[tron] settlement error:", e),
  });
  console.info(`[tron] server registered ${TRON_NETWORK} batch-settlement (payTo ${payTo})`);
  return [manager];
}

/**
 * Builds the `accepts` entries advertised for TRON batch payments — USDT, priced
 * in `"$"` form (the batch scheme maps it to the network's default asset, USDT).
 *
 * @returns Payment-requirements accept entries.
 */
export function tronAccepts() {
  const payTo = process.env.TRON_ADDRESS as string;
  return [
    {
      scheme: "batch-settlement",
      network: TRON_NETWORK,
      payTo,
      price: "$0.001",
    },
  ];
}

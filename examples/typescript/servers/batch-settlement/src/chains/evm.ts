/**
 * EVM setup for the batch-settlement resource server.
 *
 * Key-less: registers the `batch-settlement` server scheme, advertises `accepts`
 * (price + payTo), and runs a `BatchSettlementChannelManager` that periodically
 * claims vouchers and settles them on-chain to `payTo`. The `receiverAuthorizer`
 * is supplied by the facilitator (fetched via `/supported`), so the server holds
 * no signing key.
 *
 * BSC testnet has no SDK default asset, so this example declares USDC explicitly.
 * It is a **Permit2** token → the client deposits via Permit2 (needs a one-time
 * `approve(Permit2)`). Note: batch deposits sign `ReceiveWithAuthorization`, so
 * an eip3009 token must implement `receiveWithAuthorization` (BSC's DHLU only
 * has `transferWithAuthorization`, so it can't be used here).
 */
import {
  BatchSettlementEvmScheme,
  type BatchSettlementChannelManager,
} from "@bankofai/x402-evm/batch-settlement/server";
import type { FacilitatorClient } from "@bankofai/x402-core/server";
import type { Network } from "@bankofai/x402-core/types";
import type { x402ResourceServer } from "@bankofai/x402-express";

type EvmToken = {
  asset: `0x${string}`;
  amount: string;
  extra: { assetTransferMethod: "permit2" };
};

/** CAIP-2 network → explicit token used for batch settlement. */
const EVM_TOKENS: Record<string, EvmToken> = {
  "eip155:97": {
    asset: "0x64544969ed7EBf5f083679233325356EbE738930",
    amount: "1000000000000000", // 0.001 × 1e18
    extra: { assetTransferMethod: "permit2" },
  },
};

const EVM_NETWORKS = Object.keys(EVM_TOKENS) as Network[];

/** Minimal shape we rely on for graceful shutdown. */
export type StoppableManager = { stop(opts?: { flush?: boolean }): Promise<void> };

/** EVM is enabled when a payout address is configured. */
export function hasEvm(): boolean {
  return !!process.env.EVM_ADDRESS;
}

/**
 * Registers the EVM `batch-settlement` server scheme for every configured
 * network and starts a channel manager per network.
 *
 * @param resourceServer - The resource server to register on.
 * @param facilitator - Facilitator client the channel manager submits claims/settles through.
 * @returns The started channel managers (for graceful shutdown).
 */
export function registerEvm(
  resourceServer: x402ResourceServer,
  facilitator: FacilitatorClient,
): StoppableManager[] {
  const payTo = process.env.EVM_ADDRESS as `0x${string}`;
  const managers: StoppableManager[] = [];

  for (const network of EVM_NETWORKS) {
    const token = EVM_TOKENS[network]!;
    const scheme = new BatchSettlementEvmScheme(payTo);
    resourceServer.register(network, scheme);

    const manager = scheme.createChannelManager(facilitator, network, token.asset);
    startManager(manager, network, payTo);
    managers.push(manager);
    console.info(`[evm] server registered ${network} batch-settlement (payTo ${payTo})`);
  }
  return managers;
}

/**
 * Builds the `accepts` entries advertised for EVM batch payments — one per
 * network, using the example's explicit BSC testnet USDC configuration.
 *
 * @returns Payment-requirements accept entries.
 */
export function evmAccepts() {
  const payTo = process.env.EVM_ADDRESS as string;
  return EVM_NETWORKS.map(network => ({
    scheme: "batch-settlement",
    network,
    payTo,
    price: EVM_TOKENS[network]!,
  }));
}

/**
 * Starts the periodic claim/settle/refund loop with example-friendly intervals.
 *
 * @param manager - The channel manager to start.
 * @param network - CAIP-2 network (for log context).
 * @param payTo - Receiver address (for log context).
 */
function startManager(
  manager: BatchSettlementChannelManager,
  network: string,
  payTo: string,
): void {
  manager.start({
    claimIntervalSecs: 60,
    settleIntervalSecs: 120,
    refundIntervalSecs: 180,
    maxClaimsPerBatch: 100,
    selectRefundChannels: (channels, context) =>
      channels.filter(channel => {
        if (BigInt(channel.balance) === 0n) return false;
        if (channel.pendingRequest && channel.pendingRequest.expiresAt > context.now) return false;
        // Refund channels idle for 3+ minutes.
        return context.now - channel.lastRequestTimestamp >= 180_000;
      }),
    onClaim: r => console.log(`[evm:${network}] claimed ${r.vouchers} vouchers (tx ${r.transaction})`),
    onSettle: r => console.log(`[evm:${network}] settled to ${payTo} (tx ${r.transaction})`),
    onRefund: r => console.log(`[evm:${network}] refunded channel ${r.channel} (tx ${r.transaction})`),
    onError: e => console.error(`[evm:${network}] settlement error:`, e),
  });
}

import type { FacilitatorWallet } from "@bankofai/x402-core/wallets";
import { buildTronWeb } from "../rpc";
import { createFacilitatorTronSigner } from "../signer";
import { createStaticTrc20ResourceSponsoringPolicy } from "./policy";
import { createTrc20ApprovalResourceSponsoringRuntime } from "./runtime";
import { createTronWebResourceSponsoringChain } from "./tronWebChain";
import type {
  ManagedTrc20ApprovalResourceSponsoringRuntime,
  Trc20ResourceSponsoringRuntimeOptions,
  Trc20SponsoringCoordinator,
} from "./types";
import type { TronResourceOwnerSigner } from "./tronWebChain";

/** High-level configuration for one network's resource-sponsoring runtime. */
export interface CreateTrc20ResourceSponsoringRuntimeOptions {
  readonly network: string;
  readonly resourceOwnerSigner: TronResourceOwnerSigner;
  readonly coordinator: Trc20SponsoringCoordinator;
  readonly allowedAssets: readonly string[];
  readonly rpcUrl?: string;
  readonly apiKey?: string;
  readonly permissionId: number;
  readonly maxReplacementCost?: bigint;
  readonly energySafetyBps?: bigint;
  readonly bandwidthSafetyBps?: bigint;
  readonly maxEnergyPerApproval?: bigint;
  readonly maxBandwidthPerApproval?: bigint;
  readonly managementBandwidthPerAction?: bigint;
  readonly recoveryWindowMs?: number;
  readonly minimumApprovalBroadcastWindowMs?: number;
  readonly confirmationMode?: "packed" | "solidified";
  readonly confirmationTimeoutMs?: number;
  readonly confirmationPollIntervalMs?: number;
}

/**
 * Builds a complete single-network runtime from a Resource Owner wallet.
 *
 * @param options - Network, wallet, durable coordinator, allowlist, and policy bounds.
 * @returns A runtime ready for `createTrc20ApprovalResourceSponsoringExtension`.
 */
export async function createTrc20ResourceSponsoringRuntime(
  options: CreateTrc20ResourceSponsoringRuntimeOptions,
): Promise<ManagedTrc20ApprovalResourceSponsoringRuntime> {
  const tronWeb = buildTronWeb(options.network, {
    rpcUrl: options.rpcUrl,
    apiKey: options.apiKey,
  });
  const readOnlyWallet: FacilitatorWallet = {
    getAddress: () => options.resourceOwnerSigner.getAddress(),
    signTransaction: async () => {
      throw new Error("Resource Owner signer only authorizes resource intents");
    },
  };
  const signer = await createFacilitatorTronSigner(readOnlyWallet, {
    network: options.network,
    rpcUrl: options.rpcUrl,
    apiKey: options.apiKey,
    permissionId: options.permissionId,
  });
  const chain = await createTronWebResourceSponsoringChain({
    tronWeb,
    network: options.network,
    resourceOwnerSigner: options.resourceOwnerSigner,
    readContract: signer.readContract,
    allowedAssets: options.allowedAssets,
    permissionId: options.permissionId,
    recoveryWindowMs: options.recoveryWindowMs,
    minimumApprovalBroadcastWindowMs: options.minimumApprovalBroadcastWindowMs,
    confirmationMode: options.confirmationMode,
    confirmationTimeoutMs: options.confirmationTimeoutMs,
    confirmationPollIntervalMs: options.confirmationPollIntervalMs,
  });
  const policy = createStaticTrc20ResourceSponsoringPolicy({
    allowedNetworks: [options.network],
    allowedAssets: { [options.network]: options.allowedAssets },
    maxReplacementCost: options.maxReplacementCost,
  });
  const runtimeOptions: Trc20ResourceSponsoringRuntimeOptions = {
    chain,
    coordinator: options.coordinator,
    policy,
    energySafetyBps: options.energySafetyBps,
    bandwidthSafetyBps: options.bandwidthSafetyBps,
    maxEnergyPerApproval: options.maxEnergyPerApproval,
    maxBandwidthPerApproval: options.maxBandwidthPerApproval,
    managementBandwidthPerAction: options.managementBandwidthPerAction,
  };
  return createTrc20ApprovalResourceSponsoringRuntime(runtimeOptions);
}

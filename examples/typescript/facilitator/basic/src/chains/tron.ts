/**
 * TRON chain setup for the facilitator. Mirrors the EVM module: key custody is
 * in `@bankofai/agent-wallet`, and `createFacilitatorTronSigner` sets the
 * issuer address from the wallet (the TronWeb instance carries no private key).
 */
import {
  createFacilitatorTronSigner,
  createTrc20ResourceSponsoringRuntime,
  InMemoryTrc20SponsoringCoordinator,
  TRON_NILE,
  TRON_MAINNET,
  TRON_SHASTA,
} from "@bankofai/x402-tron";
import { ExactTronScheme } from "@bankofai/x402-tron/exact/facilitator";
import { createTrc20ApprovalResourceSponsoringExtension } from "@bankofai/x402-extensions";
import type { x402Facilitator } from "@bankofai/x402-core/facilitator";

import { tryResolveWallet } from "../env.js";

/** TRON testnets + mainnet. */
export const TRON_NETWORKS = [TRON_NILE, TRON_SHASTA, TRON_MAINNET] as const;

/**
 * Registers the TRON `exact` scheme on the facilitator, if a TRON wallet is
 * configured in agent-wallet.
 *
 * @param facilitator - The facilitator to register the scheme on.
 * @returns `true` if registered, `false` if no TRON wallet was configured.
 */
export async function registerTron(
  facilitator: x402Facilitator,
): Promise<boolean> {
  const wallet = await tryResolveWallet("tron");
  if (!wallet) {
    return false;
  }

  // Key-less: the agent-wallet satisfies FacilitatorTronWallet directly; the
  // factory builds TronWeb internally and the wallet signs (no raw key in SDK).
  const address = await wallet.getAddress();
  const permissionId = Number.parseInt(
    process.env.TRON_PERMISSION_ID || "0",
    10,
  );
  const rpcUrl = process.env.TRON_NILE_RPC_URL?.trim() || undefined;
  for (const network of TRON_NETWORKS) {
    const signer = await createFacilitatorTronSigner(wallet, {
      network,
      apiKey: process.env.TRON_GRID_API_KEY,
      ...(network === TRON_NILE && rpcUrl ? { rpcUrl } : {}),
      ...(permissionId > 0 ? { permissionId } : {}),
    });
    facilitator.register(network, new ExactTronScheme(signer));
    console.info(`[tron] facilitator registered ${network} (${address})`);
  }

  if (process.env.TRON_APPROVAL_SPONSORING === "true") {
    const coordinator = new InMemoryTrc20SponsoringCoordinator({
      energyStakeSunCapacity: 2_000_000_000n,
      bandwidthStakeSunCapacity: 2_000_000_000n,
      budgetCapacity: 100_000_000n,
      managementBandwidthCapacity: 10_000n,
    });
    const runtime = await createTrc20ResourceSponsoringRuntime({
      network: TRON_NILE,
      resourceOwnerWallet: wallet,
      coordinator,
      allowedAssets: ["TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf"],
      confirmationMode: "packed",
      apiKey: process.env.TRON_GRID_API_KEY,
      ...(rpcUrl ? { rpcUrl } : {}),
      ...(permissionId > 0 ? { permissionId } : {}),
    });
    facilitator.registerExtension(
      createTrc20ApprovalResourceSponsoringExtension(runtime),
    );
    const recovery = setInterval(() => void runtime.reconcile(), 15_000);
    recovery.unref();
    console.info(
      `[tron] Nile Approval Resource Sponsoring enabled (${address})`,
    );
  }
  return true;
}

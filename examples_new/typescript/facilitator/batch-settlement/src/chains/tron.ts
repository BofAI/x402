/**
 * TRON chain setup for the batch-settlement facilitator. Mirrors the EVM module.
 *
 * `createFacilitatorTronSigner` sets the issuer address from the wallet and
 * builds/signs/broadcasts the on-chain `deposit` / `claimWithSignature` /
 * `settle` / `refund` txs (the TronWeb instance carries no private key). The same
 * agent-wallet doubles as the receiver-authorizer (`authorizerSigner`), whose
 * address is published via `/supported` as `receiverAuthorizer`.
 *
 * TIP-712 requires EVM-hex addresses inside the typed data, but the SDK
 * normalizes that internally — here we only forward the wallet's signature.
 */
import { createAuthorizerTronSigner, createFacilitatorTronSigner } from "@bankofai/x402-tron";
import { BatchSettlementTronScheme } from "@bankofai/x402-tron/batch-settlement/facilitator";
import type { x402Facilitator } from "@bankofai/x402-core/facilitator";

import { tryResolveWallet } from "../env.js";

/** CAIP-2 network this facilitator settles on. */
export const TRON_NETWORK = "tron:nile";

/**
 * Registers the TRON `batch-settlement` scheme on the facilitator, if a TRON
 * wallet is configured in agent-wallet.
 *
 * @param facilitator - The facilitator to register the scheme on.
 * @returns `true` if registered, `false` if no TRON wallet was configured.
 */
export async function registerTron(facilitator: x402Facilitator): Promise<boolean> {
  const wallet = await tryResolveWallet("tron");
  if (!wallet) {
    return false;
  }

  // One agent-wallet plays both facilitator roles: submitter (builds/signs/
  // broadcasts the on-chain txs) and receiver-authorizer (signs ClaimBatch/Refund
  // TIP-712 digests). In production these may be separate keys.
  const signer = await createFacilitatorTronSigner(wallet, {
    network: TRON_NETWORK,
    apiKey: process.env.TRON_GRID_API_KEY,
  });
  const authorizerSigner = await createAuthorizerTronSigner(wallet);

  facilitator.register(
    TRON_NETWORK,
    new BatchSettlementTronScheme(signer, authorizerSigner),
  );
  console.info(
    `[tron] facilitator registered ${TRON_NETWORK} batch-settlement (${authorizerSigner.address})`,
  );
  return true;
}

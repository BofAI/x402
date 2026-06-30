/**
 * EVM chain setup for the batch-settlement facilitator.
 *
 * The facilitator plays two roles here:
 *   1. **submitter** — `createFacilitatorEvmSigner` builds/signs/broadcasts the
 *      on-chain `deposit` / `claimWithSignature` / `settle` / `refund` txs (key
 *      custody stays in `@bankofai/agent-wallet`; the viem public client is
 *      key-less, reads/broadcast only).
 *   2. **receiver-authorizer** — the `authorizerSigner` produces the EIP-712
 *      signatures that authorize batched claims and refunds. We reuse the same
 *      agent-wallet for it (its address is published via `/supported` as
 *      `receiverAuthorizer`, which the server embeds into every channel config).
 *
 * The batch-settlement contract is a deterministic CREATE2 singleton at the same
 * address on every EVM chain, so adding a chain is one `EVM_NETWORKS` entry.
 */
import {
  createAuthorizerEvmSigner,
  createFacilitatorEvmSigner,
} from "@bankofai/x402-evm/adapters/agent-wallet";
import { BatchSettlementEvmScheme } from "@bankofai/x402-evm/batch-settlement/facilitator";
import type { x402Facilitator } from "@bankofai/x402-core/facilitator";

import { tryResolveWallet } from "../env.js";

/** CAIP-2 networks to settle batches on. Add an id here (e.g. "eip155:8453"). */
const EVM_NETWORKS = ["eip155:97"] as const;

/**
 * Registers the EVM `batch-settlement` scheme on the facilitator for every
 * configured network, if an EVM wallet is configured in agent-wallet.
 *
 * @param facilitator - The facilitator to register the scheme on.
 * @returns `true` if at least one network registered, `false` if no EVM wallet.
 */
export async function registerEvm(facilitator: x402Facilitator): Promise<boolean> {
  const wallet = await tryResolveWallet("evm");
  if (!wallet) {
    return false;
  }

  // One agent-wallet plays both facilitator roles: submitter (broadcasts the
  // on-chain txs, built per-network below) and receiver-authorizer (signs the
  // ClaimBatch/Refund digests). In production these may be separate keys.
  const authorizerSigner = await createAuthorizerEvmSigner(wallet);

  for (const network of EVM_NETWORKS) {
    const signer = await createFacilitatorEvmSigner(wallet, { network });
    facilitator.register(network, new BatchSettlementEvmScheme(signer, authorizerSigner));
    console.info(
      `[evm] facilitator registered ${network} batch-settlement (${authorizerSigner.address})`,
    );
  }
  return true;
}

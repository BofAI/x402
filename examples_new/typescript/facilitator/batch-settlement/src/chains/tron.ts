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
import { TronWeb } from "tronweb";
import { createFacilitatorTronSigner } from "@bankofai/x402-tron";
import { registerBatchSettlementTronFacilitatorScheme } from "@bankofai/x402-tron/batch-settlement/facilitator";
import type { x402Facilitator } from "@bankofai/x402-core/facilitator";

import { tryResolveWallet } from "../env.js";

/** CAIP-2 network this facilitator settles on. */
export const TRON_NETWORK = "tron:nile";
const NILE_RPC = "https://nile.trongrid.io";

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

  const tronWeb = new TronWeb({
    fullHost: NILE_RPC,
    ...(process.env.TRON_GRID_API_KEY
      ? { headers: { "TRON-PRO-API-KEY": process.env.TRON_GRID_API_KEY } }
      : {}),
  });

  const address = await wallet.getAddress();
  const facWallet = {
    address,
    signTransaction: (tx: Record<string, unknown>) => wallet.signTransaction(tx),
  };
  const signer = createFacilitatorTronSigner(tronWeb, facWallet);

  // Receiver-authorizer: signs claim/refund TIP-712 digests. agent-wallet strips
  // the `0x` prefix on TRON, so re-add it.
  const authorizerSigner = {
    address,
    signTypedData: async (args: {
      domain: Record<string, unknown>;
      types: Record<string, Array<{ name: string; type: string }>>;
      primaryType: string;
      message: Record<string, unknown>;
    }): Promise<`0x${string}`> => {
      const sig = await wallet.signTypedData(args);
      return (sig.startsWith("0x") ? sig : `0x${sig}`) as `0x${string}`;
    },
  };

  registerBatchSettlementTronFacilitatorScheme(facilitator, {
    signer,
    authorizerSigner,
    networks: TRON_NETWORK,
  });
  console.info(`[tron] facilitator registered ${TRON_NETWORK} batch-settlement (${address})`);
  return true;
}

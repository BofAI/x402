/**
 * TRON chain setup for the facilitator. Mirrors the EVM module: key custody is
 * in `@bankofai/agent-wallet`, and `createFacilitatorTronSigner` sets the
 * issuer address from the wallet (the TronWeb instance carries no private key).
 */
import { TronWeb } from "tronweb";
import { createFacilitatorTronSigner } from "@bankofai/x402-tron";
import { ExactTronScheme } from "@bankofai/x402-tron/exact/facilitator";
import { UptoTronScheme } from "@bankofai/x402-tron/upto/facilitator";
import { BatchSettlementTronFacilitatorScheme } from "@bankofai/x402-tron/batch-settlement/facilitator";
import type { x402Facilitator } from "@bankofai/x402-core/facilitator";

import { tryResolveWallet } from "../env.js";

/** CAIP-2 network this facilitator settles on. */
export const TRON_NETWORK = "tron:nile";
const NILE_RPC = "https://nile.trongrid.io";

/**
 * Registers the TRON schemes on the facilitator, if a TRON wallet is configured
 * in agent-wallet.
 *
 * @param facilitator - The facilitator to register the scheme on.
 * @returns `true` if registered, `false` if no TRON wallet was configured.
 */
export async function registerTron(facilitator: x402Facilitator): Promise<boolean> {
  const wallet = await tryResolveWallet("tron");
  if (!wallet) {
    return false;
  }

  // No private key on TronWeb — createFacilitatorTronSigner sets the issuer
  // address from the wallet, and the wallet signs.
  const tronWeb = new TronWeb({
    fullHost: NILE_RPC,
    ...(process.env.TRON_GRID_API_KEY
      ? { headers: { "TRON-PRO-API-KEY": process.env.TRON_GRID_API_KEY } }
      : {}),
  });

  const facWallet = {
    address: await wallet.getAddress(),
    signTransaction: (tx: Record<string, unknown>) => {
      const rawTransactionKey =
        process.env.TRON_FACILITATOR_PRIVATE_KEY ?? process.env.FACILITATOR_PRIVATE_KEY;
      return rawTransactionKey
        ? (tronWeb.trx.sign(tx as never, rawTransactionKey.replace(/^0x/, "")) as Promise<
            Record<string, unknown>
          >)
        : wallet.signTransaction(tx);
    },
  };

  const signer = createFacilitatorTronSigner(tronWeb, facWallet);
  const authorizerSigner = {
    address: facWallet.address,
    async signTypedData(args: {
      domain: Record<string, unknown>;
      types: Record<string, Array<{ name: string; type: string }>>;
      primaryType: string;
      message: Record<string, unknown>;
    }): Promise<`0x${string}`> {
      const sig = await wallet.signTypedData({
        types: { EIP712Domain: [], ...args.types },
        domain: args.domain,
        primaryType: args.primaryType,
        message: args.message,
      });
      return `0x${sig.replace(/^0x/, "")}` as `0x${string}`;
    },
  };

  facilitator.register(TRON_NETWORK, new ExactTronScheme(signer));
  facilitator.register(TRON_NETWORK, new UptoTronScheme(signer));
  facilitator.register(
    TRON_NETWORK,
    new BatchSettlementTronFacilitatorScheme(signer, authorizerSigner),
  );
  console.info(
    `[tron] facilitator registered exact+upto+batch-settlement ${TRON_NETWORK} (${facWallet.address})`,
  );
  return true;
}

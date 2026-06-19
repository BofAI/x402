/**
 * TRON client setup. Mirrors the EVM module, but `createClientTronSigner` takes
 * the SDK's `AgentWallet` shape, so we adapt the raw agent-wallet here (resolve
 * address + normalize the `0x` prefix agent-wallet strips). The TronWeb instance
 * carries no private key — it supplies contract reads and broadcasts the
 * one-time Permit2 `approve`.
 *
 * We also wire `signTransaction`, which lets the signer auto-broadcast the
 * one-time `approve(Permit2)` that USDT/USDD (no ERC-3009) need before their
 * first payment — parity with the Python client.
 *
 * (EVM's `createClientEvmSigner` accepts a raw wallet directly; TRON could grow
 * the same convenience — tracked as a follow-up symmetry item.)
 */
import { TronWeb } from "tronweb";
import { createClientTronSigner } from "@bankofai/x402-tron";
import { ExactTronScheme } from "@bankofai/x402-tron/exact/client";
import type { x402Client } from "@bankofai/x402-fetch";

import { tryResolveWallet } from "../env.js";

const NILE_RPC = "https://nile.trongrid.io";

/**
 * Registers the TRON `exact` client scheme, if a TRON wallet is configured.
 *
 * @param client - The x402 client to register the scheme on.
 * @returns `true` if registered, `false` if no TRON wallet was configured.
 */
export async function registerTron(client: x402Client): Promise<boolean> {
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

  const agentWallet = {
    getAddress: () => wallet.getAddress(),
    async signTypedData(args: {
      domain: Record<string, unknown>;
      types: Record<string, unknown>;
      primaryType: string;
      message: Record<string, unknown>;
    }): Promise<`0x${string}`> {
      const sig = await wallet.signTypedData(args);
      return `0x${sig.replace(/^0x/, "")}` as `0x${string}`;
    },
    // Enables the signer to broadcast the one-time Permit2 approve (USDT/USDD).
    signTransaction: (tx: Record<string, unknown>) => wallet.signTransaction(tx),
  };

  const signer = await createClientTronSigner(tronWeb, agentWallet);
  const scheme = new ExactTronScheme(signer);
  client.register("tron:*", scheme);

  // Balance guard — parity with the demo's `SufficientBalancePolicy`: don't
  // attempt a payment the payer can't cover (amount + fee), surfacing a clear
  // error instead of a confusing on-chain settle failure. The new SDK's payment
  // selection is synchronous, so balance (an async on-chain read) runs here as a
  // `beforePaymentCreation` hook. Note: this guards the *chosen* requirement
  // (the single-token main line), it does not re-select among alternatives the
  // way the demo's list-filtering policy did.
  client.onBeforePaymentCreation(async ({ selectedRequirements: req }) => {
    if (!req.network.startsWith("tron:")) {
      return;
    }
    const fee = BigInt((req.extra?.fee as { feeAmount?: string } | undefined)?.feeAmount ?? "0");
    const needed = BigInt(req.amount) + fee;
    const balance = await scheme.checkBalance(req.asset, req.network);
    if (balance < needed) {
      return {
        abort: true,
        reason: `insufficient balance for ${req.asset} on ${req.network}: have ${balance}, need ${needed}`,
      };
    }
  });

  console.info(`[tron] client registered tron:* (${signer.address})`);
  return true;
}

/**
 * EVM setup for the upto resource server.
 *
 * Key-less: registers the `upto` server scheme and advertises `accepts` (the
 * authorization ceiling + payTo). The actual charge is decided per request in
 * `index.ts` via a `Settlement-Overrides` response header — the scheme/facilitator
 * settle only that amount (<= the advertised price).
 *
 * BSC testnet has no SDK default asset, so this example converts its configured
 * maximum to an explicit USDC amount. USDC is a **Permit2** token → the client
 * authorizes via Permit2 (needs a one-time `approve(Permit2)`).
 */
import { UptoEvmScheme } from "@bankofai/x402-evm/upto/server";
import type { Network } from "@bankofai/x402-core/types";
import { convertToTokenAmount, parseMoney } from "@bankofai/x402-core/utils";
import type { x402ResourceServer } from "@bankofai/x402-express";

/** CAIP-2 network → explicit token used for upto authorizations. */
const EVM_TOKENS: Record<string, { asset: `0x${string}`; decimals: number }> = {
  "eip155:97": {
    asset: "0x64544969ed7EBf5f083679233325356EbE738930",
    decimals: 18,
  },
};

const EVM_NETWORKS = Object.keys(EVM_TOKENS) as Network[];

/** EVM is enabled when a payout address is configured. */
export function hasEvm(): boolean {
  return !!process.env.EVM_ADDRESS;
}

/**
 * Registers the EVM `upto` server scheme for every configured network.
 *
 * @param resourceServer - The resource server to register on.
 */
export function registerEvm(resourceServer: x402ResourceServer): void {
  const payTo = process.env.EVM_ADDRESS as string;
  for (const network of EVM_NETWORKS) {
    resourceServer.register(network, new UptoEvmScheme());
    console.info(`[evm] server registered ${network} upto (payTo ${payTo})`);
  }
}

/**
 * Builds the `accepts` entries advertised for EVM upto payments — one per
 * network, priced at the authorization ceiling in `"$"` form.
 *
 * @param price - The authorization ceiling (e.g. `"$0.10"`).
 * @returns Payment-requirements accept entries.
 */
export function evmAccepts(price: string) {
  const payTo = process.env.EVM_ADDRESS as string;
  const { amount, symbol } = parseMoney(price);
  if (symbol && symbol !== "USDC") {
    throw new Error(`BSC testnet upto example only supports USDC, not ${symbol}`);
  }
  return EVM_NETWORKS.map(network => {
    const token = EVM_TOKENS[network]!;
    return {
      scheme: "upto",
      network,
      payTo,
      price: {
        amount: convertToTokenAmount(amount, token.decimals),
        asset: token.asset,
        extra: { assetTransferMethod: "permit2" },
      },
    };
  });
}

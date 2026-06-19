/**
 * EVM setup for the resource server. The server holds no key — it registers the
 * `exact` server scheme per network and declares `accepts` (price + payTo) plus
 * the gas-sponsoring extension. Signing/settlement happens at client + facilitator.
 *
 * Tokens are configured per CAIP-2 network in `EVM_TOKENS`. Two approve paths:
 * - **ERC-3009** tokens (e.g. BSC DHLU) → `exact` eip3009: gasless, no approve.
 *   Advertise with the token's EIP-712 domain (`name`/`version`).
 * - **plain BEP-20** (e.g. BSC USDC, no 2612/3009) → `exact` permit2, needs a
 *   one-time `approve(Permit2)`. Mark `extra.assetTransferMethod: "permit2"`; the
 *   gas-sponsoring extension lets the client sign that approve offline.
 *
 * BSC has no default-token registry entry, so tokens are advertised as explicit
 * `{ amount, asset, extra }` prices. Adding a chain (e.g. Base Sepolia) is one
 * table entry. Amounts are ≈ $0.001 per the token's decimals.
 */
import { ExactEvmScheme } from "@bankofai/x402-evm/exact/server";
import { declareErc20ApprovalGasSponsoringExtension } from "@bankofai/x402-extensions";
import type { Network } from "@bankofai/x402-core/types";
import type { x402ResourceServer } from "@bankofai/x402-express";

type EvmToken = { asset: string; amount: string; extra: Record<string, unknown> };

/** CAIP-2 network → tokens advertised on it (see specs/config.md for addresses). */
const EVM_TOKENS: Record<string, EvmToken[]> = {
  "eip155:97": [
    // DHLU (6 dec, ERC-3009) — eip3009, gasless. Domain verified on-chain.
    {
      asset: "0x375cADdd2cB68cE82e3D9B075D551067a7b4B816",
      amount: "1000", // 0.001 × 1e6
      extra: { name: "DA HULU", version: "1" },
    },
    // USDC (18 dec, plain BEP-20) — permit2 + gas-sponsored approve.
    {
      asset: "0x64544969ed7EBf5f083679233325356EbE738930",
      amount: "1000000000000000", // 0.001 × 1e18
      extra: { assetTransferMethod: "permit2" },
    },
  ],
  // ── BSC mainnet (eip155:56) — REAL FUNDS ──────────────────────────────
  // All plain BEP-20 (no ERC-3009 / no EIP-2612, verified on-chain) → permit2 +
  // gas-sponsored approve. Amounts below are ≈ $0.001 (18 dec). Uncomment to enable.
  // "eip155:56": [
  //   { asset: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", amount: "1000000000000000", extra: { assetTransferMethod: "permit2" } }, // USDC (18)
  //   { asset: "0x55d398326f99059fF775485246999027B3197955", amount: "1000000000000000", extra: { assetTransferMethod: "permit2" } }, // USDT (18)
  //   { asset: "0xA7f552078dcC247C2684336020c03648500C6d9F", amount: "1000000000000000", extra: { assetTransferMethod: "permit2" } }, // EPS  (18)
  // ],
  // ── Other EVM testnet: Base Sepolia USDC (eip3009) ────────────────────
  // "eip155:84532": [ { asset: "0x036CbD…", amount: "1000", extra: { name: "USDC", version: "2" } } ],
};

/** EVM is enabled when a payout address is configured. */
export function hasEvm(): boolean {
  return !!process.env.EVM_ADDRESS;
}

/**
 * Registers the EVM `exact` server scheme for every configured network.
 *
 * @param resourceServer - The resource server to register on.
 */
export function registerEvm(resourceServer: x402ResourceServer): void {
  for (const network of Object.keys(EVM_TOKENS) as Network[]) {
    resourceServer.register(network, new ExactEvmScheme());
  }
}

/**
 * Builds the `accepts` entries advertised for EVM payments — one per token per
 * network, each an explicit asset.
 *
 * @returns Payment-requirements accept entries.
 */
export function evmAccepts() {
  const payTo = process.env.EVM_ADDRESS as string;
  return (Object.entries(EVM_TOKENS) as [Network, EvmToken[]][]).flatMap(([network, tokens]) =>
    tokens.map(token => ({
      scheme: "exact",
      network,
      payTo,
      price: { amount: token.amount, asset: token.asset, extra: token.extra },
    })),
  );
}

/**
 * Route extension that lets the facilitator broadcast the client's pre-signed
 * Permit2 `approve` (needed by plain-ERC20 tokens). Spread into the route's
 * `extensions`.
 *
 * @returns The extension declaration keyed by its extension id.
 */
export function evmExtensions(): Record<string, unknown> {
  return { ...declareErc20ApprovalGasSponsoringExtension() };
}

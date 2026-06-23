import { TronWeb } from "tronweb";
import { RawSecretSigner, type Wallet } from "@bankofai/agent-wallet";
import type { ClientTronWallet, FacilitatorTronWallet } from "../../src/signer";

/** CAIP-2 id and public RPC for the TRON Nile testnet. */
export const NILE = "tron:nile" as const;
export const NILE_RPC = "https://nile.trongrid.io";

/**
 * Nile e2e credentials/targets, read from the environment (loaded by vitest's
 * `loadEnv` from the package `.env`). Returns null when secrets are absent so
 * the suite can skip cleanly.
 */
export interface NileEnv {
  /** Payer (buyer) private key. */
  payerPk: string;
  /** Facilitator private key (pays energy for exact/permit2 settlement). */
  facilitatorPk: string;
  /** Payment recipient (Base58Check). */
  payTo: string;
  /** Optional TronGrid API key (raises rate limits). */
  apiKey?: string;
  /** Optional GasFree relayer base URL override. */
  gasfreeApiUrl?: string;
}

/**
 * Load Nile e2e credentials from the environment.
 *
 * @returns The env config, or null when payer/facilitator/payTo are missing.
 */
export function loadNileEnv(): NileEnv | null {
  const payerPk = process.env.PAYER_PRIVATE_KEY;
  const facilitatorPk = process.env.FACILITATOR_PRIVATE_KEY;
  const payTo = process.env.PAY_TO;
  if (!payerPk || !facilitatorPk || !payTo) {
    return null;
  }
  return {
    payerPk,
    facilitatorPk,
    payTo,
    apiKey: process.env.TRON_GRID_API_KEY,
    gasfreeApiUrl: process.env.GASFREE_API_URL,
  };
}

/**
 * Build a TronWeb instance pointed at Nile, with an optional TronGrid API key.
 *
 * @param privateKey - The key whose address becomes the default address.
 * @param apiKey - Optional TronGrid API key (sent as `TRON-PRO-API-KEY`).
 * @returns A configured TronWeb instance.
 */
export function nileTronWeb(privateKey: string, apiKey?: string): TronWeb {
  return new TronWeb({
    fullHost: NILE_RPC,
    privateKey: privateKey.replace(/^0x/, ""),
    ...(apiKey ? { headers: { "TRON-PRO-API-KEY": apiKey } } : {}),
  });
}

/**
 * Resolve a real `@bankofai/agent-wallet` wallet for TRON from a raw key
 * (the `RAW_SECRET` wallet type). Production resolves a keystore-backed wallet
 * via `resolveWalletProvider` instead; both expose the same Wallet interface.
 *
 * @param privateKey - The TRON private key.
 * @returns An agent-wallet Wallet.
 */
export function tronAgentWallet(privateKey: string): Wallet {
  return new RawSecretSigner(
    { source: "private_key", private_key: privateKey.replace(/^0x/, "") },
    "tron",
  );
}

/**
 * Adapt an agent-wallet {@link Wallet} to the SDK's client {@link AgentWallet}.
 * Builds the full TIP-712 JSON the wallet expects from our scheme's typed-data
 * fields.
 *
 * @param wallet - The agent-wallet wallet.
 * @returns A client AgentWallet.
 */
export function toClientAgentWallet(wallet: Wallet): ClientTronWallet {
  return {
    getAddress: () => wallet.getAddress(),
    async signTypedData(args) {
      const data = {
        types: { EIP712Domain: [], ...args.types },
        domain: args.domain,
        primaryType: args.primaryType,
        message: args.message,
      };
      const sig = await wallet.signTypedData(data);
      return (sig.startsWith("0x") ? sig : `0x${sig}`) as `0x${string}`;
    },
    // Enables the client signer to auto-broadcast the one-time Permit2 approve.
    signTransaction: transaction => wallet.signTransaction(transaction),
  };
}

/**
 * Adapt an agent-wallet {@link Wallet} to the SDK's {@link FacilitatorTronWallet}.
 *
 * @param wallet - The agent-wallet wallet.
 * @returns A facilitator wallet.
 */
export function toFacilitatorAgentWallet(wallet: Wallet): FacilitatorTronWallet {
  return {
    getAddress: () => wallet.getAddress(),
    signTransaction: transaction => wallet.signTransaction(transaction),
  };
}

/**
 * Coerce a contract read result (bigint, number, string, or BN-like) to bigint.
 *
 * @param value - The raw read result.
 * @returns The value as a bigint.
 */
export function toBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" || typeof value === "string") return BigInt(value);
  return BigInt((value as { toString(): string }).toString());
}

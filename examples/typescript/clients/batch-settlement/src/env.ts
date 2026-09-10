/**
 * Wallet resolution via `@bankofai/agent-wallet` — the example never touches a
 * private key. A chain registers only when a wallet for it resolves.
 */
import { resolveWallet, type Wallet } from "@bankofai/agent-wallet";

/**
 * A resolved agent-wallet that also signs typed data. `resolveWallet` is typed
 * as the base `Wallet` (no `signTypedData`), but for `evm`/`tron` it returns an
 * `EvmSigner`/`TronSigner` (both `Eip712Capable`), so we surface that here.
 */
export type SignerWallet = Wallet & {
  signTypedData(
    data: Record<string, unknown>,
    options?: unknown,
  ): Promise<string>;
};

/**
 * Resolves the agent-wallet for an exact CAIP-2 network, or `null` when that
 * network is unavailable. agent-wallet 3.x validates the requested network on
 * every operation.
 *
 * @param network - Exact canonical CAIP-2 network.
 * @returns The wallet, or `null` to skip that chain.
 */
export async function tryResolveWallet(
  network: string,
): Promise<SignerWallet | null> {
  try {
    const wallet = (await resolveWallet({ network })) as SignerWallet;
    await wallet.getAddress();
    return wallet;
  } catch {
    return null;
  }
}

/** Per-chain batch-settlement client options shared by the chain modules. */
export interface BatchClientOptions {
  /** Channel salt — different salts ⇒ different channels for the same payer/receiver/token. */
  salt: `0x${string}`;
  /** Deposit this many requests' worth of funds when (re)opening a channel. */
  depositMultiplier: number;
}

/** Minimal refund outcome shared by the EVM and TRON schemes. */
export interface RefundResult {
  success: boolean;
}

/** A registered scheme that can refund the channel for a URL. */
export interface RefundableScheme {
  label: string;
  refund(url: string, options?: { amount?: string }): Promise<RefundResult>;
}

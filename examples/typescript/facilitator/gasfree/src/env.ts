/**
 * Wallet resolution via `@bankofai/agent-wallet` — the example never touches a
 * private key. The facilitator registers TRON only when a TRON wallet resolves.
 */
import { TRON_NILE, TRON_MAINNET } from "@bankofai/x402-tron";
import { resolveWallet, type Wallet } from "@bankofai/agent-wallet";

/**
 * A resolved agent-wallet that also signs typed data. `resolveWallet` is typed
 * as the base `Wallet`, but for `tron` it returns a `TronSigner`, so we surface
 * the `signTypedData` capability here.
 */
export type SignerWallet = Wallet & {
  signTypedData(
    data: Record<string, unknown>,
    options?: unknown,
  ): Promise<string>;
};

/**
 * Resolves the TRON agent-wallet, or `null` when none is configured.
 *
 * @returns The wallet, or `null` to skip TRON.
 */
export async function tryResolveTronWallet(): Promise<SignerWallet | null> {
  try {
    return (await resolveWallet({ network: TRON_NILE })) as SignerWallet;
  } catch {
    return null;
  }
}

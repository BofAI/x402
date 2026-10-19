/**
 * Wallet resolution via `@bankofai/agent-wallet` — the example never touches a
 * private key. The TRON scheme registers only when a TRON wallet resolves.
 */
import {
  resolveWallet,
  WalletNotFoundError,
  type Wallet,
} from "@bankofai/agent-wallet";

/**
 * A resolved agent-wallet that also signs typed data. `resolveWallet` is typed
 * as the base `Wallet` (no `signTypedData`), but for `tron` it returns a
 * `TronSigner` (`Eip712Capable`), so we surface that here.
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
 * @param network - Exact canonical CAIP-2 network.
 * @returns The wallet, or `null` to skip TRON.
 */
export async function tryResolveTronWallet(
  network: string,
): Promise<SignerWallet | null> {
  try {
    return (await resolveWallet({ network })) as SignerWallet;
  } catch (error) {
    if (
      error instanceof WalletNotFoundError ||
      (error instanceof Error &&
        error.message ===
          "resolve_wallet could not find a wallet source in config or env")
    ) {
      return null;
    }
    throw error;
  }
}

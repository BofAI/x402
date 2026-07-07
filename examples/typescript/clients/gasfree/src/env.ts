/**
 * Wallet resolution via `@bankofai/agent-wallet` — the example never touches a
 * private key. The TRON scheme registers only when a TRON wallet resolves.
 */
import { resolveWallet, type Wallet } from "@bankofai/agent-wallet";

/**
 * A resolved agent-wallet that also signs typed data. `resolveWallet` is typed
 * as the base `Wallet` (no `signTypedData`), but for `tron` it returns a
 * `TronSigner` (`Eip712Capable`), so we surface that here.
 */
export type SignerWallet = Wallet & {
  signTypedData(data: Record<string, unknown>, options?: unknown): Promise<string>;
};

/**
 * Resolves the TRON agent-wallet, or `null` when none is configured.
 *
 * `@bankofai/agent-wallet` expects a **CAIP-2** network id. Key derivation is
 * chain-id-independent within a family, so any `tron:` id resolves the same
 * address; we use `tron:0xcd8690dc`.
 *
 * @returns The wallet, or `null` to skip TRON.
 */
export async function tryResolveTronWallet(): Promise<SignerWallet | null> {
  try {
    return (await resolveWallet({ network: "tron:0xcd8690dc" })) as SignerWallet;
  } catch {
    return null;
  }
}

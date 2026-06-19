/**
 * Wallet resolution via `@bankofai/agent-wallet` — the example never touches a
 * private key. The provider loads the secret out-of-band (env / keystore /
 * Privy) per agent-wallet's own configuration. A chain registers only when a
 * wallet for it resolves, so the facilitator can run EVM-only, TRON-only, or
 * both.
 */
import { resolveWallet, type Wallet } from "@bankofai/agent-wallet";

/**
 * A resolved agent-wallet that also signs typed data. `resolveWallet` is typed
 * as the base `Wallet` (no `signTypedData`), but for `evm`/`tron` it returns an
 * `EvmSigner`/`TronSigner` (both `Eip712Capable`), so we surface that here.
 */
export type SignerWallet = Wallet & {
  signTypedData(data: Record<string, unknown>, options?: unknown): Promise<string>;
};

/**
 * Resolves the agent-wallet for a network, or `null` when none is configured.
 *
 * @param network - `"evm"` or `"tron"`.
 * @returns The wallet, or `null` to skip that chain.
 */
export async function tryResolveWallet(network: "evm" | "tron"): Promise<SignerWallet | null> {
  try {
    return (await resolveWallet({ network })) as SignerWallet;
  } catch {
    return null;
  }
}

/**
 * Wallet resolution via `@bankofai/agent-wallet` — the example never touches a
 * private key. The provider loads the secret out-of-band (env / keystore /
 * Privy) per agent-wallet's own configuration. A chain registers only when a
 * wallet for it resolves, so the facilitator can run EVM-only, TRON-only, or
 * both.
 */
import { resolveWallet, type Wallet } from "@bankofai/agent-wallet";

/**
 * Resolves the agent-wallet for a network, or `null` when none is configured.
 *
 * @param network - `"evm"` or `"tron"`.
 * @returns The wallet, or `null` to skip that chain.
 */
export async function tryResolveWallet(network: "evm" | "tron"): Promise<Wallet | null> {
  try {
    return await resolveWallet({ network });
  } catch {
    return null;
  }
}

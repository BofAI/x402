/**
 * Wallet resolution via `@bankofai/agent-wallet` — the example never touches a
 * private key. A chain registers only when a wallet for it resolves, so the
 * facilitator can run EVM-only, TRON-only, or both.
 */
import { resolveWallet, type Wallet } from "@bankofai/agent-wallet";

/**
 * A resolved agent-wallet. `resolveWallet` is typed as the base `Wallet`, but for
 * `evm`/`tron` it returns an `EvmSigner`/`TronSigner` whose methods the chain
 * modules adapt into the facilitator signer (build + sign + broadcast settle txs).
 */
export type SignerWallet = Wallet;

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
    const wallet = await resolveWallet({ network });
    await wallet.getAddress();
    return wallet;
  } catch {
    return null;
  }
}

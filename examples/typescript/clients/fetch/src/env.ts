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
 * every operation, so callers must not reuse a wallet resolved for another
 * network in the same family.
 */
/**
 * Resolves the agent-wallet for a CAIP-2 network.
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

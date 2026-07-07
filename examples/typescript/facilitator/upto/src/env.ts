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
 * `@bankofai/agent-wallet` expects a **CAIP-2** network id (must start with
 * `eip155:` or `tron:`). Map the short family name to a representative id — key
 * derivation is chain-id-independent within a family.
 */
const CAIP2_BY_FAMILY: Record<"evm" | "tron", string> = {
  evm: "eip155:97",
  tron: "tron:0xcd8690dc",
};

/**
 * Resolves the agent-wallet for a chain family, or `null` when none is configured.
 *
 * @param family - `"evm"` or `"tron"`.
 * @returns The wallet, or `null` to skip that chain.
 */
export async function tryResolveWallet(family: "evm" | "tron"): Promise<SignerWallet | null> {
  try {
    return await resolveWallet({ network: CAIP2_BY_FAMILY[family] });
  } catch {
    return null;
  }
}

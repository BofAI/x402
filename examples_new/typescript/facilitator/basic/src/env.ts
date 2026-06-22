/**
 * Wallet resolution via `@bankofai/agent-wallet` — the example never touches a
 * private key. The provider loads the secret out-of-band (env / keystore /
 * Privy) per agent-wallet's own configuration. A chain registers only when a
 * wallet for it resolves, so the facilitator can run EVM-only, TRON-only, or
 * both.
 */
import { RawSecretSigner, resolveWallet, type Wallet } from "@bankofai/agent-wallet";

/**
 * A resolved agent-wallet that also signs typed data. `resolveWallet` is typed
 * as the base `Wallet` (no `signTypedData`), but for `evm`/`tron` it returns an
 * `EvmSigner`/`TronSigner` (both `Eip712Capable`), so we surface that here.
 */
export type SignerWallet = Wallet & {
  signTypedData(data: Record<string, unknown>, options?: unknown): Promise<string>;
};

/**
 * `@bankofai/agent-wallet` expects a **CAIP-2** network id (must start with
 * `eip155:` or `tron:`). Map the short family name to a representative id — key
 * derivation is chain-id-independent within a family, so any id of the right
 * family resolves the same address.
 */
const CAIP2_BY_FAMILY: Record<"evm" | "tron", string> = {
  evm: "eip155:97",
  tron: "tron:nile",
};

const RAW_KEY_ENV_BY_FAMILY: Record<"evm" | "tron", string[]> = {
  evm: ["EVM_FACILITATOR_PRIVATE_KEY", "FACILITATOR_PRIVATE_KEY"],
  tron: ["TRON_FACILITATOR_PRIVATE_KEY", "FACILITATOR_PRIVATE_KEY"],
};

function rawSecretWallet(family: "evm" | "tron"): SignerWallet | null {
  const rawKey = RAW_KEY_ENV_BY_FAMILY[family].map(name => process.env[name]).find(Boolean);
  if (!rawKey) {
    return null;
  }
  return new RawSecretSigner(
    { source: "private_key", private_key: rawKey.replace(/^0x/, "") },
    CAIP2_BY_FAMILY[family],
  ) as SignerWallet;
}

/**
 * Resolves the agent-wallet for a chain family, or `null` when none is configured.
 *
 * @param family - `"evm"` or `"tron"`.
 * @returns The wallet, or `null` to skip that chain.
 */
export async function tryResolveWallet(family: "evm" | "tron"): Promise<SignerWallet | null> {
  const rawWallet = rawSecretWallet(family);
  if (rawWallet) {
    return rawWallet;
  }

  try {
    return (await resolveWallet({ network: CAIP2_BY_FAMILY[family] })) as SignerWallet;
  } catch {
    return null;
  }
}

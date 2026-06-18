/**
 * BankofAI overlay — NOT from upstream @x402/evm.
 *
 * Client-side wallet-bridge factory, symmetric to TRON's
 * `createClientTronSigner` and to this package's `createFacilitatorEvmSigner`.
 * Upstream ships only `toClientEvmSigner`, a composition helper that expects an
 * already-resolved `{ address, signTypedData }`; it does not adapt an
 * `@bankofai/agent-wallet` wallet (async `getAddress`, and a `signTypedData`
 * that strips the `0x` prefix). This factory closes that gap so client examples
 * stay a one-liner and never touch a raw key.
 *
 * Upgrade safety: consumes only upstream's public surface (`toClientEvmSigner` +
 * the `ClientEvmSigner` type); never edits `signer.ts` / `index.ts`.
 */
import { toClientEvmSigner, type ClientEvmSigner } from "../signer";

/**
 * A wallet that signs EIP-712 typed data without exposing its key — structurally
 * compatible with `@bankofai/agent-wallet`'s `EvmSigner`. `signTypedData` may
 * return the signature with or without the `0x` prefix (agent-wallet strips it);
 * the factory normalizes it.
 */
export interface ClientEvmWallet {
  getAddress(): Promise<string>;
  signTypedData(data: {
    domain: Record<string, unknown>;
    types: Record<string, unknown>;
    primaryType: string;
    message: Record<string, unknown>;
  }): Promise<string>;
}

/** Minimal read surface for permit2 allowance enrichment (a viem client satisfies it). */
export interface ClientEvmReadClient {
  readContract(args: {
    address: `0x${string}`;
    abi: readonly unknown[];
    functionName: string;
    args?: readonly unknown[];
  }): Promise<unknown>;
}

/**
 * Creates a {@link ClientEvmSigner} from an agent-wallet — the EVM counterpart
 * of `createClientTronSigner`. The key never enters the SDK; the wallet signs.
 *
 * @param wallet - The wallet that signs payment authorizations.
 * @param publicClient - Optional viem client; enables EIP-2612/permit2
 *   enrichment via `readContract`. Omit for ERC-3009-only flows.
 * @returns A {@link ClientEvmSigner} backed by the wallet.
 *
 * @example
 * ```typescript
 * const wallet = await resolveWallet({ network: "evm" }); // @bankofai/agent-wallet
 * const signer = await createClientEvmSigner(wallet, publicClient);
 * new ExactEvmScheme(signer);
 * ```
 */
export async function createClientEvmSigner(
  wallet: ClientEvmWallet,
  publicClient?: ClientEvmReadClient,
): Promise<ClientEvmSigner> {
  const address = (await wallet.getAddress()) as `0x${string}`;

  return toClientEvmSigner(
    {
      address,
      // agent-wallet strips the `0x` (signature analog of SDK issue #2);
      // re-add it so the returned signature matches the ClientEvmSigner contract.
      signTypedData: async msg => {
        const sig = await wallet.signTypedData(msg);
        return `0x${sig.replace(/^0x/, "")}` as `0x${string}`;
      },
    },
    publicClient,
  );
}

/**
 * BankofAI overlay — NOT from upstream @x402/evm.
 *
 * Adds a wallet-bridge factory for facilitators, symmetric to TRON's
 * `createFacilitatorTronSigner`. Upstream only ships `toFacilitatorEvmSigner`,
 * which requires the integrator to hand-wire every on-chain op
 * (readContract / writeContract / sendTransaction / waitForTransactionReceipt /
 * getCode / verifyTypedData). This module builds all of that from a viem
 * public client + a key-custody wallet, so non-custodial signing is collected
 * in one place.
 *
 * Upgrade safety: this file ONLY consumes upstream's public surface
 * (`toFacilitatorEvmSigner` + the `FacilitatorEvmSigner` type). It never edits
 * `signer.ts` or `index.ts`, so pulling a newer upstream is conflict-free as
 * long as that public surface is unchanged. The agent-wallet dependency is kept
 * out via the structural {@link FacilitatorEvmWallet} interface — any object of
 * that shape works (agent-wallet's `EvmSigner`, a keystore, hardware, etc.).
 */
import { encodeFunctionData, type Abi, type Log, type PublicClient } from "viem";

import { toFacilitatorEvmSigner, type FacilitatorEvmSigner } from "../signer";

/**
 * A wallet that signs EIP-1559 settlement transactions without ever exposing
 * its private key to the SDK — structurally compatible with
 * `@bankofai/agent-wallet`'s `EvmSigner`, but intentionally not coupled to it.
 *
 * `signTransaction` returns a serialized signed transaction hex. The `0x`
 * prefix is optional: agent-wallet currently strips it (see SDK issue #2), so
 * the broadcast path normalizes defensively.
 */
export interface FacilitatorEvmWallet {
  /** Facilitator EVM address (0x-prefixed, checksummed or lowercase). */
  readonly address: `0x${string}`;
  /**
   * Sign a fully-specified EIP-1559 transaction and return the serialized
   * signed tx hex (with or without the `0x` prefix).
   */
  signTransaction(tx: {
    to: `0x${string}`;
    data: `0x${string}`;
    value: bigint;
    nonce: number;
    gas: bigint;
    maxFeePerGas: bigint;
    maxPriorityFeePerGas: bigint;
    chainId: number;
  }): Promise<string>;
}

/**
 * The viem public-client surface this factory needs. Defined as a `Pick` of
 * viem's `PublicClient` so a real client is assignable WITHOUT a cast — using a
 * hand-rolled structural interface with wider param types (e.g.
 * `verifyTypedData`'s `types: Record<string, unknown>`) would fail under
 * `strictFunctionTypes` and force every integrator to cast (see SDK issue #5).
 *
 * In tests, pass a mock via `as unknown as FacilitatorEvmPublicClient`.
 */
export type FacilitatorEvmPublicClient = Pick<
  PublicClient,
  | "getChainId"
  | "getTransactionCount"
  | "estimateFeesPerGas"
  | "estimateGas"
  | "sendRawTransaction"
  | "readContract"
  | "verifyTypedData"
  | "getCode"
  | "waitForTransactionReceipt"
>;

/**
 * Loose view of the public client for internal forwarding. viem's read/verify
 * methods are generic and strict, while upstream's `FacilitatorEvmSigner` shape
 * is loose; we narrow once here (the runtime client provides all these methods)
 * so the loose/strict impedance is resolved inside the SDK, not by integrators.
 */
type LooseEvmPublicClient = {
  getChainId(): Promise<number>;
  getTransactionCount(args: {
    address: `0x${string}`;
    blockTag?: "latest" | "pending";
  }): Promise<number>;
  estimateFeesPerGas(): Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }>;
  estimateGas(args: {
    account: `0x${string}`;
    to: `0x${string}`;
    data: `0x${string}`;
    value?: bigint;
  }): Promise<bigint>;
  sendRawTransaction(args: { serializedTransaction: `0x${string}` }): Promise<`0x${string}`>;
  readContract(args: {
    address: `0x${string}`;
    abi: readonly unknown[];
    functionName: string;
    args?: readonly unknown[];
  }): Promise<unknown>;
  verifyTypedData(args: {
    address: `0x${string}`;
    domain: Record<string, unknown>;
    types: Record<string, unknown>;
    primaryType: string;
    message: Record<string, unknown>;
    signature: `0x${string}`;
  }): Promise<boolean>;
  getCode(args: { address: `0x${string}` }): Promise<`0x${string}` | undefined>;
  waitForTransactionReceipt(args: {
    hash: `0x${string}`;
  }): Promise<{ status: string; logs?: readonly Log[] }>;
};

/** Options for {@link createFacilitatorEvmSigner}. */
export interface FacilitatorEvmSignerOptions {
  /**
   * Gas limit to use when a per-call `gas` is not supplied. When unset, gas is
   * estimated per transaction via `estimateGas`.
   */
  defaultGas?: bigint;
}

/**
 * One transaction for {@link GasSponsoringFacilitatorEvmSigner.sendTransactions}:
 * either a pre-signed serialized tx (broadcast as-is) or an unsigned call intent
 * (signed by the facilitator wallet, then broadcast). Mirrors the
 * `@bankofai/x402-extensions` `TransactionRequest` shape without importing it,
 * so this overlay stays dependency-free.
 */
export type EvmTransactionRequest =
  | `0x${string}`
  | { to: `0x${string}`; data: `0x${string}`; gas?: bigint };

/**
 * {@link FacilitatorEvmSigner} plus `sendTransactions` — the shape the ERC-20
 * approval gas-sponsoring extension expects (it broadcasts the client's
 * pre-signed `approve` bundled with `settle`).
 */
export type GasSponsoringFacilitatorEvmSigner = FacilitatorEvmSigner & {
  sendTransactions(transactions: readonly EvmTransactionRequest[]): Promise<`0x${string}`[]>;
};

/**
 * Appends an extension data suffix (e.g. a builder code) to encoded calldata.
 *
 * @param data - The encoded function calldata.
 * @param suffix - Optional `0x`-prefixed suffix to append.
 * @returns The calldata with the suffix appended, or `data` unchanged.
 */
function appendDataSuffix(data: `0x${string}`, suffix?: `0x${string}`): `0x${string}` {
  if (!suffix || suffix === "0x") {
    return data;
  }
  return `${data}${suffix.slice(2)}` as `0x${string}`;
}

/**
 * Creates a {@link FacilitatorEvmSigner} from a viem public client and a
 * key-custody wallet — the EVM counterpart of `createFacilitatorTronSigner`.
 *
 * The transaction is built (nonce / EIP-1559 fees / gas), handed to the wallet
 * to sign (the private key never enters the SDK), then broadcast — collecting
 * all on-chain ops so each integrator no longer re-implements them.
 *
 * @param publicClient - viem public client used for reads, verification, and broadcast.
 * @param wallet - The wallet that signs settlement transactions.
 * @param options - Optional default gas limit.
 * @returns A {@link FacilitatorEvmSigner} backed by the public client + wallet.
 *
 * @example
 * ```typescript
 * const publicClient = createPublicClient({ chain: base, transport: http() });
 * const signer = createFacilitatorEvmSigner(publicClient, agentWallet);
 * ```
 */
export function createFacilitatorEvmSigner(
  publicClient: FacilitatorEvmPublicClient,
  wallet: FacilitatorEvmWallet,
  options: FacilitatorEvmSignerOptions = {},
): GasSponsoringFacilitatorEvmSigner {
  // Narrow once: viem's strict generic methods → the loose shape we forward to
  // upstream's FacilitatorEvmSigner. Keeps the cast inside the SDK (issue #5).
  const client = publicClient as unknown as LooseEvmPublicClient;

  // Build → wallet-sign → broadcast. Shared by writeContract and sendTransaction.
  async function buildSignBroadcast(
    to: `0x${string}`,
    data: `0x${string}`,
    gasOverride?: bigint,
  ): Promise<`0x${string}`> {
    const value = 0n; // x402 settlement never transfers native value.
    const [chainId, nonce, fees] = await Promise.all([
      client.getChainId(),
      // "pending" (not the default "latest") counts the EOA's not-yet-mined txs,
      // so rapid sequential settlements from one facilitator key don't reuse a
      // nonce while the previous settle is still in the mempool.
      client.getTransactionCount({ address: wallet.address, blockTag: "pending" }),
      client.estimateFeesPerGas(),
    ]);
    const gas =
      gasOverride ??
      options.defaultGas ??
      (await client.estimateGas({ account: wallet.address, to, data, value }));

    const signed = await wallet.signTransaction({
      to,
      data,
      value,
      nonce,
      gas,
      maxFeePerGas: fees.maxFeePerGas,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      chainId,
    });

    // agent-wallet strips the `0x` prefix (SDK issue #2); strip-then-prefix is
    // robust whether or not the prefix is present, so it survives an upstream
    // fix that restores it. Carried over from the v1 facilitator signer.
    const serializedTransaction = `0x${signed.replace(/^0x/, "")}` as `0x${string}`;
    return client.sendRawTransaction({ serializedTransaction });
  }

  const base = toFacilitatorEvmSigner({
    address: wallet.address,
    readContract: args => client.readContract(args),
    verifyTypedData: args => client.verifyTypedData(args),
    getCode: args => client.getCode(args),
    waitForTransactionReceipt: args => client.waitForTransactionReceipt(args),
    writeContract: args => {
      const data = appendDataSuffix(
        encodeFunctionData({
          abi: args.abi as Abi,
          functionName: args.functionName,
          args: args.args,
        }),
        args.dataSuffix,
      );
      return buildSignBroadcast(args.address, data, args.gas);
    },
    sendTransaction: args => buildSignBroadcast(args.to, args.data),
  });

  // Batch broadcast for the ERC-20 approval gas-sponsoring extension: the
  // client's pre-signed `approve` (a serialized tx) is broadcast as-is; the
  // `settle` call intent is signed by the facilitator wallet and broadcast.
  // Executed sequentially; hashes returned in order (settle is last).
  return {
    ...base,
    async sendTransactions(transactions) {
      const hashes: `0x${string}`[] = [];
      for (const tx of transactions) {
        if (typeof tx === "string") {
          const serializedTransaction = `0x${tx.replace(/^0x/, "")}` as `0x${string}`;
          hashes.push(await client.sendRawTransaction({ serializedTransaction }));
        } else {
          hashes.push(await buildSignBroadcast(tx.to, tx.data, tx.gas));
        }
      }
      return hashes;
    },
  };
}

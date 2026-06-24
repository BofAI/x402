/**
 * Adaptation layer — BankofAI overlay, NOT from upstream @x402/evm.
 *
 * Bridges a non-custodial wallet (e.g. `@bankofai/agent-wallet`) to upstream's
 * signer contracts, for both roles. Each factory takes `(wallet, { network })`
 * and builds the viem client internally from the CAIP-2 network — callers no
 * longer construct a viem chain / public client themselves.
 *
 *   - {@link createClientEvmSigner}      → `ClientEvmSigner`
 *   - {@link createFacilitatorEvmSigner} → `FacilitatorEvmSigner`
 *
 * Wallet contracts come from `@bankofai/x402-core/wallets` (the chain-agnostic
 * {@link ClientWallet} / {@link FacilitatorWallet} hierarchy); EVM only refines
 * the facilitator transaction shape via {@link Eip1559TxFields}.
 *
 * Upgrade safety: consumes only upstream's public surface (`toClientEvmSigner` /
 * `toFacilitatorEvmSigner` + the signer types); never edits `signer.ts` /
 * `index.ts`. Wallet types are structural — no runtime coupling to agent-wallet.
 */
import { encodeFunctionData, type Abi, type Log } from "viem";

import type { ClientWallet, FacilitatorWallet } from "@bankofai/x402-core/wallets";

import {
  toClientEvmSigner,
  toFacilitatorEvmSigner,
  type ClientEvmSigner,
  type FacilitatorEvmSigner,
} from "../signer";
import { createEvmPublicClient } from "./chains";

// ────────────────────────────────────────────────────────────────────────────
// Client
// ────────────────────────────────────────────────────────────────────────────

/** EVM client wallet — the chain-agnostic {@link ClientWallet} (no EVM refinement). */
export type ClientEvmWallet = ClientWallet;

/** Options for {@link createClientEvmSigner}. */
export interface CreateClientEvmSignerOptions {
  /** CAIP-2 network, e.g. `"eip155:97"`. The viem client is built from it. */
  network: string;
  /** Optional RPC URL override; falls back to the chain's default. */
  rpcUrl?: string;
}

/**
 * Creates a {@link ClientEvmSigner} from a wallet — the EVM counterpart of
 * `createClientTronSigner`. The key never enters the SDK; the wallet signs. The
 * viem public client (for EIP-2612 / permit2 enrichment + the gas-sponsored
 * approve) is built internally from `opts.network`.
 *
 * @param wallet - The wallet that signs payment authorizations.
 * @param opts - Target network (+ optional RPC override).
 * @returns A {@link ClientEvmSigner} backed by the wallet.
 *
 * @example
 * ```typescript
 * const wallet = await resolveWallet({ network: "eip155:97" }); // @bankofai/agent-wallet
 * const signer = await createClientEvmSigner(wallet, { network: "eip155:97" });
 * client.register("eip155:97", new ExactEvmScheme(signer));
 * ```
 */
export async function createClientEvmSigner(
  wallet: ClientEvmWallet,
  opts: CreateClientEvmSignerOptions,
): Promise<ClientEvmSigner> {
  const address = (await wallet.getAddress()) as `0x${string}`;
  const publicClient = createEvmPublicClient(opts.network, opts.rpcUrl);

  // Bind to the wallet: agent-wallet's `LocalSigner.signTransaction` reads
  // `this._impl`, so a detached reference throws. (`signTypedData` below is
  // invoked as `wallet.signTypedData(...)`, so it stays bound.)
  const signTransaction = wallet.signTransaction?.bind(wallet);

  return toClientEvmSigner(
    {
      address,
      // agent-wallet strips the `0x` (signature analog of SDK issue #2); re-add it.
      signTypedData: async msg => {
        const sig = await wallet.signTypedData(msg);
        return `0x${sig.replace(/^0x/, "")}` as `0x${string}`;
      },
      // Enables the ERC-20 approval gas-sponsoring extension: the client signs
      // the `approve(Permit2, MaxUint256)` tx offline (facilitator broadcasts it).
      ...(signTransaction
        ? {
            signTransaction: async (args: Record<string, unknown>) => {
              const signed = await signTransaction(args);
              if (typeof signed !== "string") {
                throw new Error("EVM signTransaction must return a serialized hex string");
              }
              return `0x${signed.replace(/^0x/, "")}` as `0x${string}`;
            },
          }
        : {}),
    },
    publicClient,
  );
}

/**
 * A typed-data signer with an eagerly-resolved address. Structurally satisfies
 * the batch-settlement `AuthorizerSigner` (the receiver-authorizer key).
 */
export type EvmAuthorizerSigner = Pick<ClientEvmSigner, "address" | "signTypedData">;

/**
 * Creates an authorizer signer (address + typed-data signing) from a wallet —
 * e.g. the batch-settlement `receiverAuthorizer`, which signs `ClaimBatch` /
 * `Refund` EIP-712 digests. No chain client is built (signing is offline).
 *
 * @param wallet - The wallet that holds the authorizer key.
 * @returns A signer satisfying batch-settlement's `AuthorizerSigner`.
 */
export async function createAuthorizerEvmSigner(
  wallet: ClientWallet,
): Promise<EvmAuthorizerSigner> {
  const address = (await wallet.getAddress()) as `0x${string}`;
  return {
    address,
    // agent-wallet strips the `0x`; re-add it so the signature conforms.
    signTypedData: async msg => {
      const sig = await wallet.signTypedData(msg);
      return `0x${sig.replace(/^0x/, "")}` as `0x${string}`;
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Facilitator
// ────────────────────────────────────────────────────────────────────────────

/**
 * Typed EIP-1559 fields the facilitator wallet receives to sign a settlement tx.
 * A `type` (not `interface`) so it stays assignable to `Record<string, unknown>`
 * — the shape a generic agent-wallet `signTransaction` accepts.
 */
export type Eip1559TxFields = {
  to: `0x${string}`;
  data: `0x${string}`;
  value: bigint;
  nonce: number;
  gas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  chainId: number;
};

/** EVM facilitator wallet — {@link FacilitatorWallet} refined to EIP-1559 fields. */
export type FacilitatorEvmWallet = FacilitatorWallet<Eip1559TxFields>;

/**
 * Loose view of the viem public client for internal forwarding. viem's read/verify
 * methods are generic and strict, while upstream's `FacilitatorEvmSigner` shape is
 * loose; we narrow once here so the impedance is resolved inside the SDK.
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
    account?: `0x${string}`;
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
export interface CreateFacilitatorEvmSignerOptions {
  /** CAIP-2 network, e.g. `"eip155:97"`. The viem client is built from it. */
  network: string;
  /** Optional RPC URL override; falls back to the chain's default. */
  rpcUrl?: string;
  /** Gas limit when a per-call `gas` is not supplied; otherwise estimated. */
  defaultGas?: bigint;
}

/**
 * One transaction for {@link GasSponsoringFacilitatorEvmSigner.sendTransactions}:
 * a pre-signed serialized tx (broadcast as-is) or an unsigned call intent (signed
 * by the facilitator wallet, then broadcast).
 */
export type EvmTransactionRequest =
  | `0x${string}`
  | { to: `0x${string}`; data: `0x${string}`; gas?: bigint };

/**
 * {@link FacilitatorEvmSigner} plus `sendTransactions` — the shape the ERC-20
 * approval gas-sponsoring extension expects (broadcasts the client's pre-signed
 * `approve` bundled with `settle`).
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
 * Creates a {@link FacilitatorEvmSigner} from a wallet — the EVM counterpart of
 * `createFacilitatorTronSigner`. The viem public client (reads / verification /
 * broadcast) is built internally from `opts.network`. The transaction is built
 * (nonce / EIP-1559 fees / gas), handed to the wallet to sign (the private key
 * never enters the SDK), then broadcast.
 *
 * @param wallet - The wallet that signs settlement transactions.
 * @param opts - Target network (+ optional RPC override / default gas).
 * @returns A {@link GasSponsoringFacilitatorEvmSigner} backed by the wallet.
 *
 * @example
 * ```typescript
 * const signer = await createFacilitatorEvmSigner(agentWallet, { network: "eip155:97" });
 * facilitator.register("eip155:97", new ExactEvmScheme(signer));
 * ```
 */
export async function createFacilitatorEvmSigner(
  wallet: FacilitatorEvmWallet,
  opts: CreateFacilitatorEvmSignerOptions,
): Promise<GasSponsoringFacilitatorEvmSigner> {
  const address = (await wallet.getAddress()) as `0x${string}`;
  // Narrow once: viem's strict generic methods → the loose shape we forward to
  // upstream's FacilitatorEvmSigner. Keeps the cast inside the SDK.
  const client = createEvmPublicClient(
    opts.network,
    opts.rpcUrl,
  ) as unknown as LooseEvmPublicClient;

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
      client.getTransactionCount({ address, blockTag: "pending" }),
      client.estimateFeesPerGas(),
    ]);
    const gas =
      gasOverride ??
      opts.defaultGas ??
      (await client.estimateGas({ account: address, to, data, value }));

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
    if (typeof signed !== "string") {
      throw new Error("EVM facilitator signTransaction must return a serialized hex string");
    }
    // agent-wallet strips the `0x` prefix; strip-then-prefix is robust either way.
    const serializedTransaction = `0x${signed.replace(/^0x/, "")}` as `0x${string}`;
    return client.sendRawTransaction({ serializedTransaction });
  }

  const base = toFacilitatorEvmSigner({
    address,
    // Issue every read as the facilitator EOA (sets the eth_call `from`). View
    // calls ignore the caller, but caller-authorized simulations need it — the
    // upto proxy `settle` reverts with `UnauthorizedFacilitator` unless
    // `msg.sender` is the witness-bound facilitator (= this single-key wallet).
    // `...args` last so an explicit per-call `account` (if upstream ever adds one)
    // overrides this default.
    readContract: args => client.readContract({ account: address, ...args }),
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

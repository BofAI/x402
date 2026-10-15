import type { ClientWallet, FacilitatorWallet } from "./wallets";
import type { Trc20ApprovalPolicy } from "./approvalPolicy";

/** Allowance-ensuring strategy for {@link ClientTronSigner.ensureAllowance}. */
export type AllowanceMode = "auto" | "skip" | "interactive";

/**
 * Signer interface for TRON client operations.
 *
 * The client signer creates TIP-712 signatures for TransferWithAuthorization
 * or Permit2 PermitWitnessTransferFrom.
 * Addresses can be in TRON Base58Check or EVM hex format;
 * they are normalized to EVM hex for signing.
 */
export interface ClientTronSigner {
  /**
   * The TRON address (Base58Check format) or EVM hex address of the signer.
   */
  address: string;

  /** Exact CAIP-2 network served by this signer's RPC client, when network-bound. */
  readonly network?: string;

  /** Token-specific Approval update behavior shared by all Client paths. */
  readonly approvalPolicy?: Trc20ApprovalPolicy;

  /**
   * Sign EIP-712/TIP-712 typed data.
   * The domain and message addresses should already be in EVM hex format.
   */
  signTypedData(args: {
    domain: Record<string, unknown>;
    types: Record<string, ReadonlyArray<{ name: string; type: string }>>;
    primaryType: string;
    message: Record<string, unknown>;
  }): Promise<`0x${string}`>;

  /**
   * Read data from a smart contract.
   */
  readContract?(args: {
    address: string;
    abi: readonly Record<string, unknown>[];
    functionName: string;
    args: readonly unknown[];
  }): Promise<unknown>;

  /**
   * Ensure the token's Permit2 allowance covers `amount`, broadcasting a
   * one-time `approve(Permit2, MAX_UINT256)` if it does not (mirrors the Python
   * client's `ensure_allowance`). The user's wallet pays the approve's TRX.
   *
   * Always present on a signer created by {@link createClientTronSigner}. When
   * the backing wallet lacks {@link ClientTronWallet.signTransaction}, it throws
   * only if an approve is actually required — sign-only / pre-approved wallets
   * still work. The permit2 client flow calls this before signing; eip3009 payments
   * never invoke it. `mode` defaults to the signer's configured mode (`"auto"`):
   * `"skip"` returns immediately, `"interactive"` is not implemented.
   */
  ensureAllowance?(args: {
    token: string;
    amount: bigint;
    network: string;
    mode?: AllowanceMode;
  }): Promise<boolean>;

  /**
   * Build and sign, but do not broadcast, the canonical
   * `approve(Permit2, MaxUint256)` transaction used by
   * `trc20ApprovalResourceSponsoring`.
   *
   * The returned value is the complete signed TRON Transaction protobuf as
   * lowercase hexadecimal without a `0x` prefix.
   */
  signPermit2Approval?(args: {
    token: string;
    network: string;
    minimumLifetimeSeconds: number;
  }): Promise<string>;
}

/**
 * Wallet abstraction for TRON client signing — the chain-agnostic
 * {@link ClientWallet} from the TRON package (`getAddress` + `signTypedData` + optional
 * `signTransaction`). Decouples the client signer from how the wallet was created
 * (raw key, hosted/MDP, hardware, `@bankofai/agent-wallet`, …); any object of
 * that shape satisfies it. `signTransaction` (when present) lets
 * {@link ClientTronSigner.ensureAllowance} broadcast the one-time Permit2 approve.
 */
export type ClientTronWallet = ClientWallet;

/**
 * Signer interface for TRON facilitator operations.
 *
 * The facilitator signer verifies TIP-712 signatures and executes
 * on-chain contract calls for payment settlement.
 */
export interface FacilitatorTronSigner {
  /**
   * Get all facilitator addresses (for multi-address/load-balanced setups).
   */
  getAddresses(): readonly string[];

  /**
   * Read data from a smart contract.
   */
  readContract(args: {
    address: string;
    abi: readonly Record<string, unknown>[];
    functionName: string;
    args: readonly unknown[];
  }): Promise<unknown>;

  /**
   * Verify a TIP-712 typed data signature.
   * Returns true if the signature was made by the specified address.
   */
  verifyTypedData(args: {
    address: string;
    domain: Record<string, unknown>;
    types: Record<string, ReadonlyArray<{ name: string; type: string }>>;
    primaryType: string;
    message: Record<string, unknown>;
    signature: `0x${string}`;
  }): Promise<boolean>;

  /**
   * Execute a contract write call.
   */
  writeContract(args: {
    address: string;
    abi: readonly Record<string, unknown>[];
    functionName: string;
    args: readonly unknown[];
  }): Promise<string>;

  /**
   * Wait for a transaction to be confirmed on-chain.
   */
  waitForTransactionReceipt(args: { hash: string }): Promise<TronTransactionReceipt>;
}

/** Packed receipt result used by every TRON settlement path. */
export interface TronTransactionReceipt {
  status: "success" | "reverted" | "pending";
}

type ReadContractCapable = Pick<ClientTronSigner, "readContract">;
/** Minimal structural RPC surface; accepts TronWeb without exposing its declaration graph. */
export interface TronContractReader {
  contract(...args: never[]): unknown;
}
type TronContractMethod = (...args: readonly unknown[]) => {
  call(): Promise<unknown>;
  send(options?: { feeLimit?: number }): Promise<string | { txid?: string }>;
};
type TronContract = {
  methods: Record<string, TronContractMethod | undefined>;
};

/**
 * Composes a ClientTronSigner from a signer-like object and an optional TronWeb instance.
 *
 * Use this when your signer can sign typed data but does not expose a contract read helper.
 * An optional `tronWeb` supplies reads. Without it, signature-only payment paths still work.
 *
 * @param signer - The signer-like object to adapt.
 * @param tronWeb - An optional TronWeb instance used to supply contract reads.
 * @returns A fully-formed ClientTronSigner.
 */
export function toClientTronSigner(
  signer: Omit<ClientTronSigner, "readContract"> & {
    readContract?: ClientTronSigner["readContract"];
  },
  tronWeb?: TronContractReader,
): ClientTronSigner {
  const readContract =
    signer.readContract?.bind(signer) ??
    (tronWeb
      ? async (args: Parameters<NonNullable<ReadContractCapable["readContract"]>>[0]) => {
          const contract = (await tronWeb.contract(
            args.abi as never,
            args.address as never,
          )) as unknown as TronContract;
          const method = contract.methods[args.functionName];
          if (!method) {
            throw new Error(`Method ${args.functionName} not found on contract ${args.address}`);
          }
          return method(...args.args).call();
        }
      : undefined);

  return {
    address: signer.address,
    ...(signer.network ? { network: signer.network } : {}),
    ...(signer.approvalPolicy ? { approvalPolicy: signer.approvalPolicy } : {}),
    signTypedData: args => signer.signTypedData(args),
    ...(readContract ? { readContract } : {}),
    ...(signer.ensureAllowance ? { ensureAllowance: args => signer.ensureAllowance!(args) } : {}),
    ...(signer.signPermit2Approval
      ? { signPermit2Approval: args => signer.signPermit2Approval!(args) }
      : {}),
  };
}

/**
 * Wraps a single-address facilitator client into a FacilitatorTronSigner.
 *
 * This matches the EVM helper shape and is useful when your facilitator already
 * implements the TRON write/read/verify methods but exposes only `address`.
 *
 * @param signer - The facilitator-like signer to adapt.
 * @returns A FacilitatorTronSigner with a `getAddresses()` implementation.
 */
export function toFacilitatorTronSigner(
  signer: Omit<FacilitatorTronSigner, "getAddresses"> & { address: string },
): FacilitatorTronSigner {
  return {
    getAddresses: () => [signer.address],
    readContract: args => signer.readContract(args),
    verifyTypedData: args => signer.verifyTypedData(args),
    writeContract: args => signer.writeContract(args),
    waitForTransactionReceipt: args => signer.waitForTransactionReceipt(args),
  };
}

/** Options for {@link createClientTronSigner}. */
export interface CreateClientTronSignerOptions {
  /** Decimal CAIP-2 network, e.g. `"tron:3448148188"`. The TronWeb client is built from it. */
  network: string;
  /** RPC fullHost override; falls back to the network's default. */
  rpcUrl?: string;
  /** TronGrid API key (sent as the `TRON-PRO-API-KEY` header) when set. */
  apiKey?: string;
  /**
   * Default mode for {@link ClientTronSigner.ensureAllowance} (default `"auto"`).
   * Set `"skip"` for apps that manage the Permit2 approval themselves.
   */
  allowanceMode?: AllowanceMode;
  /** Token-specific Approval update policy; defaults to the built-in safe policy. */
  approvalPolicy?: Trc20ApprovalPolicy;
}

/**
 * A typed-data signer with an eagerly-resolved address — the receiver-authorizer
 * key for batch-settlement (signs `ClaimBatch` / `Refund` TIP-712 digests).
 */
export interface TronAuthorizerSignerLike {
  /** Authorizer address (Base58Check or EVM hex). */
  address: string;
  signTypedData(args: {
    domain: Record<string, unknown>;
    types: Record<string, ReadonlyArray<{ name: string; type: string }>>;
    primaryType: string;
    message: Record<string, unknown>;
  }): Promise<`0x${string}`>;
}

/**
 * Facilitator wallet abstraction for on-chain settlement — the chain-agnostic
 * {@link FacilitatorWallet} from the TRON package (`getAddress` + `signTransaction`). Lets the
 * facilitator sign settlement transactions without handing a raw key to the SDK.
 * Only `exact`/permit2 settlement uses this; GasFree settles via the relayer and
 * needs no signing key.
 */
export type FacilitatorTronWallet = FacilitatorWallet;

/** Options for {@link createFacilitatorTronSigner}. */
export interface FacilitatorTronSignerOptions {
  /** CAIP-2 network, e.g. `"tron:3448148188"`. The TronWeb client is built from it. */
  network: string;
  /** RPC fullHost override; falls back to the network's default. */
  rpcUrl?: string;
  /** TronGrid API key (sent as the `TRON-PRO-API-KEY` header) when set. */
  apiKey?: string;
  /** Fee limit in SUN (default {@link DEFAULT_FEE_LIMIT_SUN}). */
  feeLimit?: number;
  /** TRON permission id for multi-sig facilitator accounts (e.g. 2 = active). */
  permissionId?: number;
  /**
   * Maximum time to wait for a packed receipt, in milliseconds.
   * Defaults to 90 seconds.
   */
  confirmationTimeoutMs?: number;
}

/**
 * Read only when the selected payment path requires RPC capability.
 *
 * @param signer - Signer with optional contract-query capability.
 * @param args - Contract query required by the selected payment path.
 * @returns The chain query result, preserving the signer method receiver.
 */
export function readTronContract(
  signer: Pick<ClientTronSigner, "readContract">,
  args: Parameters<NonNullable<ClientTronSigner["readContract"]>>[0],
): Promise<unknown> {
  if (!signer.readContract) throw new Error("This TRON payment path requires signer.readContract");
  return signer.readContract(args);
}

export {
  createClientTronSigner,
  createFacilitatorTronSigner,
  createAuthorizerTronSigner,
} from "./adapters/wallet";
export {
  normalizeSignedTronTransaction,
  serializeSignedTronTransaction,
} from "./transactions/signatures";
export { DEFAULT_CONFIRMATION_TIMEOUT_MS } from "./transactions/receipt";

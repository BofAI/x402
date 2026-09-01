import { TronWeb, utils as tronUtils } from "tronweb";
import type { ClientWallet, FacilitatorWallet } from "@bankofai/x402-core/wallets";
import {
  DEFAULT_FEE_LIMIT_SUN,
  PERMIT2_ADDRESSES,
  erc20AllowanceAbi,
  erc20ApproveAbi,
} from "./constants";
import { buildTronWeb } from "./rpc";
import { isValidTronTxHash, tronAddressToEvm } from "./utils";
import { log } from "@bankofai/x402-core";
import { createTrc20ApprovalPolicy, type Trc20ApprovalPolicy } from "./approvalPolicy";

/** Allowance-ensuring strategy for {@link ClientTronSigner.ensureAllowance}. */
export type AllowanceMode = "auto" | "skip" | "interactive";

/** Default time budget for observing a packed TRON receipt. */
export const DEFAULT_CONFIRMATION_TIMEOUT_MS = 90_000;

/** Upper bound imposed by JavaScript's signed 32-bit timer implementation. */
const MAX_CONFIRMATION_TIMEOUT_MS = 2_147_483_647;

/** Unlimited approval amount (`type(uint256).max`), the canonical Permit2 grant. */
const MAX_UINT256 = (1n << 256n) - 1n;

/**
 * Fee-limit cap (in SUN) for the one-time Permit2 `approve`. Mirrors the Python
 * client's 100 TRX cap — an ERC-20 approve costs far less, so this only bounds
 * the worst-case TRX burn.
 */
const APPROVE_FEE_LIMIT_SUN = 100_000_000;

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
  readContract(args: {
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
 * {@link ClientWallet} from core (`getAddress` + `signTypedData` + optional
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
   * Wait for a transaction receipt at the requested finality.
   *
   * `packed` is the low-latency FullNode view. `solidified` is the irreversible
   * SolidityNode view intended for reconciliation and final accounting.
   */
  waitForTransactionReceipt(args: {
    hash: string;
    finality?: TronTransactionFinality;
  }): Promise<TronTransactionReceipt>;
}

/** TRON transaction confirmation level. */
export type TronTransactionFinality = "packed" | "solidified";

/** Raw TRON event log fields surfaced for scheme-level payment-effect validation. */
export interface TronTransactionLog {
  address?: string;
  topics?: readonly string[];
  data?: string;
}

/** Top-level smart-contract call recovered from the transaction body. */
export interface TronTransactionCall {
  contractAddress: string;
  data: string;
}

/** Receipt result used by TRON settlement and read-only reconciliation paths. */
export interface TronTransactionReceipt {
  status: "success" | "reverted" | "pending";
  finality?: TronTransactionFinality;
  call?: TronTransactionCall;
  logs?: readonly TronTransactionLog[];
}

type ReadContractCapable = Pick<ClientTronSigner, "readContract">;
type TronContractAbi = Parameters<TronWeb["contract"]>[0];
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
 * If `signer.readContract` is missing, `tronWeb` is required and will be used to satisfy reads.
 *
 * @param signer - The signer-like object to adapt.
 * @param tronWeb - An optional TronWeb instance used to supply contract reads.
 * @returns A fully-formed ClientTronSigner.
 */
export function toClientTronSigner(
  signer: Omit<ClientTronSigner, "readContract"> & {
    readContract?: ClientTronSigner["readContract"];
  },
  tronWeb?: TronWeb,
): ClientTronSigner {
  const readContract =
    signer.readContract ??
    (tronWeb
      ? async (args: Parameters<ReadContractCapable["readContract"]>[0]) => {
          const contract = (await tronWeb.contract(
            args.abi as unknown as TronContractAbi,
            args.address,
          )) as unknown as TronContract;
          const method = contract.methods[args.functionName];
          if (!method) {
            throw new Error(`Method ${args.functionName} not found on contract ${args.address}`);
          }
          return method(...args.args).call();
        }
      : undefined);

  if (!readContract) {
    throw new Error(
      "toClientTronSigner requires either a signer with readContract or a TronWeb instance.",
    );
  }

  return {
    address: signer.address,
    ...(signer.network ? { network: signer.network } : {}),
    ...(signer.approvalPolicy ? { approvalPolicy: signer.approvalPolicy } : {}),
    signTypedData: args => signer.signTypedData(args),
    readContract,
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
    ...signer,
    getAddresses: () => [signer.address],
  };
}

/** Options for {@link createClientTronSigner}. */
export interface CreateClientTronSignerOptions {
  /** CAIP-2 network, e.g. `"tron:0xcd8690dc"`. The TronWeb client is built from it. */
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
 * Creates a ClientTronSigner from a {@link ClientTronWallet}. The TronWeb client
 * (contract reads + approve broadcast) is built internally from `opts.network`.
 *
 * Wallet-only: the private key never enters the SDK. To sign with a raw key
 * (dev/test), wrap it in a wallet first.
 *
 * The returned signer always exposes {@link ClientTronSigner.ensureAllowance}
 * (used by the permit2 flow to broadcast the one-time `approve(Permit2)`, mirroring
 * the Python client). If the wallet cannot sign transactions, it throws only when
 * an approve is actually required — sign-only / pre-approved wallets still work.
 *
 * @param wallet - The wallet that signs typed data (and optionally transactions).
 * @param opts - Target network (+ optional RPC / API key / allowance mode).
 * @returns A ClientTronSigner backed by the wallet.
 *
 * @example
 * ```typescript
 * const signer = await createClientTronSigner(wallet, { network: "tron:0xcd8690dc" });
 * client.register("tron:*", new ExactTronScheme(signer));
 * ```
 */
export async function createClientTronSigner(
  wallet: ClientTronWallet,
  opts: CreateClientTronSignerOptions,
): Promise<ClientTronSigner> {
  const tronWeb = buildTronWeb(opts.network, { rpcUrl: opts.rpcUrl, apiKey: opts.apiKey });
  const address = await wallet.getAddress();
  const base = toClientTronSigner(
    {
      address,
      // agent-wallet strips the 0x prefix, so a raw wallet breaks the
      // `0x${string}` contract; re-add it here so callers and ExactTronScheme
      // get a conforming signature without their own adapter. Mirrors
      // createClientEvmSigner.
      signTypedData: async args => {
        const sig = await wallet.signTypedData(args);
        return `0x${sig.replace(/^0x/, "")}` as `0x${string}`;
      },
    },
    tronWeb,
  );

  // Give the TronWeb instance a default issuer for builds/reads (no key needed).
  (tronWeb as unknown as WriteCapableTronWeb).setAddress(address);

  // ensureAllowance is always exposed: it reads the Permit2 allowance and, when
  // an approve is needed, broadcasts it via the wallet's signTransaction (the
  // permit2 path uses this; eip3009 never calls it). If the wallet can't sign
  // transactions, it throws a clear error only when an approve is actually
  // required — pre-approved sign-only wallets still work.
  const signTransaction = wallet.signTransaction?.bind(wallet);
  const approvalPolicy = opts.approvalPolicy ?? createTrc20ApprovalPolicy();

  return {
    ...base,
    network: opts.network,
    approvalPolicy,
    ensureAllowance: allowanceArgs =>
      ensurePermit2Allowance(
        {
          tronWeb,
          ownerAddress: address,
          signTransaction,
          readContract: base.readContract,
          approvalPolicy,
        },
        { ...allowanceArgs, mode: allowanceArgs.mode ?? opts.allowanceMode },
      ),
    ...(signTransaction
      ? {
          signPermit2Approval: async (args: {
            token: string;
            network: string;
            minimumLifetimeSeconds: number;
          }) => {
            const permit2Address = PERMIT2_ADDRESSES[args.network];
            if (!permit2Address) {
              throw new Error(`No Permit2 contract address configured for network ${args.network}`);
            }
            const signed = await buildAndSignContract(
              tronWeb,
              address,
              signTransaction,
              {
                address: args.token,
                abi: erc20ApproveAbi as unknown as readonly Record<string, unknown>[],
                functionName: "approve",
                args: [permit2Address, MAX_UINT256],
              },
              {
                feeLimit: APPROVE_FEE_LIMIT_SUN,
                minimumLifetimeSeconds: args.minimumLifetimeSeconds,
              },
            );
            return serializeSignedTronTransaction(signed);
          },
        }
      : {}),
  };
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
 * Creates a TRON authorizer signer (address + typed-data signing) from a wallet —
 * e.g. the batch-settlement `receiverAuthorizer`. No TronWeb is built (signing is
 * offline); the address is resolved eagerly and the `0x` prefix re-added.
 *
 * @param wallet - The wallet that holds the authorizer key.
 * @returns A signer satisfying batch-settlement's `TronAuthorizerSigner`.
 */
export async function createAuthorizerTronSigner(
  wallet: ClientTronWallet,
): Promise<TronAuthorizerSignerLike> {
  const address = await wallet.getAddress();
  return {
    address,
    signTypedData: async args => {
      const sig = await wallet.signTypedData(args);
      return `0x${sig.replace(/^0x/, "")}` as `0x${string}`;
    },
  };
}

/**
 * Facilitator wallet abstraction for on-chain settlement — the chain-agnostic
 * {@link FacilitatorWallet} from core (`getAddress` + `signTransaction`). Lets the
 * facilitator sign settlement transactions without handing a raw key to the SDK.
 * Only `exact`/permit2 settlement uses this; GasFree settles via the relayer and
 * needs no signing key.
 */
export type FacilitatorTronWallet = FacilitatorWallet;

/** Options for {@link createFacilitatorTronSigner}. */
export interface FacilitatorTronSignerOptions {
  /** CAIP-2 network, e.g. `"tron:0xcd8690dc"`. The TronWeb client is built from it. */
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

type AbiTypeNode = { name?: string; type: string; components?: readonly AbiTypeNode[] };
type AbiFunctionNode = { type: string; name: string; inputs?: readonly AbiTypeNode[] };

/** Minimal TronWeb surface used for wallet-signed contract writes. */
type WriteCapableTronWeb = {
  transactionBuilder: {
    triggerSmartContract(
      contractAddress: string,
      functionSelector: string,
      options: Record<string, unknown>,
      parameters: ReadonlyArray<{ type: string; value: unknown }>,
      issuerAddress: string,
    ): Promise<{ result?: { result?: boolean }; transaction: Record<string, unknown> }>;
  };
  trx: {
    sendRawTransaction(
      signed: Record<string, unknown>,
    ): Promise<{ result?: boolean; txid?: string }>;
  };
  setAddress(address: string): void;
};

/**
 * Canonical ABI type string, recursing into tuples (e.g. `(address,uint256)`).
 *
 * @param node - The ABI input node.
 * @returns The canonical type string.
 */
function canonicalAbiType(node: AbiTypeNode): string {
  if (node.components && node.type.startsWith("tuple")) {
    const inner = `(${node.components.map(canonicalAbiType).join(",")})`;
    return node.type.endsWith("[]") ? `${inner}[]` : inner;
  }
  return node.type;
}

/**
 * Build a function selector string from an ABI entry
 * (e.g. `settle(((address,uint256),uint256,uint256),address,(address,uint256),bytes)`).
 *
 * @param fn - The ABI function entry.
 * @returns The function selector string.
 */
function buildFunctionSelector(fn: AbiFunctionNode): string {
  return `${fn.name}(${(fn.inputs ?? []).map(canonicalAbiType).join(",")})`;
}

/**
 * Map raw args to `triggerSmartContract` `{type, value}` parameters via the ABI.
 *
 * @param fn - The ABI function entry.
 * @param args - The raw argument values, positional per `fn.inputs`.
 * @returns The typed parameter array.
 */
function encodeTriggerParameters(
  fn: AbiFunctionNode,
  args: readonly unknown[],
): { type: string; value: unknown }[] {
  return (fn.inputs ?? []).map((input, i) => ({ type: canonicalAbiType(input), value: args[i] }));
}

/**
 * Find a function entry in an ABI by name.
 *
 * @param abi - The contract ABI.
 * @param name - The function name.
 * @returns The matching ABI function entry.
 */
function findAbiFunction(abi: readonly Record<string, unknown>[], name: string): AbiFunctionNode {
  const fn = (abi as readonly AbiFunctionNode[]).find(
    e => e.type === "function" && e.name === name,
  );
  if (!fn) {
    throw new Error(`Function ${name} not found in ABI`);
  }
  return fn;
}

/**
 * Normalize a wallet's signTransaction result into a broadcastable signed tx.
 *
 * Accepts a signed-tx object, a JSON string of one, or a raw signature hex
 * (mirrors agent-wallet's TronWallet, which returns a JSON-encoded signed tx).
 *
 * @param result - The wallet's signTransaction return value.
 * @param unsigned - The original unsigned transaction.
 * @returns A transaction object ready to broadcast.
 */
export function normalizeSignedTronTransaction(
  result: string | Record<string, unknown>,
  unsigned: Record<string, unknown>,
): Record<string, unknown> {
  const normalizeSignatures = (transaction: Record<string, unknown>): Record<string, unknown> => {
    const signatures = transaction.signature;
    if (!Array.isArray(signatures)) return transaction;
    return {
      ...transaction,
      signature: signatures.map(signature => {
        if (typeof signature !== "string") return signature;
        const prefix = signature.startsWith("0x") ? "0x" : "";
        const hex = signature.slice(prefix.length);
        if (!/^[0-9a-fA-F]{130}$/.test(hex)) return signature;
        const recovery = Number.parseInt(hex.slice(-2), 16);
        if (recovery !== 27 && recovery !== 28) return signature;
        return `${prefix}${hex.slice(0, -2)}${(recovery - 27).toString(16).padStart(2, "0")}`;
      }),
    };
  };

  if (typeof result !== "string") {
    return normalizeSignatures(result);
  }
  const trimmed = result.trim();
  if (trimmed.startsWith("{")) {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(trimmed) as Record<string, unknown>;
    } catch (err) {
      throw new Error(
        `signTransaction returned a malformed JSON string: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (Array.isArray((parsed as { signature?: unknown }).signature)) {
      return normalizeSignatures({ ...unsigned, ...parsed });
    }
    return normalizeSignatures(parsed);
  }
  return normalizeSignatures({ ...unsigned, signature: [trimmed.replace(/^0x/, "")] });
}

/** Wallet hook that signs a built TRON transaction for broadcast. */
type SignTransactionFn = (
  transaction: Record<string, unknown>,
) => Promise<string | Record<string, unknown>>;

type ContractWriteArgs = {
  address: string;
  abi: readonly Record<string, unknown>[];
  functionName: string;
  args: readonly unknown[];
};

/**
 * Build a contract write and obtain the wallet-signed transaction without broadcasting it.
 *
 * @param tronWeb - The TronWeb instance used to build the transaction.
 * @param issuerAddress - The transaction owner/issuer.
 * @param signTransaction - Wallet hook that signs the built transaction.
 * @param args - Contract call arguments.
 * @param args.address - Contract address.
 * @param args.abi - Contract ABI.
 * @param args.functionName - Contract function name.
 * @param args.args - Positional contract arguments.
 * @param options - Transaction policy options.
 * @param options.feeLimit - Maximum energy fee in SUN.
 * @param options.permissionId - Optional TRON multi-signature permission id.
 * @param options.minimumLifetimeSeconds - Minimum remaining transaction lifetime.
 * @returns Wallet-signed transaction object.
 */
async function buildAndSignContract(
  tronWeb: TronWeb,
  issuerAddress: string,
  signTransaction: SignTransactionFn,
  args: ContractWriteArgs,
  options: { feeLimit: number; permissionId?: number; minimumLifetimeSeconds?: number },
): Promise<Record<string, unknown>> {
  const tw = tronWeb as unknown as WriteCapableTronWeb;
  const fn = findAbiFunction(args.abi, args.functionName);
  const selector = buildFunctionSelector(fn);
  const parameters = encodeTriggerParameters(fn, args.args);
  log.debug("x402 tron: build+sign start", {
    contract: args.address,
    method: args.functionName,
    issuer: issuerAddress,
    feeLimit: options.feeLimit,
    ...(options.permissionId != null ? { permissionId: options.permissionId } : {}),
  });
  const built = await tw.transactionBuilder.triggerSmartContract(
    args.address,
    selector,
    {
      feeLimit: options.feeLimit,
      callValue: 0,
      ...(options.permissionId != null ? { permissionId: options.permissionId } : {}),
    },
    parameters,
    issuerAddress,
  );
  if (!built.result?.result) {
    throw new Error(`triggerSmartContract failed: ${JSON.stringify(built)}`);
  }
  const unsigned = extendTransactionLifetime(built.transaction, options.minimumLifetimeSeconds);
  return normalizeSignedTronTransaction(await signTransaction(unsigned), unsigned);
}

/**
 * Extends an unsigned TRON transaction and recomputes its authoritative identity.
 *
 * @param transaction - RPC-built unsigned transaction.
 * @param minimumLifetimeSeconds - Required lifetime measured from the local clock.
 * @returns The original transaction or an immutable extended transaction.
 */
function extendTransactionLifetime(
  transaction: Record<string, unknown>,
  minimumLifetimeSeconds?: number,
): Record<string, unknown> {
  if (minimumLifetimeSeconds == null) return transaction;
  if (
    !Number.isSafeInteger(minimumLifetimeSeconds) ||
    minimumLifetimeSeconds <= 0 ||
    minimumLifetimeSeconds > 86_400
  ) {
    throw new Error("minimumLifetimeSeconds must be an integer between 1 and 86400");
  }
  const rawData = transaction.raw_data as Record<string, unknown> | undefined;
  if (!rawData || typeof rawData.expiration !== "number") {
    throw new Error("TRON transaction is missing raw_data.expiration");
  }
  const minimumExpiration = Date.now() + minimumLifetimeSeconds * 1_000;
  if (rawData.expiration >= minimumExpiration) return transaction;

  const extended = {
    ...transaction,
    raw_data: { ...rawData, expiration: minimumExpiration },
  };
  const transactionPb = tronUtils.transaction.txJsonToPb(extended);
  return {
    ...extended,
    raw_data_hex: tronUtils.transaction.txPbToRawDataHex(transactionPb).toLowerCase(),
    txID: tronUtils.transaction.txPbToTxID(transactionPb).replace(/^0x/, "").toLowerCase(),
  };
}

/**
 * Serialize a signed TRON transaction object into its complete protobuf wire bytes.
 *
 * @param transaction - Wallet-signed TRON transaction object.
 * @returns Complete signed Transaction protobuf as lowercase hex.
 */
export function serializeSignedTronTransaction(transaction: Record<string, unknown>): string {
  const signatures = transaction.signature;
  if (!Array.isArray(signatures) || signatures.length !== 1 || typeof signatures[0] !== "string") {
    throw new Error("TRON Approval requires exactly one transaction signature");
  }
  const signature = signatures[0].replace(/^0x/, "").toLowerCase();
  if (!/^[0-9a-f]{130}$/.test(signature)) {
    throw new Error("TRON Approval signature must be 65-byte hexadecimal");
  }

  const transactionPb = tronUtils.transaction.txJsonToPb(transaction) as {
    addSignature(bytes: Uint8Array): void;
    serializeBinary(): Uint8Array;
  };
  transactionPb.addSignature(Uint8Array.from(tronUtils.code.hexStr2byteArray(signature)));
  return tronUtils.code.byteArray2hexStr(transactionPb.serializeBinary()).toLowerCase();
}

/**
 * Build a contract-write tx, hand it to the wallet to sign (the key never
 * enters the SDK), then broadcast it. Shared by the facilitator settlement path
 * and the client one-time Permit2 approve.
 *
 * @param tronWeb - The TronWeb instance used to build and broadcast.
 * @param issuerAddress - The transaction owner/issuer (pays the on-chain fee).
 * @param signTransaction - Wallet hook that signs the built transaction.
 * @param args - The contract address, ABI, function name, and positional args.
 * @param options - Fee limit (SUN) and optional multi-sig permission id.
 * @param options.feeLimit - Maximum Energy burn in SUN.
 * @param options.permissionId - Optional TRON permission id.
 * @returns The broadcast transaction id.
 */
async function buildSignAndBroadcast(
  tronWeb: TronWeb,
  issuerAddress: string,
  signTransaction: SignTransactionFn,
  args: ContractWriteArgs,
  options: { feeLimit: number; permissionId?: number },
): Promise<string> {
  const tw = tronWeb as unknown as WriteCapableTronWeb;
  const signed = await buildAndSignContract(tronWeb, issuerAddress, signTransaction, args, options);
  const broadcast = await tw.trx.sendRawTransaction(signed);
  if (!broadcast.result) {
    log.error("x402 tron: broadcast rejected", {
      contract: args.address,
      method: args.functionName,
      response: JSON.stringify(broadcast),
    });
    throw new Error(`sendRawTransaction failed: ${JSON.stringify(broadcast)}`);
  }
  if (!isValidTronTxHash(broadcast.txid)) {
    // Broadcast reported success but returned no usable txid; without one the
    // caller cannot reconcile an indeterminate settlement. Fail terminally.
    log.error("x402 tron: broadcast returned invalid txid", {
      contract: args.address,
      method: args.functionName,
      response: JSON.stringify(broadcast),
    });
    throw new Error(`sendRawTransaction returned invalid txid: ${JSON.stringify(broadcast)}`);
  }
  const txid = broadcast.txid.replace(/^0x/i, "").toLowerCase();
  log.info("x402 tron: broadcast ok", {
    contract: args.address,
    method: args.functionName,
    txid,
  });
  return txid;
}

type TronTxInfo = {
  blockNumber?: number;
  receipt?: { result?: string };
  log?: readonly TronTransactionLog[];
};

type TronTxBody = {
  raw_data?: {
    contract?: readonly {
      type?: string;
      parameter?: {
        type_url?: string;
        value?: {
          contract_address?: string;
          data?: string;
        };
      };
    }[];
  };
};

const TERMINAL_RECEIPT_FAILURES = new Set([
  "REVERT",
  "BAD_JUMP_DESTINATION",
  "OUT_OF_MEMORY",
  "PRECOMPILED_CONTRACT",
  "STACK_TOO_SMALL",
  "STACK_TOO_LARGE",
  "ILLEGAL_OPERATION",
  "STACK_OVERFLOW",
  "OUT_OF_ENERGY",
  "OUT_OF_TIME",
  "JVM_STACK_OVER_FLOW",
  "UNKNOWN",
  "TRANSFER_FAILED",
  "INVALID_CODE",
]);

/**
 * Extract the single TriggerSmartContract call needed for effect validation.
 *
 * @param body - Transaction body returned by FullNode or SolidityNode.
 * @returns The called contract and calldata, or undefined when incomplete.
 */
function extractTransactionCall(body: TronTxBody | null): TronTransactionCall | undefined {
  const contracts = body?.raw_data?.contract;
  if (!contracts || contracts.length !== 1) return undefined;
  const contract = contracts[0];
  const value = contract?.parameter?.value;
  const isTriggerSmartContract =
    contract?.type === "TriggerSmartContract" ||
    contract?.parameter?.type_url?.endsWith(".TriggerSmartContract") === true;
  if (!isTriggerSmartContract || !value?.contract_address || !value.data) return undefined;
  return { contractAddress: value.contract_address, data: value.data };
}

/**
 * Resolve and validate a caller-supplied receipt timeout.
 *
 * @param value - Configured timeout, or undefined to use the default.
 * @returns The validated confirmation timeout in milliseconds.
 */
function resolveConfirmationTimeoutMs(value: number | undefined): number {
  const timeoutMs = value ?? DEFAULT_CONFIRMATION_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > MAX_CONFIRMATION_TIMEOUT_MS
  ) {
    throw new Error(
      `confirmationTimeoutMs must be a positive integer no greater than ${MAX_CONFIRMATION_TIMEOUT_MS}, got ${timeoutMs}`,
    );
  }
  return timeoutMs;
}

/**
 * Await a single RPC request without allowing it to exceed the remaining budget.
 *
 * @param request - Receipt RPC request to await.
 * @param timeoutMs - Remaining confirmation budget in milliseconds.
 * @returns The RPC response when it completes within the remaining budget.
 */
async function requestWithin<T>(request: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      request,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("TRON receipt RPC timed out")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Poll TRON for a transaction receipt and its original smart-contract call.
 *
 * Packed mode reads the low-latency FullNode head and is provisional.
 * Solidified mode reads SolidityNode and is suitable for final reconciliation.
 * A successful receipt also fetches the transaction body so scheme code can
 * verify the called contract/calldata in addition to emitted effects.
 *
 * @param tronWeb - The TronWeb instance used to read the transaction.
 * @param hash - The transaction id to wait for.
 * @param timeoutMs - Total confirmation budget in milliseconds.
 * @param finality - Packed or solidified confirmation source.
 * @returns The observed receipt, or `pending` when the result remains incomplete.
 */
async function pollTransaction(
  tronWeb: TronWeb,
  hash: string,
  timeoutMs: number = DEFAULT_CONFIRMATION_TIMEOUT_MS,
  finality: TronTransactionFinality = "packed",
): Promise<TronTransactionReceipt> {
  if (!isValidTronTxHash(hash)) {
    throw new Error(`invalid TRON transaction id: ${hash}`);
  }
  const rpcHash = hash.replace(/^0x/i, "").toLowerCase();
  const delayMs = 3_000;
  const deadline = Date.now() + timeoutMs;
  const provider = finality === "solidified" ? tronWeb.solidityNode : tronWeb.fullNode;
  const namespace = finality === "solidified" ? "walletsolidity" : "wallet";

  while (Date.now() < deadline) {
    let info: TronTxInfo | null = null;
    try {
      info = await requestWithin(
        provider.request(
          `${namespace}/gettransactioninfobyid`,
          { value: rpcHash },
          "post",
        ) as Promise<TronTxInfo | null>,
        Math.max(1, deadline - Date.now()),
      );
    } catch {
      // Not yet confirmed / transient node or rate-limit error — keep polling.
    }
    if (info?.blockNumber != null) {
      const result = info.receipt?.result;
      if (result === "SUCCESS") {
        let body: TronTxBody | null = null;
        try {
          body = await requestWithin(
            provider.request(
              `${namespace}/gettransactionbyid`,
              { value: rpcHash },
              "post",
            ) as Promise<TronTxBody | null>,
            Math.max(1, deadline - Date.now()),
          );
        } catch {
          // Receipt status is still usable by callers that do not validate effects.
          // Scheme validators treat the absent call data as indeterminate.
        }
        const call = extractTransactionCall(body);
        log.info("x402 tron: tx receipt observed", {
          hash,
          status: "success",
          finality,
          contractRet: result,
        });
        return {
          status: "success",
          finality,
          ...(call ? { call } : {}),
          ...(info.log ? { logs: info.log } : {}),
        };
      } else if (result && TERMINAL_RECEIPT_FAILURES.has(result)) {
        log.warn("x402 tron: tx receipt observed", {
          hash,
          status: "reverted",
          finality,
          contractRet: result,
        });
        return { status: "reverted", finality };
      } else {
        log.info("x402 tron: tx receipt incomplete", {
          hash,
          finality,
          contractRet: result,
        });
      }
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;
    await new Promise(resolve => setTimeout(resolve, Math.min(delayMs, remainingMs)));
  }

  log.warn("x402 tron: tx confirm timeout (pending)", { hash, timeoutMs, finality });
  return { status: "pending", finality };
}

/**
 * Ensure the token's Permit2 allowance covers `amount`, broadcasting a one-time
 * `approve(Permit2, MAX_UINT256)` if it does not. Mirrors the Python client's
 * `ensure_allowance`, with two deliberate differences: the spender is the
 * canonical Permit2 (not Python's PaymentPermit), and an allowance-read error is
 * surfaced rather than swallowed (so we never approve on bad/zeroed data).
 *
 * @param deps - TronWeb, the owner address, the wallet sign hook, and a reader.
 * @param deps.tronWeb - TronWeb instance used to build and broadcast approval transactions.
 * @param deps.ownerAddress - Token owner granting the allowance.
 * @param deps.signTransaction - Optional wallet hook for signing an approval transaction.
 * @param deps.readContract - Contract reader used to inspect the current allowance.
 * @param deps.approvalPolicy - Token-specific Approval update policy.
 * @param args - Token, required amount (payment + fee), network, and mode.
 * @param args.token - TRC-20 token contract address.
 * @param args.amount - Required Permit2 allowance.
 * @param args.network - Canonical TRON CAIP-2 network.
 * @param args.mode - Allowance handling mode.
 * @returns `true` once the allowance is sufficient.
 */
async function ensurePermit2Allowance(
  deps: {
    tronWeb: TronWeb;
    ownerAddress: string;
    signTransaction?: SignTransactionFn;
    readContract: ClientTronSigner["readContract"];
    approvalPolicy: Trc20ApprovalPolicy;
  },
  args: { token: string; amount: bigint; network: string; mode?: AllowanceMode },
): Promise<boolean> {
  const mode = args.mode ?? "auto";
  if (mode === "skip") {
    return true;
  }
  if (mode === "interactive") {
    throw new Error("ensureAllowance: interactive approval mode is not implemented");
  }

  const permit2Address = PERMIT2_ADDRESSES[args.network];
  if (!permit2Address) {
    throw new Error(`No Permit2 contract address configured for network ${args.network}`);
  }

  // Read the ERC-20 allowance the token grants Permit2. Do NOT swallow errors:
  // approving on a failed/zeroed read would burn TRX needlessly.
  const currentRaw = (await deps.readContract({
    address: args.token,
    abi: erc20AllowanceAbi as unknown as readonly Record<string, unknown>[],
    functionName: "allowance",
    args: [deps.ownerAddress, permit2Address],
  })) as bigint | string | number;
  // Normalize: tronweb contract reads can surface a string/number rather than a
  // bigint; comparing a non-bigint against `args.amount` (bigint) misbehaves or
  // throws. Mirror readGasFreeBalance's BigInt() coercion.
  const current = BigInt(currentRaw);

  if (current >= args.amount) {
    return true;
  }

  const strategy = deps.approvalPolicy.strategyFor(args.network, args.token);
  if (strategy === "unsupported") {
    throw new Error("approval_asset_unsupported");
  }
  if (current !== 0n && strategy === "zero-first") {
    throw new Error("approval_reset_required");
  }

  // An approve is required but this wallet only signs typed data — surface a
  // clear error early rather than failing later at facilitator settlement.
  if (!deps.signTransaction) {
    throw new Error(
      "ensureAllowance: a one-time Permit2 approve is required but the wallet " +
        "cannot sign transactions (no signTransaction). Approve Permit2 out-of-band " +
        "or use a wallet that supports signTransaction.",
    );
  }

  // One-time approve(Permit2, MAX_UINT256); the user's wallet pays the TRX.
  const txid = await buildSignAndBroadcast(
    deps.tronWeb,
    deps.ownerAddress,
    deps.signTransaction,
    {
      address: args.token,
      abi: erc20ApproveAbi as unknown as readonly Record<string, unknown>[],
      functionName: "approve",
      args: [permit2Address, MAX_UINT256],
    },
    { feeLimit: APPROVE_FEE_LIMIT_SUN },
  );

  // Confirm at packed speed (~3s), not solidification (~60s): the allowance is
  // live once the approve is packed, which is all the following payment needs.
  const receipt = await pollTransaction(deps.tronWeb, txid);
  if (receipt.status !== "success") {
    throw new Error(`Permit2 approval did not succeed (status=${receipt.status}, tx=${txid})`);
  }
  return true;
}

/**
 * Creates a FacilitatorTronSigner from a {@link FacilitatorTronWallet}. The
 * TronWeb client (reads / verification / writes) is built internally from
 * `opts.network`.
 *
 * The transaction is built, handed to the wallet to sign (the private key never
 * enters the SDK), then broadcast — mirroring the production facilitator that
 * resolves a keystore-backed wallet unlocked out-of-band. For dev/test, wrap a
 * key in a wallet yourself (e.g. via TronWeb's `trx.sign`).
 *
 * @param wallet - The wallet that signs settlement transactions.
 * @param opts - Target network (+ optional RPC / API key / fee limit / permission id).
 * @returns A FacilitatorTronSigner backed by the wallet.
 *
 * @example
 * ```typescript
 * const signer = await createFacilitatorTronSigner(wallet, { network: "tron:0xcd8690dc" });
 * facilitator.register("tron:0xcd8690dc", new ExactTronScheme(signer));
 * ```
 */
export async function createFacilitatorTronSigner(
  wallet: FacilitatorTronWallet,
  opts: FacilitatorTronSignerOptions,
): Promise<FacilitatorTronSigner> {
  const tronWeb = buildTronWeb(opts.network, { rpcUrl: opts.rpcUrl, apiKey: opts.apiKey });
  const address = await wallet.getAddress();
  const feeLimit = opts.feeLimit ?? DEFAULT_FEE_LIMIT_SUN;
  const confirmationTimeoutMs = resolveConfirmationTimeoutMs(opts.confirmationTimeoutMs);

  // Reads and tx building need a default issuer address; set it without a key.
  (tronWeb as unknown as WriteCapableTronWeb).setAddress(address);

  return toFacilitatorTronSigner({
    address,
    async readContract(args) {
      const contract = (await tronWeb.contract(
        args.abi as unknown as TronContractAbi,
        args.address,
      )) as unknown as TronContract;
      const method = contract.methods[args.functionName];
      if (!method) {
        throw new Error(`Method ${args.functionName} not found on contract ${args.address}`);
      }
      return method(...args.args).call();
    },
    async verifyTypedData(args) {
      const mutableTypes = Object.fromEntries(
        Object.entries(args.types).map(([name, fields]) => [name, [...fields]]),
      );
      const recovered = tronUtils.typedData.verifyTypedData(
        args.domain,
        mutableTypes,
        args.message,
        args.signature,
      );

      return tronAddressToEvm(args.address) === tronAddressToEvm(recovered);
    },
    async writeContract(args) {
      // Build the tx, let the wallet sign it (the key never enters the SDK),
      // then broadcast. Mirrors bankofai TronFacilitatorSigner.writeContract.
      return buildSignAndBroadcast(tronWeb, address, tx => wallet.signTransaction(tx), args, {
        feeLimit,
        ...(opts.permissionId != null ? { permissionId: opts.permissionId } : {}),
      });
    },
    async waitForTransactionReceipt(args) {
      return pollTransaction(tronWeb, args.hash, confirmationTimeoutMs, args.finality ?? "packed");
    },
  });
}

import { TronWeb, utils as tronUtils } from "tronweb";
import {
  DEFAULT_FEE_LIMIT_SUN,
  PERMIT2_ADDRESSES,
  erc20AllowanceAbi,
  erc20ApproveAbi,
} from "./constants";
import { tronAddressToEvm } from "./utils";

/** Allowance-ensuring strategy for {@link ClientTronSigner.ensureAllowance}. */
export type AllowanceMode = "auto" | "skip" | "interactive";

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

  /**
   * Sign EIP-712/TIP-712 typed data.
   * The domain and message addresses should already be in EVM hex format.
   */
  signTypedData(args: {
    domain: Record<string, unknown>;
    types: Record<string, Array<{ name: string; type: string }>>;
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
   * Present only when the backing wallet can sign transactions
   * ({@link AgentWallet.signTransaction}). The permit2 client flow calls this
   * before signing; eip3009 payments never invoke it. `mode` defaults to the
   * signer's configured mode (`"auto"`): `"skip"` returns immediately,
   * `"interactive"` is not implemented.
   */
  ensureAllowance?(args: {
    token: string;
    amount: bigint;
    network: string;
    mode?: AllowanceMode;
  }): Promise<boolean>;
}

/**
 * Minimal wallet abstraction for TRON client signing.
 *
 * Decouples the client signer from how the wallet was created (raw private key,
 * hosted/MDP wallet, hardware, `@bankofai/agent-wallet`, etc.). Any object that
 * exposes an address and can sign TIP-712 typed data satisfies it — no specific
 * wallet library is required (structural typing).
 */
export interface AgentWallet {
  /**
   * Get the wallet's TRON address (Base58Check) or EVM hex address.
   * May be synchronous or asynchronous.
   */
  getAddress(): Promise<string> | string;

  /**
   * Sign EIP-712/TIP-712 typed data.
   * Domain and message addresses should already be in EVM hex format.
   */
  signTypedData(args: {
    domain: Record<string, unknown>;
    types: Record<string, Array<{ name: string; type: string }>>;
    primaryType: string;
    message: Record<string, unknown>;
  }): Promise<`0x${string}`>;

  /**
   * Optionally sign a built TRON transaction for broadcast (e.g. the one-time
   * Permit2 `approve`). Same shape as {@link FacilitatorAgentWallet.signTransaction}.
   * When absent, the client signer stays sign-only and
   * {@link ClientTronSigner.ensureAllowance} is not exposed.
   */
  signTransaction?(transaction: Record<string, unknown>): Promise<string | Record<string, unknown>>;
}

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
    types: Record<string, Array<{ name: string; type: string }>>;
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
  waitForTransactionReceipt(args: { hash: string }): Promise<{ status: string }>;
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
type TronTxInfo = {
  blockNumber?: number;
  receipt?: {
    result?: string;
  };
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
    signTypedData: args => signer.signTypedData(args),
    readContract,
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
  /**
   * Default mode for {@link ClientTronSigner.ensureAllowance} (default `"auto"`).
   * Set `"skip"` for apps that manage the Permit2 approval themselves.
   */
  allowanceMode?: AllowanceMode;
}

/**
 * Creates a ClientTronSigner from an {@link AgentWallet}.
 *
 * Wallet-only: the private key never enters the SDK. To sign with a raw key
 * (dev/test), wrap it in an AgentWallet first. `tronWeb` supplies contract reads.
 *
 * If the wallet also exposes {@link AgentWallet.signTransaction}, the returned
 * signer gains {@link ClientTronSigner.ensureAllowance}, which the permit2 flow
 * uses to broadcast the one-time `approve(Permit2)` (mirrors the Python client).
 * Without it, the signer stays sign-only.
 *
 * @param tronWeb - The TronWeb instance used for contract reads and approve broadcast.
 * @param wallet - The wallet that signs typed data (and optionally transactions).
 * @param options - Optional default allowance mode.
 * @returns A ClientTronSigner backed by the wallet.
 */
export async function createClientTronSigner(
  tronWeb: TronWeb,
  wallet: AgentWallet,
  options: CreateClientTronSignerOptions = {},
): Promise<ClientTronSigner> {
  const address = await wallet.getAddress();
  const base = toClientTronSigner(
    {
      address,
      signTypedData: args => wallet.signTypedData(args),
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

  return {
    ...base,
    ensureAllowance: allowanceArgs =>
      ensurePermit2Allowance(
        { tronWeb, ownerAddress: address, signTransaction, readContract: base.readContract },
        { ...allowanceArgs, mode: allowanceArgs.mode ?? options.allowanceMode },
      ),
  };
}

/**
 * Minimal facilitator wallet abstraction for on-chain settlement.
 *
 * Lets the facilitator sign settlement transactions without ever handing a raw
 * private key to the SDK — the key stays inside the wallet (e.g. a keystore
 * unlocked out-of-band). Only `exact`/permit2 settlement uses this; GasFree
 * settles via the relayer and needs no signing key.
 */
export interface FacilitatorAgentWallet {
  /** Facilitator TRON address (Base58Check). */
  address: string;
  /**
   * Sign a built TRON transaction. May return the fully signed transaction
   * object, a JSON string of one, or a raw signature hex — all are accepted.
   */
  signTransaction(transaction: Record<string, unknown>): Promise<string | Record<string, unknown>>;
}

/** Options for facilitator on-chain writes. */
export interface FacilitatorTronSignerOptions {
  /** Fee limit in SUN (default {@link DEFAULT_FEE_LIMIT_SUN}). */
  feeLimit?: number;
  /** TRON permission id for multi-sig facilitator accounts (e.g. 2 = active). */
  permissionId?: number;
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
function toSignedTransaction(
  result: string | Record<string, unknown>,
  unsigned: Record<string, unknown>,
): Record<string, unknown> {
  if (typeof result !== "string") {
    return result;
  }
  const trimmed = result.trim();
  if (trimmed.startsWith("{")) {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (Array.isArray((parsed as { signature?: unknown }).signature)) {
      return { ...unsigned, ...parsed };
    }
    return parsed;
  }
  return { ...unsigned, signature: [trimmed.replace(/^0x/, "")] };
}

/** Wallet hook that signs a built TRON transaction for broadcast. */
type SignTransactionFn = (
  transaction: Record<string, unknown>,
) => Promise<string | Record<string, unknown>>;

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
 * @returns The broadcast transaction id.
 */
async function buildSignAndBroadcast(
  tronWeb: TronWeb,
  issuerAddress: string,
  signTransaction: SignTransactionFn,
  args: {
    address: string;
    abi: readonly Record<string, unknown>[];
    functionName: string;
    args: readonly unknown[];
  },
  options: { feeLimit: number; permissionId?: number },
): Promise<string> {
  const tw = tronWeb as unknown as WriteCapableTronWeb;
  const fn = findAbiFunction(args.abi, args.functionName);
  const selector = buildFunctionSelector(fn);
  const parameters = encodeTriggerParameters(fn, args.args);
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
  const signed = toSignedTransaction(await signTransaction(built.transaction), built.transaction);
  const broadcast = await tw.trx.sendRawTransaction(signed);
  if (!broadcast.result) {
    throw new Error(`sendRawTransaction failed: ${JSON.stringify(broadcast)}`);
  }
  return broadcast.txid ?? "";
}

/**
 * Poll TRON for a transaction receipt on a deadline.
 *
 * `getTransactionInfo` returns an empty object until the tx is packed into a
 * block; `blockNumber` is the canonical "mined" signal. Tolerates transient
 * read errors, since public nodes can take well over 30s to propagate —
 * especially without an API key.
 *
 * @param tronWeb - The TronWeb instance used to read transaction info.
 * @param hash - The transaction id to wait for.
 * @returns `success` / `reverted` once mined, or `pending` on timeout.
 */
async function pollTransactionReceipt(tronWeb: TronWeb, hash: string): Promise<{ status: string }> {
  const timeoutMs = 120_000;
  const delayMs = 3_000;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const info = (await tronWeb.trx.getTransactionInfo(hash)) as TronTxInfo | null;
      if (info && info.blockNumber) {
        return { status: info.receipt?.result === "SUCCESS" ? "success" : "reverted" };
      }
    } catch {
      // Not yet propagated / transient node or rate-limit error — keep polling.
    }
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }

  return { status: "pending" };
}

/**
 * Ensure the token's Permit2 allowance covers `amount`, broadcasting a one-time
 * `approve(Permit2, MAX_UINT256)` if it does not. Mirrors the Python client's
 * `ensure_allowance`, with two deliberate differences: the spender is the
 * canonical Permit2 (not Python's PaymentPermit), and an allowance-read error is
 * surfaced rather than swallowed (so we never approve on bad/zeroed data).
 *
 * @param deps - TronWeb, the owner address, the wallet sign hook, and a reader.
 * @param args - Token, required amount (payment + fee), network, and mode.
 * @returns `true` once the allowance is sufficient.
 */
async function ensurePermit2Allowance(
  deps: {
    tronWeb: TronWeb;
    ownerAddress: string;
    signTransaction?: SignTransactionFn;
    readContract: ClientTronSigner["readContract"];
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
  const current = (await deps.readContract({
    address: args.token,
    abi: erc20AllowanceAbi as unknown as readonly Record<string, unknown>[],
    functionName: "allowance",
    args: [deps.ownerAddress, permit2Address],
  })) as bigint;

  if (current >= args.amount) {
    return true;
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

  const receipt = await pollTransactionReceipt(deps.tronWeb, txid);
  if (receipt.status !== "success") {
    throw new Error(`Permit2 approval did not succeed (status=${receipt.status}, tx=${txid})`);
  }
  return true;
}

/**
 * Creates a FacilitatorTronSigner from a TronWeb instance and a
 * {@link FacilitatorAgentWallet}.
 *
 * The transaction is built, handed to the wallet to sign (the private key never
 * enters the SDK), then broadcast — mirroring the production facilitator that
 * resolves a keystore-backed wallet unlocked out-of-band. For dev/test, wrap a
 * key in a wallet yourself (e.g. via TronWeb's `trx.sign`).
 *
 * @param tronWeb - The TronWeb instance used for reads, verification, and writes.
 * @param wallet - The wallet that signs settlement transactions.
 * @param options - Optional fee limit / multi-sig permission id.
 * @returns A FacilitatorTronSigner backed by TronWeb.
 */
export function createFacilitatorTronSigner(
  tronWeb: TronWeb,
  wallet: FacilitatorAgentWallet,
  options: FacilitatorTronSignerOptions = {},
): FacilitatorTronSigner {
  const address = wallet.address;
  const feeLimit = options.feeLimit ?? DEFAULT_FEE_LIMIT_SUN;

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
      const recovered = tronUtils.typedData.verifyTypedData(
        args.domain,
        args.types,
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
        ...(options.permissionId != null ? { permissionId: options.permissionId } : {}),
      });
    },
    async waitForTransactionReceipt(args) {
      return pollTransactionReceipt(tronWeb, args.hash);
    },
  });
}

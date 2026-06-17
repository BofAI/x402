import { TronWeb, utils as tronUtils } from "tronweb";
import { DEFAULT_FEE_LIMIT_SUN } from "./constants";
import { tronAddressToEvm } from "./utils";

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

/**
 * Creates a ClientTronSigner from an {@link AgentWallet}.
 *
 * Wallet-only: the private key never enters the SDK. To sign with a raw key
 * (dev/test), wrap it in an AgentWallet first. `tronWeb` supplies contract reads.
 *
 * @param tronWeb - The TronWeb instance used for contract reads.
 * @param wallet - The wallet that signs typed data.
 * @returns A ClientTronSigner backed by the wallet.
 */
export async function createClientTronSigner(
  tronWeb: TronWeb,
  wallet: AgentWallet,
): Promise<ClientTronSigner> {
  const address = await wallet.getAddress();
  return toClientTronSigner(
    {
      address,
      signTypedData: args => wallet.signTypedData(args),
    },
    tronWeb,
  );
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
      const tw = tronWeb as unknown as WriteCapableTronWeb;
      const fn = findAbiFunction(args.abi, args.functionName);
      const selector = buildFunctionSelector(fn);
      const parameters = encodeTriggerParameters(fn, args.args);
      const built = await tw.transactionBuilder.triggerSmartContract(
        args.address,
        selector,
        {
          feeLimit,
          callValue: 0,
          ...(options.permissionId != null ? { permissionId: options.permissionId } : {}),
        },
        parameters,
        address,
      );
      if (!built.result?.result) {
        throw new Error(`triggerSmartContract failed: ${JSON.stringify(built)}`);
      }
      const signed = toSignedTransaction(
        await wallet.signTransaction(built.transaction),
        built.transaction,
      );
      const broadcast = await tw.trx.sendRawTransaction(signed);
      if (!broadcast.result) {
        throw new Error(`sendRawTransaction failed: ${JSON.stringify(broadcast)}`);
      }
      return broadcast.txid ?? "";
    },
    async waitForTransactionReceipt(args) {
      // TRON's getTransactionInfo returns an empty object until the tx is packed
      // into a block; `blockNumber` is the canonical "mined" signal. Poll on a
      // deadline (not a fixed attempt count) and tolerate transient read errors,
      // since public nodes can take well over 30s to propagate — especially
      // without an API key.
      const timeoutMs = 120_000;
      const delayMs = 3_000;
      const deadline = Date.now() + timeoutMs;

      while (Date.now() < deadline) {
        try {
          const info = (await tronWeb.trx.getTransactionInfo(args.hash)) as TronTxInfo | null;
          if (info && info.blockNumber) {
            return { status: info.receipt?.result === "SUCCESS" ? "success" : "reverted" };
          }
        } catch {
          // Not yet propagated / transient node or rate-limit error — keep polling.
        }
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }

      return { status: "pending" };
    },
  });
}

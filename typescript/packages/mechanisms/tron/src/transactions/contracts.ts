/** Generic transaction construction/broadcast boundary, independent of TronWeb declarations. */
import { utils as tronUtils } from "tronweb";
import { log } from "../logger";
import { isValidTronTxHash } from "../utils";
import { normalizeSignedTronTransaction } from "./signatures";
export interface TronTransactionClient {
  transactionBuilder: { triggerSmartContract(...args: never[]): unknown };
  trx: { sendRawTransaction(...args: never[]): unknown };
}

type AbiTypeNode = { name?: string; type: string; components?: readonly AbiTypeNode[] };
type AbiFunctionNode = { type: string; name: string; inputs?: readonly AbiTypeNode[] };

/** Minimal TronWeb surface used for wallet-signed contract writes. */
export type WriteCapableTronWeb = {
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

/** Wallet hook that signs a built TRON transaction for broadcast. */
export type SignTransactionFn = (
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
export async function buildAndSignContract(
  tronWeb: TronTransactionClient,
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
export async function buildSignAndBroadcast(
  tronWeb: TronTransactionClient,
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

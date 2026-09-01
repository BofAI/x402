import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
} from "@bankofai/x402-core/types";
import { utils as tronUtils } from "tronweb";
import {
  transferWithAuthorizationABI,
  X402_PERMIT2_PROXY_ADDRESSES,
  x402ExactPermit2ProxyABI,
  X402_UPTO_PERMIT2_PROXY_ADDRESSES,
  x402UptoPermit2ProxyABI,
} from "./constants";
import {
  DEFAULT_RECEIPT_QUERY_TIMEOUT_MS,
  type FacilitatorTronSigner,
  type TronTransactionReceipt,
} from "./signer";
import {
  type ExactEIP3009Payload,
  type ExactGasFreePayload,
  type ExactPermit2Payload,
  type UptoPermit2Payload,
  isPermit2Payload,
  isUptoPermit2Payload,
} from "./types";
import { normalizeAddressForSigning } from "./utils";
import { readAndReturnSettleResponse } from "./shared/settleReceipt";
import { getGasFreeControllerAddress } from "./shared/gasfree/config";
import { batchSettlementABI } from "./shared/batch-settlement/abi";

const TRANSFER_EVENT_TOPIC = "ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const SETTLED_EVENT_TOPIC = tronUtils.ethersUtils
  .keccak256(tronUtils.ethersUtils.toUtf8Bytes("Settled(address,address,address,uint128)"))
  .replace(/^0x/i, "")
  .toLowerCase();
const MAX_RECEIPT_QUERY_TIMEOUT_MS = 2_147_483_647;

/** Stable terminal reason for a solidified transaction whose call/effect is wrong. */
export const INVALID_TRANSACTION_EFFECT = "invalid_transaction_effect";

/** Current durable reconciliation-context schema version. */
export const TRON_SETTLEMENT_RECONCILIATION_CONTEXT_VERSION = 1 as const;

/** Persistable versioned context required to reconcile an exact/upto TRON settlement. */
export interface TronExpectedCallV1 {
  readonly target: string;
  /** Omitted only when a third-party relayer controls the exact call encoding. */
  readonly calldataHash?: string;
}

export interface TronExpectedTransferV1 {
  readonly token: string;
  readonly from: string;
  readonly to: string;
  readonly amount: string;
}

/** Persistable exact/upto validation context. */
export interface TronDirectSettlementReconciliationContextV1 {
  readonly version: typeof TRON_SETTLEMENT_RECONCILIATION_CONTEXT_VERSION;
  readonly scheme: "exact" | "upto";
  readonly transferMethod: "eip3009" | "permit2";
  readonly network: PaymentRequirements["network"];
  readonly payer: string;
  readonly asset: string;
  readonly payTo: string;
  readonly amount: string;
  readonly call: TronExpectedCallV1 & { readonly calldataHash: string };
  readonly transfer: TronExpectedTransferV1;
}

/** Persistable GasFree validation context. */
export interface TronGasFreeSettlementReconciliationContextV1 {
  readonly version: typeof TRON_SETTLEMENT_RECONCILIATION_CONTEXT_VERSION;
  readonly scheme: "exact_gasfree";
  readonly network: PaymentRequirements["network"];
  readonly payer: string;
  readonly asset: string;
  readonly payTo: string;
  /** Required payment amount; the signed transfer can intentionally be larger. */
  readonly amount: string;
  readonly call: TronExpectedCallV1;
  readonly transfer: TronExpectedTransferV1;
}

export type TronBatchSettlementOperation = "deposit" | "claim" | "settle" | "refund";

export type TronBatchSettlementExpectedEffectV1 =
  | { readonly type: "none" }
  | { readonly type: "transfer"; readonly transfer: TronExpectedTransferV1 }
  | {
      readonly type: "settled";
      readonly contract: string;
      readonly receiver: string;
      readonly token: string;
    };

/** Persistable validation context for one broadcast batch-settlement action. */
export interface TronBatchSettlementReconciliationContextV1 {
  readonly version: typeof TRON_SETTLEMENT_RECONCILIATION_CONTEXT_VERSION;
  readonly scheme: "batch-settlement";
  readonly operation: TronBatchSettlementOperation;
  readonly network: PaymentRequirements["network"];
  readonly payer?: string;
  readonly asset?: string;
  readonly payTo?: string;
  readonly amount?: string;
  readonly call: TronExpectedCallV1 & { readonly calldataHash: string };
  readonly effect: TronBatchSettlementExpectedEffectV1;
}

export type TronSettlementReconciliationContextV1 =
  | TronDirectSettlementReconciliationContextV1
  | TronGasFreeSettlementReconciliationContextV1
  | TronBatchSettlementReconciliationContextV1;

export type TronSettlementReconciliationContext = TronSettlementReconciliationContextV1;

/** Per-attempt bounds controlled by the reconciliation worker. */
export interface TronReconciliationOptions {
  /** Maximum duration of this single solidified receipt/body query. Defaults to 10 seconds. */
  readonly timeoutMs?: number;
  /** Cancels the in-flight query during worker shutdown. */
  readonly signal?: AbortSignal;
}

/** Three-state receipt assessment required to avoid terminalizing incomplete RPC data. */
export type TronSettlementReceiptAssessment =
  | { readonly status: "match"; readonly amount?: string }
  | { readonly status: "definite_mismatch" }
  | { readonly status: "indeterminate"; readonly reason: string };

export interface CreateTronBatchSettlementReconciliationContextOptions {
  readonly operation: TronBatchSettlementOperation;
  readonly network: PaymentRequirements["network"];
  readonly payer?: string;
  readonly asset?: string;
  readonly payTo?: string;
  readonly amount?: string;
  readonly target: string;
  readonly functionName: string;
  readonly args: readonly unknown[];
  readonly effect: TronBatchSettlementExpectedEffectV1;
}

type UnknownRecord = Record<string, unknown>;

/**
 * Read a non-array object from an untrusted persisted value.
 *
 * @param value - Value to inspect.
 * @param path - Diagnostic path for validation errors.
 * @returns The parsed record.
 */
function parseObject(value: unknown, path: string): UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`invalid TRON reconciliation context: ${path} must be an object`);
  }
  return value as UnknownRecord;
}

/**
 * Read a required non-empty string from an untrusted object.
 *
 * @param object - Object containing the field.
 * @param key - Field name.
 * @param path - Diagnostic path for validation errors.
 * @returns The parsed string.
 */
function parseString(object: UnknownRecord, key: string, path = key): string {
  const value = object[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`invalid TRON reconciliation context: ${path} must be a non-empty string`);
  }
  return value;
}

/**
 * Read and canonicalize an EVM/TRON address from an untrusted object.
 *
 * @param object - Object containing the field.
 * @param key - Field name.
 * @param path - Diagnostic path for validation errors.
 * @returns A canonical EVM-form address.
 */
function parseAddress(object: UnknownRecord, key: string, path = key): string {
  const value = parseString(object, key, path);
  let normalized: string;
  try {
    normalized = normalizeAddressForSigning(value);
  } catch {
    throw new Error(`invalid TRON reconciliation context: ${path} must be a TRON address`);
  }
  if (!/^0x[0-9a-f]{40}$/.test(normalized)) {
    throw new Error(`invalid TRON reconciliation context: ${path} must be a TRON address`);
  }
  return normalized;
}

/**
 * Read a base-10 unsigned integer string from an untrusted object.
 *
 * @param object - Object containing the field.
 * @param key - Field name.
 * @param path - Diagnostic path for validation errors.
 * @returns The validated decimal string.
 */
function parseAmount(object: UnknownRecord, key: string, path = key): string {
  const value = parseString(object, key, path);
  if (!/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`invalid TRON reconciliation context: ${path} must be an unsigned integer`);
  }
  return value;
}

/**
 * Read a TRON CAIP-2 network identifier from an untrusted object.
 *
 * @param object - Object containing the network field.
 * @returns The validated network identifier.
 */
function parseNetwork(object: UnknownRecord): PaymentRequirements["network"] {
  const network = parseString(object, "network");
  if (!/^tron:[^\s:]+$/.test(network)) {
    throw new Error("invalid TRON reconciliation context: network must use tron:* CAIP-2 format");
  }
  return network as PaymentRequirements["network"];
}

/**
 * Read a 32-byte prefixed hexadecimal digest from an untrusted object.
 *
 * @param object - Object containing the field.
 * @param key - Field name.
 * @param path - Diagnostic path for validation errors.
 * @returns The normalized digest.
 */
function parseDigest(object: UnknownRecord, key: string, path = key): string {
  const value = parseString(object, key, path).toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(value)) {
    throw new Error(`invalid TRON reconciliation context: ${path} must be a 32-byte hex digest`);
  }
  return value;
}

/**
 * Parse the expected top-level contract call.
 *
 * @param value - Untrusted call value.
 * @param requireCalldataHash - Whether calldataHash is mandatory.
 * @returns The validated call expectation.
 */
function parseExpectedCall(value: unknown, requireCalldataHash: boolean): TronExpectedCallV1 {
  const call = parseObject(value, "call");
  const target = parseAddress(call, "target", "call.target");
  if (call.calldataHash === undefined) {
    if (requireCalldataHash) {
      throw new Error("invalid TRON reconciliation context: call.calldataHash is required");
    }
    return { target };
  }
  return {
    target,
    calldataHash: parseDigest(call, "calldataHash", "call.calldataHash"),
  };
}

/**
 * Parse one expected TRC-20 Transfer effect.
 *
 * @param value - Untrusted transfer value.
 * @param path - Diagnostic path for validation errors.
 * @returns The validated transfer expectation.
 */
function parseExpectedTransfer(value: unknown, path = "transfer"): TronExpectedTransferV1 {
  const transfer = parseObject(value, path);
  return {
    token: parseAddress(transfer, "token", `${path}.token`),
    from: parseAddress(transfer, "from", `${path}.from`),
    to: parseAddress(transfer, "to", `${path}.to`),
    amount: parseAmount(transfer, "amount", `${path}.amount`),
  };
}

/**
 * Parse optional common batch metadata while retaining only known fields.
 *
 * @param context - Untrusted batch context.
 * @returns Validated optional batch metadata.
 */
function parseBatchMetadata(
  context: UnknownRecord,
): Pick<TronBatchSettlementReconciliationContextV1, "payer" | "asset" | "payTo" | "amount"> {
  return {
    ...(context.payer !== undefined ? { payer: parseAddress(context, "payer") } : {}),
    ...(context.asset !== undefined ? { asset: parseAddress(context, "asset") } : {}),
    ...(context.payTo !== undefined ? { payTo: parseAddress(context, "payTo") } : {}),
    ...(context.amount !== undefined ? { amount: parseAmount(context, "amount") } : {}),
  };
}

/**
 * Parse and validate a reconciliation context loaded from JSON or durable storage.
 *
 * The parser rejects unknown schema versions before any chain read and returns a
 * canonical copy containing only version-1 SDK fields.
 *
 * @param value - Untrusted persisted reconciliation context.
 * @returns A validated version-1 scheme-aware context.
 */
export function parseTronSettlementReconciliationContext(
  value: unknown,
): TronSettlementReconciliationContextV1 {
  const context = parseObject(value, "context");
  if (context.version !== TRON_SETTLEMENT_RECONCILIATION_CONTEXT_VERSION) {
    throw new Error(`unsupported TRON reconciliation context version: ${String(context.version)}`);
  }

  const scheme = parseString(context, "scheme");
  const network = parseNetwork(context);

  if (scheme === "batch-settlement") {
    const operation = parseString(context, "operation");
    if (
      operation !== "deposit" &&
      operation !== "claim" &&
      operation !== "settle" &&
      operation !== "refund"
    ) {
      throw new Error(`invalid TRON reconciliation context: unsupported operation ${operation}`);
    }

    const effect = parseObject(context.effect, "effect");
    const effectType = parseString(effect, "type", "effect.type");
    let parsedEffect: TronBatchSettlementExpectedEffectV1;
    if (effectType === "none") {
      parsedEffect = { type: "none" };
    } else if (effectType === "transfer") {
      parsedEffect = {
        type: "transfer",
        transfer: parseExpectedTransfer(effect.transfer, "effect.transfer"),
      };
    } else if (effectType === "settled") {
      parsedEffect = {
        type: "settled",
        contract: parseAddress(effect, "contract", "effect.contract"),
        receiver: parseAddress(effect, "receiver", "effect.receiver"),
        token: parseAddress(effect, "token", "effect.token"),
      };
    } else {
      throw new Error(`invalid TRON reconciliation context: unsupported effect ${effectType}`);
    }

    const parsedOperation: TronBatchSettlementOperation = operation;
    const metadata = parseBatchMetadata(context);
    const call = parseExpectedCall(context.call, true) as TronExpectedCallV1 & {
      readonly calldataHash: string;
    };
    const expectedEffectType = {
      deposit: "transfer",
      claim: "none",
      settle: "settled",
      refund: "transfer",
    }[parsedOperation];
    if (parsedEffect.type !== expectedEffectType) {
      throw new Error(
        `invalid TRON reconciliation context: ${parsedOperation} requires ${expectedEffectType} effect`,
      );
    }

    if (parsedOperation === "deposit" || parsedOperation === "refund") {
      if (!metadata.payer || !metadata.asset || !metadata.payTo || metadata.amount === undefined) {
        throw new Error(
          `invalid TRON reconciliation context: ${parsedOperation} metadata is incomplete`,
        );
      }
      if (
        parsedEffect.type !== "transfer" ||
        parsedEffect.transfer.token !== metadata.asset ||
        parsedEffect.transfer.amount !== metadata.amount ||
        (parsedOperation === "deposit" &&
          (parsedEffect.transfer.from !== metadata.payer ||
            parsedEffect.transfer.to !== call.target)) ||
        (parsedOperation === "refund" &&
          (parsedEffect.transfer.from !== call.target ||
            parsedEffect.transfer.to !== metadata.payer ||
            parsedEffect.transfer.to !== metadata.payTo))
      ) {
        throw new Error(
          `invalid TRON reconciliation context: ${parsedOperation} transfer metadata mismatch`,
        );
      }
    }

    if (parsedOperation === "settle") {
      if (!metadata.asset || !metadata.payTo) {
        throw new Error("invalid TRON reconciliation context: settle metadata is incomplete");
      }
      if (
        parsedEffect.type !== "settled" ||
        parsedEffect.contract !== call.target ||
        parsedEffect.receiver !== metadata.payTo ||
        parsedEffect.token !== metadata.asset
      ) {
        throw new Error("invalid TRON reconciliation context: settle effect metadata mismatch");
      }
    }

    return {
      version: TRON_SETTLEMENT_RECONCILIATION_CONTEXT_VERSION,
      scheme,
      operation: parsedOperation,
      network,
      ...metadata,
      call,
      effect: parsedEffect,
    };
  }

  if (scheme === "exact_gasfree") {
    const parsedContext: TronGasFreeSettlementReconciliationContextV1 = {
      version: TRON_SETTLEMENT_RECONCILIATION_CONTEXT_VERSION,
      scheme,
      network,
      payer: parseAddress(context, "payer"),
      asset: parseAddress(context, "asset"),
      payTo: parseAddress(context, "payTo"),
      amount: parseAmount(context, "amount"),
      call: parseExpectedCall(context.call, false),
      transfer: parseExpectedTransfer(context.transfer),
    };
    if (
      parsedContext.transfer.token !== parsedContext.asset ||
      parsedContext.transfer.to !== parsedContext.payTo ||
      BigInt(parsedContext.transfer.amount) < BigInt(parsedContext.amount)
    ) {
      throw new Error(
        "invalid TRON reconciliation context: exact_gasfree transfer metadata mismatch",
      );
    }
    return parsedContext;
  }

  if (scheme === "exact" || scheme === "upto") {
    const transferMethod = parseString(context, "transferMethod");
    if (
      (scheme === "exact" && transferMethod !== "eip3009" && transferMethod !== "permit2") ||
      (scheme === "upto" && transferMethod !== "permit2")
    ) {
      throw new Error(
        `invalid TRON reconciliation context: unsupported ${scheme} transfer method ${transferMethod}`,
      );
    }

    const parsedContext: TronDirectSettlementReconciliationContextV1 = {
      version: TRON_SETTLEMENT_RECONCILIATION_CONTEXT_VERSION,
      scheme,
      transferMethod: transferMethod as "eip3009" | "permit2",
      network,
      payer: parseAddress(context, "payer"),
      asset: parseAddress(context, "asset"),
      payTo: parseAddress(context, "payTo"),
      amount: parseAmount(context, "amount"),
      call: parseExpectedCall(context.call, true) as TronExpectedCallV1 & {
        readonly calldataHash: string;
      },
      transfer: parseExpectedTransfer(context.transfer),
    };
    if (
      parsedContext.transfer.token !== parsedContext.asset ||
      parsedContext.transfer.from !== parsedContext.payer ||
      parsedContext.transfer.to !== parsedContext.payTo ||
      parsedContext.transfer.amount !== parsedContext.amount
    ) {
      throw new Error(`invalid TRON reconciliation context: ${scheme} transfer metadata mismatch`);
    }
    return parsedContext;
  }

  throw new Error(`invalid TRON reconciliation context: unsupported scheme ${scheme}`);
}

/**
 * Encode expected calldata and retain only its hash in the durable context.
 *
 * @param abi - Contract ABI containing the called function.
 * @param functionName - Function name to encode.
 * @param args - Exact positional arguments submitted on-chain.
 * @returns Keccak-256 hash of the encoded calldata.
 */
function calldataHash(
  abi: readonly Record<string, unknown>[],
  functionName: string,
  args: readonly unknown[],
): string {
  const iface = new tronUtils.ethersUtils.Interface(abi);
  return tronUtils.ethersUtils.keccak256(iface.encodeFunctionData(functionName, [...args]));
}

/**
 * Normalize raw event-log addresses, which omit TRON's `41` network prefix.
 *
 * @param address - Raw log, TRON hex, Base58Check, or EVM address.
 * @returns Lowercase EVM-form address.
 */
function normalizeChainAddress(address: string): string {
  const clean = address.replace(/^0x/i, "").toLowerCase();
  if (/^[0-9a-f]{40}$/.test(clean)) return `0x${clean}`;
  return normalizeAddressForSigning(address);
}

/**
 * Normalize a hexadecimal byte string for comparisons and hashing.
 *
 * @param value - Prefixed or unprefixed hexadecimal bytes.
 * @returns Lowercase `0x`-prefixed bytes.
 */
function normalizeHex(value: string): string {
  const clean = value.replace(/^0x/i, "").toLowerCase();
  if (!/^[0-9a-f]+$/.test(clean) || clean.length % 2 !== 0) {
    throw new Error("incomplete transaction calldata");
  }
  return `0x${clean}`;
}

/**
 * Normalize all address fields in a persisted batch effect.
 *
 * @param effect - Batch effect supplied by the broadcast path.
 * @returns Effect with canonical EVM-form addresses.
 */
function normalizeBatchEffect(
  effect: TronBatchSettlementExpectedEffectV1,
): TronBatchSettlementExpectedEffectV1 {
  if (effect.type === "none") return effect;
  if (effect.type === "settled") {
    return {
      type: "settled",
      contract: normalizeAddressForSigning(effect.contract),
      receiver: normalizeAddressForSigning(effect.receiver),
      token: normalizeAddressForSigning(effect.token),
    };
  }
  return {
    type: "transfer",
    transfer: {
      token: normalizeAddressForSigning(effect.transfer.token),
      from: normalizeAddressForSigning(effect.transfer.from),
      to: normalizeAddressForSigning(effect.transfer.to),
      amount: effect.transfer.amount,
    },
  };
}

/**
 * Build the expected EIP-3009 call exactly as the settlement path submits it.
 *
 * @param payload - Signed EIP-3009 payment payload.
 * @returns ABI-ordered transferWithAuthorization arguments.
 */
function eip3009Call(payload: ExactEIP3009Payload): readonly unknown[] {
  const signature = payload.signature;
  const cleanSignature = signature?.replace(/^0x/i, "") ?? "";
  if (!/^[0-9a-fA-F]{130}$/.test(cleanSignature)) {
    throw new Error("invalid EIP-3009 signature for reconciliation context");
  }
  return [
    normalizeAddressForSigning(payload.authorization.from),
    normalizeAddressForSigning(payload.authorization.to),
    BigInt(payload.authorization.value),
    BigInt(payload.authorization.validAfter),
    BigInt(payload.authorization.validBefore),
    payload.authorization.nonce,
    Number.parseInt(cleanSignature.slice(128, 130), 16),
    `0x${cleanSignature.slice(0, 64)}`,
    `0x${cleanSignature.slice(64, 128)}`,
  ];
}

/**
 * Build the expected exact Permit2 proxy call.
 *
 * @param payload - Signed exact Permit2 payment payload.
 * @returns ABI-ordered exact proxy arguments.
 */
function exactPermit2Call(payload: ExactPermit2Payload): readonly unknown[] {
  const authorization = payload.permit2Authorization;
  return [
    [
      [
        normalizeAddressForSigning(authorization.permitted.token),
        BigInt(authorization.permitted.amount),
      ],
      BigInt(authorization.nonce),
      BigInt(authorization.deadline),
    ],
    normalizeAddressForSigning(authorization.from),
    [
      normalizeAddressForSigning(authorization.witness.to),
      BigInt(authorization.witness.validAfter),
    ],
    payload.signature,
  ];
}

/**
 * Build the expected upto Permit2 proxy call.
 *
 * @param payload - Signed upto Permit2 payment payload.
 * @param settlementAmount - Actual amount selected for settlement.
 * @returns ABI-ordered upto proxy arguments.
 */
function uptoPermit2Call(
  payload: UptoPermit2Payload,
  settlementAmount: string,
): readonly unknown[] {
  const authorization = payload.permit2Authorization;
  return [
    [
      [
        normalizeAddressForSigning(authorization.permitted.token),
        BigInt(authorization.permitted.amount),
      ],
      BigInt(authorization.nonce),
      BigInt(authorization.deadline),
    ],
    BigInt(settlementAmount),
    normalizeAddressForSigning(authorization.from),
    [
      normalizeAddressForSigning(authorization.witness.to),
      normalizeAddressForSigning(authorization.witness.facilitator),
      BigInt(authorization.witness.validAfter),
    ],
    payload.signature,
  ];
}

/**
 * Create the versioned, persistable validation context for a TRON settlement.
 *
 * The context contains no private key and stores only a hash of calldata. It is
 * safe to persist alongside a pending txid and is sufficient to validate the
 * solidified target call and token-transfer effect without rebroadcasting.
 *
 * @param paymentPayload - Original signed payment payload.
 * @param requirements - Exact, upto, or exact_gasfree requirements used for settlement.
 * @returns Versioned validation context suitable for durable storage.
 */
export function createTronSettlementReconciliationContext(
  paymentPayload: PaymentPayload,
  requirements: PaymentRequirements,
): TronSettlementReconciliationContext {
  if (paymentPayload.accepted.scheme !== requirements.scheme) {
    throw new Error("payment/reconciliation scheme mismatch");
  }
  if (paymentPayload.accepted.network !== requirements.network) {
    throw new Error("payment/reconciliation network mismatch");
  }

  const rawPayload = paymentPayload.payload as Record<string, unknown>;

  if (requirements.scheme === "exact_gasfree") {
    const gasfreePayload = rawPayload as ExactGasFreePayload;
    if (!gasfreePayload.gasfree || !gasfreePayload.gasfreeAddress) {
      throw new Error("unsupported exact_gasfree TRON payload");
    }
    const message = gasfreePayload.gasfree;
    const asset = normalizeAddressForSigning(requirements.asset);
    const payTo = normalizeAddressForSigning(requirements.payTo);
    if (normalizeAddressForSigning(message.token) !== asset) {
      throw new Error("payment/reconciliation asset mismatch");
    }
    if (normalizeAddressForSigning(message.receiver) !== payTo) {
      throw new Error("payment/reconciliation recipient mismatch");
    }
    if (BigInt(message.value) < BigInt(requirements.amount)) {
      throw new Error("payment/reconciliation amount mismatch");
    }

    return {
      version: TRON_SETTLEMENT_RECONCILIATION_CONTEXT_VERSION,
      scheme: "exact_gasfree",
      network: requirements.network,
      payer: normalizeAddressForSigning(message.user),
      asset,
      payTo,
      amount: requirements.amount,
      call: {
        target: normalizeAddressForSigning(getGasFreeControllerAddress(requirements.network)),
      },
      transfer: {
        token: asset,
        from: normalizeAddressForSigning(gasfreePayload.gasfreeAddress),
        to: payTo,
        amount: message.value,
      },
    };
  }

  let transferMethod: "eip3009" | "permit2";
  let payer: string;
  let transferFrom: string;
  let transferTo: string;
  let target: string;
  let expectedCalldataHash: string;

  if (requirements.scheme === "exact") {
    if (isPermit2Payload(rawPayload as never)) {
      const permit2Payload = rawPayload as ExactPermit2Payload;
      transferMethod = "permit2";
      payer = permit2Payload.permit2Authorization.from;
      transferFrom = payer;
      transferTo = permit2Payload.permit2Authorization.witness.to;
      target = X402_PERMIT2_PROXY_ADDRESSES[requirements.network]!;
      if (!target)
        throw new Error(`exact Permit2 proxy not configured for ${requirements.network}`);
      expectedCalldataHash = calldataHash(
        x402ExactPermit2ProxyABI as unknown as readonly Record<string, unknown>[],
        "settle",
        exactPermit2Call(permit2Payload),
      );
    } else {
      const eip3009Payload = rawPayload as ExactEIP3009Payload;
      if (!eip3009Payload.authorization) throw new Error("unsupported exact TRON payload");
      transferMethod = "eip3009";
      payer = eip3009Payload.authorization.from;
      transferFrom = payer;
      transferTo = eip3009Payload.authorization.to;
      target = requirements.asset;
      expectedCalldataHash = calldataHash(
        transferWithAuthorizationABI as unknown as readonly Record<string, unknown>[],
        "transferWithAuthorization",
        eip3009Call(eip3009Payload),
      );
    }
  } else if (requirements.scheme === "upto" && isUptoPermit2Payload(rawPayload)) {
    const permit2Payload = rawPayload as UptoPermit2Payload;
    transferMethod = "permit2";
    payer = permit2Payload.permit2Authorization.from;
    transferFrom = payer;
    transferTo = permit2Payload.permit2Authorization.witness.to;
    target = X402_UPTO_PERMIT2_PROXY_ADDRESSES[requirements.network]!;
    if (!target) throw new Error(`upto Permit2 proxy not configured for ${requirements.network}`);
    expectedCalldataHash = calldataHash(
      x402UptoPermit2ProxyABI as unknown as readonly Record<string, unknown>[],
      "settle",
      uptoPermit2Call(permit2Payload, requirements.amount),
    );
  } else {
    throw new Error(`unsupported TRON reconciliation scheme: ${requirements.scheme}`);
  }

  const asset = normalizeAddressForSigning(requirements.asset);
  const payTo = normalizeAddressForSigning(requirements.payTo);
  if (normalizeAddressForSigning(transferTo) !== payTo) {
    throw new Error("payment/reconciliation recipient mismatch");
  }

  return {
    version: TRON_SETTLEMENT_RECONCILIATION_CONTEXT_VERSION,
    scheme: requirements.scheme,
    transferMethod,
    network: requirements.network,
    payer: normalizeAddressForSigning(payer),
    asset,
    payTo,
    amount: requirements.amount,
    call: {
      target: normalizeAddressForSigning(target),
      calldataHash: expectedCalldataHash.toLowerCase(),
    },
    transfer: {
      token: asset,
      from: normalizeAddressForSigning(transferFrom),
      to: payTo,
      amount: requirements.amount,
    },
  };
}

/**
 * Create a durable context from the exact batch-settlement call being broadcast.
 *
 * The caller supplies the finalized call arguments, including any signature
 * generated by a facilitator authorizer. Only the calldata hash is retained.
 *
 * @param options - Final batch call and its expected on-chain effect.
 * @returns Versioned batch-settlement reconciliation context.
 */
export function createTronBatchSettlementReconciliationContext(
  options: CreateTronBatchSettlementReconciliationContextOptions,
): TronBatchSettlementReconciliationContextV1 {
  const contract = normalizeAddressForSigning(options.target);

  return {
    version: TRON_SETTLEMENT_RECONCILIATION_CONTEXT_VERSION,
    scheme: "batch-settlement",
    operation: options.operation,
    network: options.network,
    ...(options.payer !== undefined ? { payer: normalizeAddressForSigning(options.payer) } : {}),
    ...(options.asset !== undefined ? { asset: normalizeAddressForSigning(options.asset) } : {}),
    ...(options.payTo !== undefined ? { payTo: normalizeAddressForSigning(options.payTo) } : {}),
    ...(options.amount !== undefined ? { amount: options.amount } : {}),
    call: {
      target: contract,
      calldataHash: calldataHash(
        batchSettlementABI as unknown as readonly Record<string, unknown>[],
        options.functionName,
        options.args,
      ).toLowerCase(),
    },
    effect: normalizeBatchEffect(options.effect),
  };
}

const MATCH: TronSettlementReceiptAssessment = { status: "match" };
const DEFINITE_MISMATCH: TronSettlementReceiptAssessment = {
  status: "definite_mismatch",
};

/**
 * Build an indeterminate assessment with a stable diagnostic.
 *
 * @param reason - Reason the receipt cannot yet be classified.
 * @returns Indeterminate receipt assessment.
 */
function indeterminate(reason: string): TronSettlementReceiptAssessment {
  return { status: "indeterminate", reason };
}

/**
 * Match the recovered top-level contract call without terminalizing missing data.
 *
 * @param receipt - Receipt carrying the recovered transaction body.
 * @param expected - Persisted target and optional calldata hash.
 * @returns Three-state call assessment.
 */
function assessCall(
  receipt: TronTransactionReceipt,
  expected: TronExpectedCallV1,
): TronSettlementReceiptAssessment {
  if (!receipt.call) return indeterminate("transaction call is unavailable");
  try {
    const target = normalizeChainAddress(receipt.call.contractAddress);
    const calldata = normalizeHex(receipt.call.data);
    if (target !== expected.target) return DEFINITE_MISMATCH;
    if (
      expected.calldataHash &&
      tronUtils.ethersUtils.keccak256(calldata).toLowerCase() !==
        expected.calldataHash.toLowerCase()
    ) {
      return DEFINITE_MISMATCH;
    }
    return MATCH;
  } catch {
    return indeterminate("transaction call data is incomplete");
  }
}

/**
 * Match one required TRC-20 Transfer event using explicit three-state semantics.
 *
 * @param receipt - Receipt logs to inspect.
 * @param expected - Persisted token transfer expectation.
 * @returns Three-state transfer assessment.
 */
function assessTransferLogs(
  receipt: TronTransactionReceipt,
  expected: TronExpectedTransferV1,
): TronSettlementReceiptAssessment {
  if (!receipt.logs) return indeterminate("solidified receipt logs are unavailable");
  let sawIncompleteLog = false;

  for (const log of receipt.logs) {
    const rawTopic0 = log.topics?.[0]?.replace(/^0x/i, "").toLowerCase();
    if (!rawTopic0 || !/^[0-9a-f]{64}$/.test(rawTopic0)) {
      sawIncompleteLog = true;
      continue;
    }
    if (rawTopic0 !== TRANSFER_EVENT_TOPIC) continue;
    if (!log.address || !log.topics || log.topics.length < 3 || !log.data) {
      sawIncompleteLog = true;
      continue;
    }

    try {
      const fromTopic = log.topics[1]!.replace(/^0x/i, "").toLowerCase();
      const toTopic = log.topics[2]!.replace(/^0x/i, "").toLowerCase();
      const data = log.data.replace(/^0x/i, "").toLowerCase();
      if (
        !/^[0-9a-f]{64}$/.test(fromTopic) ||
        !/^[0-9a-f]{64}$/.test(toTopic) ||
        !/^[0-9a-f]{64}$/.test(data)
      ) {
        sawIncompleteLog = true;
        continue;
      }

      if (
        normalizeChainAddress(log.address) === expected.token &&
        `0x${fromTopic.slice(-40)}` === expected.from &&
        `0x${toTopic.slice(-40)}` === expected.to &&
        BigInt(`0x${data}`) === BigInt(expected.amount)
      ) {
        return MATCH;
      }
    } catch {
      sawIncompleteLog = true;
    }
  }

  return sawIncompleteLog
    ? indeterminate("solidified receipt contains incomplete Transfer log data")
    : DEFINITE_MISMATCH;
}

/**
 * Match the batch contract's Settled event and recover its actual amount.
 *
 * @param receipt - Receipt logs to inspect.
 * @param expected - Persisted batch receiver/token expectation.
 * @returns Three-state event assessment with the settled amount on match.
 */
function assessSettledLogs(
  receipt: TronTransactionReceipt,
  expected: Extract<TronBatchSettlementExpectedEffectV1, { type: "settled" }>,
): TronSettlementReceiptAssessment {
  if (!receipt.logs) return indeterminate("solidified receipt logs are unavailable");
  let sawIncompleteLog = false;

  for (const log of receipt.logs) {
    const rawTopic0 = log.topics?.[0]?.replace(/^0x/i, "").toLowerCase();
    if (!rawTopic0 || !/^[0-9a-f]{64}$/.test(rawTopic0)) {
      sawIncompleteLog = true;
      continue;
    }
    if (rawTopic0 !== SETTLED_EVENT_TOPIC) continue;
    if (!log.address || !log.topics || log.topics.length < 4 || !log.data) {
      sawIncompleteLog = true;
      continue;
    }

    try {
      const receiverTopic = log.topics[1]!.replace(/^0x/i, "").toLowerCase();
      const tokenTopic = log.topics[2]!.replace(/^0x/i, "").toLowerCase();
      const senderTopic = log.topics[3]!.replace(/^0x/i, "").toLowerCase();
      const data = log.data.replace(/^0x/i, "").toLowerCase();
      if (
        !/^[0-9a-f]{64}$/.test(receiverTopic) ||
        !/^[0-9a-f]{64}$/.test(tokenTopic) ||
        !/^[0-9a-f]{64}$/.test(senderTopic) ||
        !/^[0-9a-f]{64}$/.test(data)
      ) {
        sawIncompleteLog = true;
        continue;
      }
      if (
        normalizeChainAddress(log.address) === expected.contract &&
        `0x${receiverTopic.slice(-40)}` === expected.receiver &&
        `0x${tokenTopic.slice(-40)}` === expected.token
      ) {
        return { status: "match", amount: BigInt(`0x${data}`).toString() };
      }
    } catch {
      sawIncompleteLog = true;
    }
  }

  return sawIncompleteLog
    ? indeterminate("solidified receipt contains incomplete Settled log data")
    : DEFINITE_MISMATCH;
}

/**
 * Assess a receipt as match, definite mismatch, or indeterminate.
 *
 * @param receipt - Successful packed or solidified receipt.
 * @param context - Persisted scheme-aware expectation.
 * @returns Three-state assessment; only a definite mismatch is terminal.
 */
function assessParsedTronSettlementReceipt(
  receipt: TronTransactionReceipt,
  context: TronSettlementReconciliationContext,
): TronSettlementReceiptAssessment {
  const callAssessment = assessCall(receipt, context.call);
  if (callAssessment.status !== "match") return callAssessment;

  if (context.scheme === "batch-settlement") {
    if (context.effect.type === "none") return MATCH;
    if (context.effect.type === "settled") {
      return assessSettledLogs(receipt, context.effect);
    }
    return assessTransferLogs(receipt, context.effect.transfer);
  }

  return assessTransferLogs(receipt, context.transfer);
}

/**
 * Assess a receipt as match, definite mismatch, or indeterminate.
 *
 * @param receipt - Successful packed or solidified receipt.
 * @param context - Persisted scheme-aware expectation.
 * @returns Three-state assessment; only a definite mismatch is terminal.
 */
export function assessTronSettlementReceipt(
  receipt: TronTransactionReceipt,
  context: unknown,
): TronSettlementReceiptAssessment {
  return assessParsedTronSettlementReceipt(
    receipt,
    parseTronSettlementReconciliationContext(context),
  );
}

/**
 * Validate a successful receipt against the persisted settlement expectation.
 * Missing data remains indeterminate (throws); an explicit mismatch is terminal.
 *
 * @param receipt - Successful packed or solidified receipt.
 * @param transaction - Original transaction id.
 * @param context - Persisted settlement validation context.
 * @returns Undefined on a match, or a terminal mismatch response.
 */
export function validateTronSettlementReceipt(
  receipt: TronTransactionReceipt,
  transaction: string,
  context: unknown,
): SettleResponse | undefined {
  const parsedContext = parseTronSettlementReconciliationContext(context);
  const assessment = assessParsedTronSettlementReceipt(receipt, parsedContext);
  if (assessment.status === "match") return undefined;
  if (assessment.status === "indeterminate") throw new Error(assessment.reason);

  return {
    success: false,
    errorReason: INVALID_TRANSACTION_EFFECT,
    transaction,
    network: parsedContext.network,
    payer: parsedContext.payer,
  };
}

/**
 * Resolve the strict time bound for one reconciliation query.
 *
 * @param value - Caller override, or undefined for the SDK default.
 * @returns Validated timeout in milliseconds.
 */
function resolveReconciliationTimeoutMs(value: number | undefined): number {
  const timeoutMs = value ?? DEFAULT_RECEIPT_QUERY_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > MAX_RECEIPT_QUERY_TIMEOUT_MS
  ) {
    throw new Error(
      `reconciliation timeoutMs must be a positive integer no greater than ${MAX_RECEIPT_QUERY_TIMEOUT_MS}, got ${timeoutMs}`,
    );
  }
  return timeoutMs;
}

/**
 * Reconcile an already-broadcast settlement with one solidified read attempt.
 *
 * This function never broadcasts, polls, sleeps, retries, or applies backoff.
 * The caller owns scheduling and may pass a per-attempt timeout/cancellation.
 *
 * @param signer - Signer exposing a one-shot receipt lookup.
 * @param transaction - Original transaction id.
 * @param context - Persisted scheme-specific validation context.
 * @param options - Per-attempt timeout and cancellation signal.
 * @returns Solidified terminal result, or settlement_pending while indeterminate.
 */
export async function reconcileTronSettlement(
  signer: Pick<FacilitatorTronSigner, "getTransactionReceipt">,
  transaction: string,
  context: unknown,
  options: TronReconciliationOptions = {},
): Promise<SettleResponse> {
  const parsedContext = parseTronSettlementReconciliationContext(context);
  let reconciledAmount =
    parsedContext.amount ??
    (parsedContext.scheme === "batch-settlement" && parsedContext.operation === "claim"
      ? ""
      : undefined);
  return readAndReturnSettleResponse(
    signer,
    transaction,
    parsedContext.network,
    parsedContext.payer,
    {
      finality: "solidified",
      timeoutMs: resolveReconciliationTimeoutMs(options.timeoutMs),
      ...(options.signal ? { signal: options.signal } : {}),
      responseExtra: { reconciliationContext: parsedContext },
      validateReceipt: receipt => {
        const assessment = assessParsedTronSettlementReceipt(receipt, parsedContext);
        if (assessment.status === "match") {
          reconciledAmount = assessment.amount ?? parsedContext.amount ?? reconciledAmount;
          return undefined;
        }
        if (assessment.status === "indeterminate") throw new Error(assessment.reason);
        return {
          success: false,
          errorReason: INVALID_TRANSACTION_EFFECT,
          transaction,
          network: parsedContext.network,
          payer: parsedContext.payer,
        };
      },
      onSuccess: () => ({
        success: true,
        transaction,
        network: parsedContext.network,
        payer: parsedContext.payer,
        ...(reconciledAmount !== undefined ? { amount: reconciledAmount } : {}),
      }),
    },
  );
}

/* eslint-disable jsdoc/require-jsdoc */
import { TronWeb, utils as tronUtils } from "tronweb";
import type { PaymentPayload, PaymentRequirements } from "@bankofai/x402-core/types";
import { PERMIT2_ADDRESSES } from "../../constants";
import { normalizeAddressForSigning } from "../../utils";
import {
  TRC20_APPROVAL_MAX_AMOUNT,
  TRC20_APPROVAL_RESOURCE_SPONSORING_VERSION,
  type Trc20ApprovalResourceSponsoringInfo,
  type Trc20ApprovalResourceSponsoringRequest,
} from "../extensions";

const APPROVE_SELECTOR = "095ea7b3";
const TRIGGER_SMART_CONTRACT_TYPE = 31n;
const TRIGGER_SMART_CONTRACT_TYPE_URL = "type.googleapis.com/protocol.TriggerSmartContract";
const SECP256K1_ORDER = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

export interface Trc20ApprovalValidationOptions {
  readonly nowMs?: number;
  readonly minRemainingMs?: number;
  readonly maxLifetimeMs?: number;
  readonly maxClockSkewMs?: number;
  readonly maxFeeLimitSun?: bigint;
  readonly allowedAssets?: readonly string[];
}

export interface DecodedTrc20Approval {
  readonly approvalTxID: string;
  readonly owner: string;
  readonly asset: string;
  readonly spender: string;
  readonly amount: string;
  readonly timestamp: bigint;
  readonly expiration: bigint;
  readonly feeLimit: bigint;
  readonly refBlockBytes: Uint8Array;
  readonly refBlockHash: Uint8Array;
  readonly signedTransactionBytes: Uint8Array;
}

export type Trc20ApprovalValidationResult =
  | { isValid: true; approval: DecodedTrc20Approval }
  | { isValid: false; invalidReason: string; invalidMessage?: string };

type ProtoValue = bigint | Uint8Array;
type ProtoField = { number: number; wireType: number; value: ProtoValue };

class ProtoReader {
  private offset = 0;

  constructor(private readonly bytes: Uint8Array) {}

  get done(): boolean {
    return this.offset === this.bytes.length;
  }

  readVarint(): bigint {
    const start = this.offset;
    let value = 0n;
    let shift = 0n;
    while (this.offset < this.bytes.length && this.offset - start < 10) {
      const byte = this.bytes[this.offset++];
      value |= BigInt(byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) {
        let minimalLength = 1;
        for (let n = value; n >= 0x80n; n >>= 7n) minimalLength += 1;
        if (this.offset - start !== minimalLength) {
          throw new Error("non-minimal protobuf varint");
        }
        return value;
      }
      shift += 7n;
    }
    throw new Error("invalid protobuf varint");
  }

  readBytes(): Uint8Array {
    const length = this.readVarint();
    if (length > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("protobuf field too large");
    const end = this.offset + Number(length);
    if (end > this.bytes.length) throw new Error("truncated protobuf field");
    const value = this.bytes.slice(this.offset, end);
    this.offset = end;
    return value;
  }

  readField(): ProtoField {
    const tag = this.readVarint();
    const number = Number(tag >> 3n);
    const wireType = Number(tag & 7n);
    if (!Number.isSafeInteger(number) || number <= 0) throw new Error("invalid protobuf tag");
    if (wireType === 0) return { number, wireType, value: this.readVarint() };
    if (wireType === 2) return { number, wireType, value: this.readBytes() };
    throw new Error(`unsupported protobuf wire type ${wireType}`);
  }
}

function parseFields(bytes: Uint8Array): ProtoField[] {
  const reader = new ProtoReader(bytes);
  const fields: ProtoField[] = [];
  while (!reader.done) fields.push(reader.readField());
  return fields;
}

function requireFields(
  fields: ProtoField[],
  allowed: Readonly<Record<number, number>>,
): Map<number, ProtoValue> {
  const result = new Map<number, ProtoValue>();
  for (const field of fields) {
    if (allowed[field.number] !== field.wireType) {
      throw new Error(`unsupported protobuf field ${field.number}`);
    }
    if (result.has(field.number)) throw new Error(`duplicate protobuf field ${field.number}`);
    result.set(field.number, field.value);
  }
  return result;
}

function bytesField(fields: Map<number, ProtoValue>, number: number, label: string): Uint8Array {
  const value = fields.get(number);
  if (!(value instanceof Uint8Array)) throw new Error(`missing ${label}`);
  return value;
}

function uintField(fields: Map<number, ProtoValue>, number: number, label: string): bigint {
  const value = fields.get(number);
  if (typeof value !== "bigint") throw new Error(`missing ${label}`);
  return value;
}

function bytesToHex(bytes: Uint8Array): string {
  return tronUtils.code.byteArray2hexStr(bytes).toLowerCase();
}

function addressFromBytes(bytes: Uint8Array, label: string): string {
  if (bytes.length !== 21 || bytes[0] !== 0x41) throw new Error(`invalid ${label}`);
  return TronWeb.address.fromHex(bytesToHex(bytes));
}

function normalizeTronAddress(address: string): string {
  const hex = TronWeb.address.toHex(address).toLowerCase();
  if (!/^41[0-9a-f]{40}$/.test(hex)) throw new Error("invalid TRON address");
  return hex;
}

interface SignedEnvelope {
  rawData: Uint8Array;
  signatureHex: string;
  signedTransactionBytes: Uint8Array;
}

interface RawApprovalData {
  contractBytes: Uint8Array;
  timestamp: bigint;
  expiration: bigint;
  feeLimit: bigint;
  refBlockBytes: Uint8Array;
  refBlockHash: Uint8Array;
}

interface ApprovalCall {
  owner: string;
  asset: string;
  spender: string;
}

function validateSignatureEncoding(signature: Uint8Array): string {
  if (signature.length !== 65) throw new Error("Approval requires one 65-byte signature");
  const signatureHex = bytesToHex(signature);
  const r = BigInt(`0x${signatureHex.slice(0, 64)}`);
  const s = BigInt(`0x${signatureHex.slice(64, 128)}`);
  const recovery = signature[64];
  if (
    r <= 0n ||
    r >= SECP256K1_ORDER ||
    s <= 0n ||
    s > SECP256K1_ORDER / 2n ||
    (recovery !== 27 && recovery !== 28)
  ) {
    throw new Error("invalid Approval signature encoding");
  }
  return signatureHex;
}

function decodeSignedEnvelope(signedTransaction: string): SignedEnvelope {
  if (!/^(?:[0-9a-f]{2})+$/.test(signedTransaction) || signedTransaction.length > 16384) {
    throw new Error("invalid signedTransaction encoding");
  }
  const signedTransactionBytes = Uint8Array.from(
    tronUtils.code.hexStr2byteArray(signedTransaction),
  );
  const outer = requireFields(parseFields(signedTransactionBytes), { 1: 2, 2: 2 });
  return {
    rawData: bytesField(outer, 1, "raw_data"),
    signatureHex: validateSignatureEncoding(bytesField(outer, 2, "signature")),
    signedTransactionBytes,
  };
}

function decodeRawApprovalData(rawData: Uint8Array): RawApprovalData {
  const raw = requireFields(parseFields(rawData), {
    1: 2,
    4: 2,
    8: 0,
    11: 2,
    14: 0,
    18: 0,
  });
  const refBlockBytes = bytesField(raw, 1, "ref_block_bytes");
  const refBlockHash = bytesField(raw, 4, "ref_block_hash");
  if (refBlockBytes.length !== 2 || refBlockHash.length !== 8) {
    throw new Error("invalid TAPOS fields");
  }
  return {
    contractBytes: bytesField(raw, 11, "contract"),
    timestamp: uintField(raw, 14, "timestamp"),
    expiration: uintField(raw, 8, "expiration"),
    feeLimit: uintField(raw, 18, "fee_limit"),
    refBlockBytes,
    refBlockHash,
  };
}

function decodeApprovalCall(contractBytes: Uint8Array): ApprovalCall {
  const contract = requireFields(parseFields(contractBytes), { 1: 0, 2: 2 });
  if (uintField(contract, 1, "contract type") !== TRIGGER_SMART_CONTRACT_TYPE) {
    throw new Error("contract is not TriggerSmartContract");
  }
  const any = requireFields(parseFields(bytesField(contract, 2, "contract parameter")), {
    1: 2,
    2: 2,
  });
  const typeUrl = new TextDecoder().decode(bytesField(any, 1, "type_url"));
  if (typeUrl !== TRIGGER_SMART_CONTRACT_TYPE_URL) throw new Error("invalid contract type_url");
  const trigger = requireFields(parseFields(bytesField(any, 2, "contract value")), {
    1: 2,
    2: 2,
    4: 2,
  });
  const calldata = bytesField(trigger, 4, "calldata");
  if (calldata.length !== 68 || bytesToHex(calldata.slice(0, 4)) !== APPROVE_SELECTOR) {
    throw new Error("invalid approve calldata");
  }
  if (calldata.slice(4, 16).some(byte => byte !== 0)) {
    throw new Error("non-canonical approve spender");
  }
  if (calldata.slice(36, 68).some(byte => byte !== 0xff)) {
    throw new Error("Approval amount is not MaxUint256");
  }
  return {
    owner: addressFromBytes(bytesField(trigger, 1, "owner_address"), "owner_address"),
    asset: addressFromBytes(bytesField(trigger, 2, "contract_address"), "contract_address"),
    spender: TronWeb.address.fromHex(`41${bytesToHex(calldata.slice(16, 36))}`),
  };
}

function authenticateApproval(rawData: Uint8Array, signatureHex: string, owner: string): string {
  const approvalTxID = bytesToHex(Uint8Array.from(tronUtils.crypto.SHA256(rawData)));
  const recovered = TronWeb.address.fromHex(tronUtils.crypto.ecRecover(approvalTxID, signatureHex));
  if (normalizeTronAddress(recovered) !== normalizeTronAddress(owner)) {
    throw new Error("Approval signer does not match owner");
  }
  return approvalTxID;
}

/**
 * Decodes the strict version 1 signed Approval transaction.
 *
 * @param signedTransaction - Complete signed TRON Transaction protobuf hex.
 * @returns Decoded, authenticated Approval fields.
 */
export function decodeSignedTrc20Approval(signedTransaction: string): DecodedTrc20Approval {
  const envelope = decodeSignedEnvelope(signedTransaction);
  const raw = decodeRawApprovalData(envelope.rawData);
  const call = decodeApprovalCall(raw.contractBytes);
  return {
    approvalTxID: authenticateApproval(envelope.rawData, envelope.signatureHex, call.owner),
    owner: call.owner,
    asset: call.asset,
    spender: call.spender,
    amount: TRC20_APPROVAL_MAX_AMOUNT,
    timestamp: raw.timestamp,
    expiration: raw.expiration,
    feeLimit: raw.feeLimit,
    refBlockBytes: raw.refBlockBytes,
    refBlockHash: raw.refBlockHash,
    signedTransactionBytes: envelope.signedTransactionBytes,
  };
}

function validateApprovalBinding(
  info: Trc20ApprovalResourceSponsoringInfo,
  approval: DecodedTrc20Approval,
  payer: string,
  requirements: PaymentRequirements,
  allowedAssets?: readonly string[],
): void {
  const permit2 = PERMIT2_ADDRESSES[requirements.network];
  if (!permit2) throw new Error("Permit2 is not configured for the network");
  if (normalizeTronAddress(info.from) !== normalizeTronAddress(approval.owner)) {
    throw new Error("extension from does not match Approval owner");
  }
  if (normalizeAddressForSigning(payer) !== normalizeAddressForSigning(approval.owner)) {
    throw new Error("Payment payer does not match Approval owner");
  }
  const asset = normalizeTronAddress(approval.asset);
  if (
    normalizeTronAddress(info.asset) !== asset ||
    normalizeTronAddress(requirements.asset) !== asset
  ) {
    throw new Error("Approval asset does not match PaymentRequirements");
  }
  if (
    normalizeTronAddress(info.spender) !== normalizeTronAddress(approval.spender) ||
    normalizeTronAddress(permit2) !== normalizeTronAddress(approval.spender)
  ) {
    throw new Error("Approval spender is not canonical Permit2");
  }
  if (
    allowedAssets &&
    !allowedAssets.some(candidate => normalizeTronAddress(candidate) === asset)
  ) {
    throw new Error("Approval asset is not allowlisted");
  }
}

function validateApprovalTimePolicy(
  approval: DecodedTrc20Approval,
  options: Trc20ApprovalValidationOptions,
): void {
  const now = BigInt(options.nowMs ?? Date.now());
  const minRemaining = BigInt(options.minRemainingMs ?? 30_000);
  const maxLifetime = BigInt(options.maxLifetimeMs ?? 24 * 60 * 60 * 1000);
  const maxClockSkew = BigInt(options.maxClockSkewMs ?? 30_000);
  const maxFeeLimit = options.maxFeeLimitSun ?? 100_000_000n;
  if (approval.timestamp > now + maxClockSkew || approval.timestamp + maxLifetime < now) {
    throw new Error("Approval timestamp is outside local policy");
  }
  if (
    approval.expiration <= approval.timestamp ||
    approval.expiration - approval.timestamp > maxLifetime ||
    approval.expiration < now + minRemaining
  ) {
    throw new Error("Approval expiration is outside local policy");
  }
  if (approval.feeLimit <= 0n || approval.feeLimit > maxFeeLimit) {
    throw new Error("Approval fee_limit is outside local policy");
  }
}

/**
 * Validates a decoded Approval against the Payment and local safety bounds.
 *
 * @param info - Client-provided extension info.
 * @param payer - Authenticated Permit2 payer.
 * @param requirements - Trusted payment requirements.
 * @param options - Facilitator-local safety bounds.
 * @returns Validation result with decoded Approval on success.
 */
export function validateTrc20ApprovalForPayment(
  info: Trc20ApprovalResourceSponsoringInfo,
  payer: string,
  requirements: PaymentRequirements,
  options: Trc20ApprovalValidationOptions = {},
): Trc20ApprovalValidationResult {
  try {
    if (info.version !== TRC20_APPROVAL_RESOURCE_SPONSORING_VERSION) {
      throw new Error("unsupported extension version");
    }
    if (info.amount !== TRC20_APPROVAL_MAX_AMOUNT) throw new Error("invalid Approval amount");

    const approval = decodeSignedTrc20Approval(info.signedTransaction);
    validateApprovalBinding(info, approval, payer, requirements, options.allowedAssets);
    validateApprovalTimePolicy(approval, options);
    return { isValid: true, approval };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      isValid: false,
      invalidReason: message.includes("signer")
        ? "approval_signature_invalid"
        : "approval_semantics_invalid",
      invalidMessage: message,
    };
  }
}

/**
 * Builds the immutable request passed to the registered sponsorship runtime.
 *
 * @param info - Client extension info.
 * @param approval - Strictly decoded Approval.
 * @param payload - Complete x402 payment payload.
 * @param requirements - Trusted payment requirements.
 * @returns Runtime request bound to the Approval and Payment.
 */
export function buildTrc20ApprovalSponsoringRequest(
  info: Trc20ApprovalResourceSponsoringInfo,
  approval: DecodedTrc20Approval,
  payload: PaymentPayload,
  requirements: PaymentRequirements,
): Trc20ApprovalResourceSponsoringRequest {
  return {
    network: requirements.network,
    approvalTxID: approval.approvalTxID,
    approvalTimestamp: approval.timestamp.toString(),
    approvalExpiration: approval.expiration.toString(),
    approvalFeeLimitSun: approval.feeLimit.toString(),
    payer: approval.owner,
    asset: approval.asset,
    spender: approval.spender,
    amount: approval.amount,
    signedTransaction: info.signedTransaction,
    paymentPayload: payload,
    paymentRequirements: requirements,
  };
}

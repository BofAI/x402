/**
 * @file Facilitator-side helpers for the TRON batch-settlement scheme:
 * channel config normalization/validation, voucher verification, and onchain reads.
 */
import type { PaymentRequirements } from "@bankofai/x402-core/types";
import { FacilitatorTronSigner } from "../../signer";
import { normalizeAddressForSigning } from "../../utils";
import { batchSettlementABI } from "../../shared/batch-settlement/abi";
import {
  MIN_WITHDRAW_DELAY,
  MAX_WITHDRAW_DELAY,
  voucherTypes,
  getBatchSettlementAddress,
} from "../../shared/batch-settlement/constants";
import {
  computeChannelId,
  getBatchSettlementTip712Domain,
} from "../../shared/batch-settlement/utils";
import type {
  BatchSettlementPaymentRequirementsExtra,
  ChannelConfig,
  ChannelState,
} from "../types";
import * as Errors from "../errors";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const abi = batchSettlementABI as unknown as readonly Record<string, unknown>[];

/**
 * Coerce a contract read result (bigint, number, string, or BN-like) to bigint.
 *
 * @param value - The raw read result.
 * @returns The value as a bigint.
 */
export function toBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" || typeof value === "string") return BigInt(value);
  if (value && typeof (value as { toString?: () => string }).toString === "function") {
    return BigInt((value as { toString(): string }).toString());
  }
  return 0n;
}

/**
 * Read an indexed/named field from a TronWeb multi-output call result.
 *
 * @param result - Raw call result (array or object keyed by output name).
 * @param index - Positional index of the output.
 * @param name - Output name as defined in the ABI.
 * @returns The raw field value (unknown).
 */
function readField(result: unknown, index: number, name: string): unknown {
  if (Array.isArray(result)) return result[index];
  if (result && typeof result === "object") {
    const obj = result as Record<string, unknown>;
    if (name in obj) return obj[name];
    if (String(index) in obj) return obj[String(index)];
  }
  return result;
}

/**
 * Normalizes a {@link ChannelConfig} into the positional tuple expected by the
 * batch-settlement contract calls. Addresses are normalized to EVM hex, which
 * TronWeb's `triggerSmartContract` accepts for `address` parameters.
 *
 * TronWeb encodes tuples positionally (via ethers' AbiCoder), so the fields must
 * be an ABI-ordered array, not a named object.
 *
 * @param config - In-memory channel configuration.
 * @returns ABI-ordered channel config tuple
 *   `[payer, payerAuthorizer, receiver, receiverAuthorizer, token, withdrawDelay, salt]`.
 */
export function toContractChannelConfig(
  config: ChannelConfig,
): [string, string, string, string, string, number, `0x${string}`] {
  return [
    normalizeAddressForSigning(config.payer),
    normalizeAddressForSigning(config.payerAuthorizer),
    normalizeAddressForSigning(config.receiver),
    normalizeAddressForSigning(config.receiverAuthorizer),
    normalizeAddressForSigning(config.token),
    config.withdrawDelay,
    config.salt,
  ];
}

/**
 * Case-insensitive comparison of two channel id hex strings.
 *
 * @param a - First channel id.
 * @param b - Second channel id (may be any unknown value).
 * @returns `true` when both ids refer to the same channel.
 */
export function channelIdsEqual(a: `0x${string}`, b: unknown): boolean {
  if (typeof b !== "string" || b.length === 0) return false;
  const norm = (x: string) => {
    let s = x.toLowerCase();
    if (s.startsWith("0x")) s = s.slice(2);
    return `0x${s}`;
  };
  return norm(a) === norm(b);
}

/**
 * Validates the time window of an ERC-3009 `ReceiveWithAuthorization`.
 *
 * @param validAfter - Earliest unix timestamp the authorization is valid (in seconds).
 * @param validBefore - Latest unix timestamp before which the authorization is valid.
 * @returns An error code string if the time window is invalid, otherwise `undefined`.
 */
export function erc3009AuthorizationTimeInvalidReason(
  validAfter: bigint,
  validBefore: bigint,
): string | undefined {
  const now = Math.floor(Date.now() / 1000);
  if (validBefore < BigInt(now + 6)) return Errors.ErrValidBeforeExpired;
  if (validAfter > BigInt(now)) return Errors.ErrValidAfterInFuture;
  return undefined;
}

/**
 * Verifies a cumulative voucher signature against the expected authorizer.
 *
 * When `payerAuthorizer` is a non-zero address the signature is verified against
 * it; otherwise it falls back to the payer address. (ERC-1271 smart-wallet
 * verification is not supported on TRON in this version.)
 *
 * @param signer - Facilitator signer providing `verifyTypedData`.
 * @param params - Voucher fields and authorizer addresses needed for verification.
 * @param params.channelId - TIP-712 voucher channel id (`bytes32` hex).
 * @param params.maxClaimableAmount - Max cumulative claimable amount as a decimal string.
 * @param params.payerAuthorizer - Address that signed the voucher.
 * @param params.payer - Payer address (fallback when authorizer is zero).
 * @param params.signature - TIP-712 signature bytes over the voucher.
 * @param network - CAIP-2 network identifier for the TIP-712 domain.
 * @returns `true` when the voucher signature is valid.
 */
export async function verifyBatchSettlementVoucherTypedData(
  signer: FacilitatorTronSigner,
  params: {
    channelId: `0x${string}`;
    maxClaimableAmount: string;
    payerAuthorizer: string;
    payer: string;
    signature: `0x${string}`;
  },
  network: string,
): Promise<boolean> {
  const domain = getBatchSettlementTip712Domain(network);
  const message = {
    channelId: params.channelId,
    maxClaimableAmount: BigInt(params.maxClaimableAmount),
  };

  const authorizer = normalizeAddressForSigning(params.payerAuthorizer);
  const verifyAddress =
    authorizer !== ZERO_ADDRESS ? authorizer : normalizeAddressForSigning(params.payer);

  return signer.verifyTypedData({
    address: verifyAddress,
    domain,
    types: voucherTypes as unknown as Record<string, Array<{ name: string; type: string }>>,
    primaryType: "Voucher",
    message,
    signature: params.signature,
  });
}

/**
 * Validates that a {@link ChannelConfig} is consistent with the claimed `channelId`
 * and the server's {@link PaymentRequirements}.
 *
 * @param config - The channel configuration from the payload.
 * @param channelId - The `channelId` claimed in the payload.
 * @param requirements - Server payment requirements to cross-check against.
 * @returns An error code string if validation fails, otherwise `undefined`.
 */
export function validateChannelConfig(
  config: ChannelConfig,
  channelId: `0x${string}`,
  requirements: PaymentRequirements,
): string | undefined {
  const computedId = computeChannelId(config, requirements.network);
  if (computedId.toLowerCase() !== channelId.toLowerCase()) {
    return Errors.ErrChannelIdMismatch;
  }

  if (
    normalizeAddressForSigning(config.receiver) !== normalizeAddressForSigning(requirements.payTo)
  ) {
    return Errors.ErrReceiverMismatch;
  }

  const extra = requirements.extra as Partial<BatchSettlementPaymentRequirementsExtra> | undefined;
  const requiredReceiverAuthorizer = extra?.receiverAuthorizer;

  if (
    !requiredReceiverAuthorizer ||
    normalizeAddressForSigning(requiredReceiverAuthorizer) === ZERO_ADDRESS ||
    normalizeAddressForSigning(config.receiverAuthorizer) !==
      normalizeAddressForSigning(requiredReceiverAuthorizer)
  ) {
    return Errors.ErrReceiverAuthorizerMismatch;
  }

  if (normalizeAddressForSigning(config.token) !== normalizeAddressForSigning(requirements.asset)) {
    return Errors.ErrTokenMismatch;
  }

  if (extra?.withdrawDelay !== undefined && config.withdrawDelay !== Number(extra.withdrawDelay)) {
    return Errors.ErrWithdrawDelayMismatch;
  }

  if (config.withdrawDelay < MIN_WITHDRAW_DELAY || config.withdrawDelay > MAX_WITHDRAW_DELAY) {
    return Errors.ErrWithdrawDelayOutOfRange;
  }

  return undefined;
}

/**
 * Reads onchain channel state via three reads: `channels(channelId)`,
 * `pendingWithdrawals(channelId)`, and `refundNonce(channelId)`.
 *
 * TRON has no fixed Multicall3, so the reads are issued separately. A missing
 * channel returns zero balance/totalClaimed/refundNonce.
 *
 * @param signer - Facilitator signer for onchain reads.
 * @param channelId - The `bytes32` channel id.
 * @param network - CAIP-2 network identifier (resolves the contract address).
 * @returns Fresh {@link ChannelState}.
 */
export async function readChannelState(
  signer: FacilitatorTronSigner,
  channelId: `0x${string}`,
  network: string,
): Promise<ChannelState> {
  const address = getBatchSettlementAddress(network);

  const [channels, pending, refundNonce] = await Promise.all([
    signer.readContract({ address, abi, functionName: "channels", args: [channelId] }),
    signer.readContract({ address, abi, functionName: "pendingWithdrawals", args: [channelId] }),
    signer.readContract({ address, abi, functionName: "refundNonce", args: [channelId] }),
  ]);

  return {
    balance: toBigInt(readField(channels, 0, "balance")),
    totalClaimed: toBigInt(readField(channels, 1, "totalClaimed")),
    withdrawRequestedAt: Number(toBigInt(readField(pending, 1, "initiatedAt"))),
    refundNonce: toBigInt(refundNonce),
  };
}

/**
 * Reads `channels(channelId)` returning `[balance, totalClaimed]`.
 *
 * @param signer - Facilitator signer providing `readContract`.
 * @param channelId - The `bytes32` channel id to query.
 * @param network - CAIP-2 network identifier.
 * @returns Tuple of `[balance, totalClaimed]` as bigints.
 */
export async function readChannelBalanceAndTotalClaimed(
  signer: FacilitatorTronSigner,
  channelId: `0x${string}`,
  network: string,
): Promise<[bigint, bigint]> {
  const channels = await signer.readContract({
    address: getBatchSettlementAddress(network),
    abi,
    functionName: "channels",
    args: [channelId],
  });
  return [
    toBigInt(readField(channels, 0, "balance")),
    toBigInt(readField(channels, 1, "totalClaimed")),
  ];
}

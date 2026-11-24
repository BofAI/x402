/**
 * @file Payload and state types for the TRON batch-settlement scheme.
 *
 * Ported from the x402 EVM mechanism; address fields are widened to `string` so callers may
 * pass TRON Base58Check or EVM hex. Hashing/signing normalizes to hex internally.
 */

import { isRecord, isTronPaymentAddress, isUint256 } from "../shared/validation";

/**
 * Signer that produces TIP-712 signatures for the receiver-authorizer
 * (`claimWithSignature` / `refundWithSignature`) and exposes its address.
 */
export interface TronAuthorizerSigner {
  /** Authorizer address (Base58Check or EVM hex). */
  address: string;
  /**
   * Sign EIP-712/TIP-712 typed data. Domain/message addresses should already be
   * in EVM hex format.
   */
  signTypedData(args: {
    domain: Record<string, unknown>;
    types: Record<string, Array<{ name: string; type: string }>>;
    primaryType: string;
    message: Record<string, unknown>;
  }): Promise<`0x${string}`>;
}

export type ChannelState = {
  balance: bigint;
  totalClaimed: bigint;
  withdrawRequestedAt: number;
  refundNonce: bigint;
};

export type ChannelConfig = {
  payer: string;
  payerAuthorizer: string;
  receiver: string;
  receiverAuthorizer: string;
  token: string;
  withdrawDelay: number;
  salt: `0x${string}`;
};

export type BatchSettlementErc3009Authorization = {
  validAfter: string;
  validBefore: string;
  salt: `0x${string}`;
  signature: `0x${string}`;
};

export type BatchSettlementPermit2Authorization = {
  from: string;
  permitted: {
    token: string;
    amount: string;
  };
  spender: string;
  nonce: string;
  deadline: string;
  witness: {
    channelId: `0x${string}`;
  };
  signature: `0x${string}`;
};

export type BatchSettlementAssetTransferMethod = "eip3009" | "permit2";

export type BatchSettlementDepositAuthorization =
  | {
      erc3009Authorization: BatchSettlementErc3009Authorization;
      permit2Authorization?: never;
    }
  | {
      erc3009Authorization?: never;
      permit2Authorization: BatchSettlementPermit2Authorization;
    };

export type BatchSettlementVoucherFields = {
  channelId: `0x${string}`;
  maxClaimableAmount: string;
  signature: `0x${string}`;
};

export type BatchSettlementDepositPayload = {
  type: "deposit";
  channelConfig: ChannelConfig;
  voucher: BatchSettlementVoucherFields;
  deposit: {
    amount: string;
    authorization: BatchSettlementDepositAuthorization;
  };
};

export type BatchSettlementVoucherPayload = {
  type: "voucher";
  channelConfig: ChannelConfig;
  voucher: BatchSettlementVoucherFields;
};

export type BatchSettlementRefundPayload = {
  type: "refund";
  channelConfig: ChannelConfig;
  voucher: BatchSettlementVoucherFields;
  amount?: string;
};

export type BatchSettlementVoucherClaim = {
  voucher: {
    channel: ChannelConfig;
    maxClaimableAmount: string;
  };
  signature: `0x${string}`;
  totalClaimed: string;
};

export type BatchSettlementChannelStateExtra = {
  channelId: `0x${string}`;
  balance: string;
  totalClaimed: string;
  withdrawRequestedAt: number;
  refundNonce: string;
  chargedCumulativeAmount?: string;
};

export type BatchSettlementVoucherStateExtra = {
  signedMaxClaimable?: string;
  signature?: `0x${string}`;
};

export type BatchSettlementPaymentRequirementsExtra = {
  receiverAuthorizer: string;
  withdrawDelay: number;
  name: string;
  version: string;
  assetTransferMethod?: BatchSettlementAssetTransferMethod;
  channelState?: BatchSettlementChannelStateExtra;
  voucherState?: BatchSettlementVoucherStateExtra;
};

export type FileChannelStorageOptions = {
  /** Root directory; channels are stored under `{directory}/{client|server}/{channelId}.json`. */
  directory: string;
};

export type BatchSettlementPaymentResponseExtra = {
  chargedAmount?: string;
  channelState?: BatchSettlementChannelStateExtra;
  voucherState?: BatchSettlementVoucherStateExtra;
};

export type BatchSettlementClaimPayload = {
  type: "claim";
  claims: BatchSettlementVoucherClaim[];
  claimAuthorizerSignature?: `0x${string}`;
};

export type BatchSettlementSettlePayload = {
  type: "settle";
  receiver: string;
  token: string;
};

export type BatchSettlementEnrichedRefundPayload = BatchSettlementRefundPayload & {
  amount: string;
  refundNonce: string;
  claims: BatchSettlementVoucherClaim[];
  refundAuthorizerSignature?: `0x${string}`;
  claimAuthorizerSignature?: `0x${string}`;
};

export type BatchSettlementPayload =
  | BatchSettlementDepositPayload
  | BatchSettlementVoucherPayload
  | BatchSettlementRefundPayload;

export type BatchSettlementFacilitatorSettlePayload =
  | BatchSettlementDepositPayload
  | BatchSettlementClaimPayload
  | BatchSettlementSettlePayload
  | BatchSettlementEnrichedRefundPayload;

/**
 * Check a bytes32 channel ID or salt.
 *
 * @param value - Untrusted hex value.
 * @returns Whether the value encodes 32 bytes.
 */
function isBytes32(value: unknown): boolean {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
}

/**
 * Check a batch-settlement amount before encoding it as a uint128.
 *
 * @param value - Untrusted amount.
 * @returns Whether it fits the contract amount type.
 */
function isUint128(value: unknown): boolean {
  return isUint256(value) && BigInt(value) < 1n << 128n;
}

/**
 * Check the fields consumed by channel hashing and settlement.
 *
 * @param config - Untrusted channel configuration.
 * @returns Whether the fields can be safely encoded.
 */
function isChannelConfig(config: unknown): boolean {
  return (
    isRecord(config) &&
    isTronPaymentAddress(config.payer) &&
    isTronPaymentAddress(config.payerAuthorizer) &&
    isTronPaymentAddress(config.receiver) &&
    isTronPaymentAddress(config.receiverAuthorizer) &&
    isTronPaymentAddress(config.token) &&
    typeof config.withdrawDelay === "number" &&
    Number.isSafeInteger(config.withdrawDelay) &&
    config.withdrawDelay >= 0 &&
    config.withdrawDelay < 2 ** 40 &&
    isBytes32(config.salt)
  );
}

/**
 * Check the signed voucher fields before hashing or verifying them.
 *
 * @param voucher - Untrusted voucher fields.
 * @returns Whether it has the required field types.
 */
function isVoucherFields(voucher: unknown): boolean {
  return (
    isRecord(voucher) &&
    isBytes32(voucher.channelId) &&
    isUint128(voucher.maxClaimableAmount) &&
    typeof voucher.signature === "string"
  );
}

/**
 * Check a supplied deposit authorization before using its contract arguments.
 *
 * @param authorization - Untrusted authorization containing either supported method.
 * @returns Whether all supplied authorization fields have the required types.
 */
function isDepositAuthorization(authorization: unknown): boolean {
  if (!isRecord(authorization)) return false;

  const { erc3009Authorization, permit2Authorization } = authorization;
  if (
    erc3009Authorization !== undefined &&
    !(
      isRecord(erc3009Authorization) &&
      isUint256(erc3009Authorization.validAfter) &&
      isUint256(erc3009Authorization.validBefore) &&
      isBytes32(erc3009Authorization.salt) &&
      typeof erc3009Authorization.signature === "string"
    )
  ) {
    return false;
  }

  return (
    permit2Authorization === undefined ||
    (isRecord(permit2Authorization) &&
      isTronPaymentAddress(permit2Authorization.from) &&
      isTronPaymentAddress(permit2Authorization.spender) &&
      isUint256(permit2Authorization.nonce) &&
      isUint256(permit2Authorization.deadline) &&
      typeof permit2Authorization.signature === "string" &&
      isRecord(permit2Authorization.permitted) &&
      isTronPaymentAddress(permit2Authorization.permitted.token) &&
      isUint256(permit2Authorization.permitted.amount) &&
      isRecord(permit2Authorization.witness) &&
      isBytes32(permit2Authorization.witness.channelId))
  );
}

/**
 * Check the channel, voucher and cumulative amount of a claim.
 *
 * @param claim - Untrusted claim entry.
 * @returns Whether it has the fields needed to settle the claim.
 */
function isVoucherClaim(claim: unknown): boolean {
  return (
    isRecord(claim) &&
    isRecord(claim.voucher) &&
    isChannelConfig(claim.voucher.channel) &&
    isUint128(claim.voucher.maxClaimableAmount) &&
    typeof claim.signature === "string" &&
    isUint128(claim.totalClaimed)
  );
}

/**
 * Type guard for {@link BatchSettlementDepositPayload}.
 *
 * @param payload - Unknown payload to check.
 * @returns True if `payload` is a deposit payload (carries `deposit` and `voucher`).
 */
export function isBatchSettlementDepositPayload(
  payload: unknown,
): payload is BatchSettlementDepositPayload {
  return (
    isRecord(payload) &&
    payload.type === "deposit" &&
    isChannelConfig(payload.channelConfig) &&
    isVoucherFields(payload.voucher) &&
    isRecord(payload.deposit) &&
    isUint128(payload.deposit.amount) &&
    isDepositAuthorization(payload.deposit.authorization)
  );
}

/**
 * Type guard for {@link BatchSettlementVoucherPayload}.
 *
 * @param payload - Unknown payload to check.
 * @returns True if `payload` is a voucher payload with channel and signature fields.
 */
export function isBatchSettlementVoucherPayload(
  payload: unknown,
): payload is BatchSettlementVoucherPayload {
  return (
    isRecord(payload) &&
    payload.type === "voucher" &&
    isChannelConfig(payload.channelConfig) &&
    isVoucherFields(payload.voucher)
  );
}

/**
 * Type guard for {@link BatchSettlementRefundPayload}.
 *
 * @param payload - Unknown payload to check.
 * @returns True if `payload` is a refund payload with channel config and voucher fields.
 */
export function isBatchSettlementRefundPayload(
  payload: unknown,
): payload is BatchSettlementRefundPayload {
  return (
    isRecord(payload) &&
    payload.type === "refund" &&
    isChannelConfig(payload.channelConfig) &&
    isVoucherFields(payload.voucher) &&
    (payload.amount === undefined || isUint128(payload.amount))
  );
}

/**
 * Type guard for {@link BatchSettlementClaimPayload}.
 *
 * @param payload - Unknown payload to check.
 * @returns True if `payload` is a settle-action `claimWithSignature` payload.
 */
export function isBatchSettlementClaimPayload(
  payload: unknown,
): payload is BatchSettlementClaimPayload {
  return (
    isRecord(payload) &&
    payload.type === "claim" &&
    Array.isArray(payload.claims) &&
    payload.claims.every(isVoucherClaim) &&
    (payload.claimAuthorizerSignature === undefined ||
      typeof payload.claimAuthorizerSignature === "string")
  );
}

/**
 * Type guard for {@link BatchSettlementSettlePayload}.
 *
 * @param payload - Unknown payload to check.
 * @returns True if `payload` is a settle-action `settle` payload.
 */
export function isBatchSettlementSettlePayload(
  payload: unknown,
): payload is BatchSettlementSettlePayload {
  return (
    isRecord(payload) &&
    payload.type === "settle" &&
    isTronPaymentAddress(payload.receiver) &&
    isTronPaymentAddress(payload.token)
  );
}

/**
 * Type guard for {@link BatchSettlementEnrichedRefundPayload}.
 *
 * @param payload - Unknown payload to check.
 * @returns True if `payload` is a settle-action `refundWithSignature` payload.
 */
export function isBatchSettlementEnrichedRefundPayload(
  payload: unknown,
): payload is BatchSettlementEnrichedRefundPayload {
  if (!isRecord(payload)) return false;

  const { amount, refundNonce, claims, refundAuthorizerSignature, claimAuthorizerSignature } =
    payload;
  return (
    isBatchSettlementRefundPayload(payload) &&
    isUint128(amount) &&
    isUint256(refundNonce) &&
    Array.isArray(claims) &&
    claims.every(isVoucherClaim) &&
    (refundAuthorizerSignature === undefined || typeof refundAuthorizerSignature === "string") &&
    (claimAuthorizerSignature === undefined || typeof claimAuthorizerSignature === "string")
  );
}

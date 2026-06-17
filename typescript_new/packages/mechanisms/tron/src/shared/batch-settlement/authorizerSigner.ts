/**
 * @file Receiver-authorizer TIP-712 signing for claim batches and refunds (TRON).
 */
import type {
  TronAuthorizerSigner,
  BatchSettlementVoucherClaim,
} from "../../batch-settlement/types";
import { claimBatchTypes, refundTypes } from "./constants";
import { computeChannelId, getBatchSettlementTip712Domain } from "./utils";

/**
 * Signs a `ClaimBatch` TIP-712 digest for `claimWithSignature()`.
 *
 * @param signer - Authorizer signer holding the `receiverAuthorizer` key.
 * @param claims - Voucher claims to include in the batch.
 * @param network - CAIP-2 network identifier (e.g. `"tron:nile"`).
 * @returns TIP-712 signature over `ClaimBatch(ClaimEntry[] claims)`.
 */
export async function signClaimBatch(
  signer: TronAuthorizerSigner,
  claims: BatchSettlementVoucherClaim[],
  network: string,
): Promise<`0x${string}`> {
  const claimEntries = claims.map(c => ({
    channelId: computeChannelId(c.voucher.channel, network),
    maxClaimableAmount: BigInt(c.voucher.maxClaimableAmount),
    totalClaimed: BigInt(c.totalClaimed),
  }));

  return signer.signTypedData({
    domain: getBatchSettlementTip712Domain(network),
    types: claimBatchTypes as unknown as Record<string, Array<{ name: string; type: string }>>,
    primaryType: "ClaimBatch",
    message: { claims: claimEntries },
  });
}

/**
 * Signs a `Refund` TIP-712 digest for `refundWithSignature()`.
 *
 * @param signer - Authorizer signer holding the `receiverAuthorizer` key.
 * @param channelId - Channel to authorize refund for.
 * @param amount - Refund amount (capped to unclaimed escrow onchain).
 * @param nonce - Must match onchain `refundNonce(channelId)`.
 * @param network - CAIP-2 network identifier (e.g. `"tron:nile"`).
 * @returns TIP-712 signature over `Refund(channelId, nonce, amount)`.
 */
export async function signRefund(
  signer: TronAuthorizerSigner,
  channelId: `0x${string}`,
  amount: string,
  nonce: string,
  network: string,
): Promise<`0x${string}`> {
  return signer.signTypedData({
    domain: getBatchSettlementTip712Domain(network),
    types: refundTypes as unknown as Record<string, Array<{ name: string; type: string }>>,
    primaryType: "Refund",
    message: {
      channelId,
      nonce: BigInt(nonce),
      amount: BigInt(amount),
    },
  });
}

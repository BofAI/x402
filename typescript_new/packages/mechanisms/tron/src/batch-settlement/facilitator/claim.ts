import { SettleResponse, PaymentRequirements } from "@x402/core/types";
import { FacilitatorTronSigner } from "../../signer";
import { normalizeAddressForSigning } from "../../utils";
import type { TronAuthorizerSigner, BatchSettlementClaimPayload } from "../types";
import { batchSettlementABI } from "../../shared/batch-settlement/abi";
import { getBatchSettlementAddress } from "../../shared/batch-settlement/constants";
import { signClaimBatch } from "../../shared/batch-settlement/authorizerSigner";
import { toContractChannelConfig } from "./utils";
import * as Errors from "../errors";

const abi = batchSettlementABI as unknown as readonly Record<string, unknown>[];

/**
 * Converts voucher claims into the onchain tuple format expected by
 * `claimWithSignature()`.
 *
 * @param claims - Typed voucher claims with channel config, amounts, and signatures.
 * @returns Contract-ready VoucherClaim argument array.
 */
export function buildVoucherClaimArgs(claims: BatchSettlementClaimPayload["claims"]) {
  // ABI-ordered positional tuples: VoucherClaim = (Voucher voucher, bytes signature,
  // uint128 totalClaimed); Voucher = (ChannelConfig channel, uint128 maxClaimableAmount).
  return claims.map(c => [
    [toContractChannelConfig(c.voucher.channel), BigInt(c.voucher.maxClaimableAmount)],
    c.signature,
    BigInt(c.totalClaimed),
  ]);
}

/**
 * Submits a batch claim via `claimWithSignature()`.
 *
 * When `claimAuthorizerSignature` is present it is used directly; otherwise the
 * facilitator signs the `ClaimBatch` digest with `authorizerSigner` after
 * verifying every claim's `receiverAuthorizer` matches it.
 *
 * @param signer - Facilitator signer used to submit the claim transaction.
 * @param payload - Claim payload containing voucher claims and optional authorizer signature.
 * @param requirements - Payment requirements for network identification.
 * @param authorizerSigner - Dedicated key for producing `ClaimBatch` TIP-712 signatures.
 * @returns A {@link SettleResponse} with the transaction hash on success.
 */
export async function executeClaimWithSignature(
  signer: FacilitatorTronSigner,
  payload: BatchSettlementClaimPayload,
  requirements: PaymentRequirements,
  authorizerSigner: TronAuthorizerSigner,
): Promise<SettleResponse> {
  const network = requirements.network;
  const claimArgs = buildVoucherClaimArgs(payload.claims);

  let sig = payload.claimAuthorizerSignature;
  if (!sig) {
    for (const claim of payload.claims) {
      if (
        normalizeAddressForSigning(claim.voucher.channel.receiverAuthorizer) !==
        normalizeAddressForSigning(authorizerSigner.address)
      ) {
        return {
          success: false,
          errorReason: Errors.ErrAuthorizerAddressMismatch,
          transaction: "",
          network,
        };
      }
    }
    sig = await signClaimBatch(authorizerSigner, payload.claims, network);
  }

  try {
    const tx = await signer.writeContract({
      address: getBatchSettlementAddress(network),
      abi,
      functionName: "claimWithSignature",
      args: [claimArgs, sig],
    });

    const receipt = await signer.waitForTransactionReceipt({ hash: tx });
    if (receipt.status !== "success") {
      return {
        success: false,
        errorReason: Errors.ErrClaimTransactionFailed,
        errorMessage: `transaction reverted (receipt status ${receipt.status})`,
        transaction: tx,
        network,
      };
    }

    return { success: true, transaction: tx, network, amount: "" };
  } catch (e) {
    return {
      success: false,
      errorReason: Errors.ErrClaimTransactionFailed,
      errorMessage: e instanceof Error ? e.message : String(e),
      transaction: "",
      network,
    };
  }
}

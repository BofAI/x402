import {
  FacilitatorContext,
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  VerifyResponse,
} from "@bankofai/x402-core/types";
import { X402_PERMIT2_PROXY_ADDRESSES, x402ExactPermit2ProxyABI } from "../../constants";
import { FacilitatorTronSigner } from "../../signer";
import { ExactPermit2Payload } from "../../types";
import * as errors from "./errors";
import { verifyPermit2AccountState, verifyPermit2Authorization } from "./permit2Verification";
import { executeTrc20Sponsorship, verifyTrc20Sponsorship } from "./trc20Sponsoring";

/**
 * Verifies a Permit2 payment payload on TRON.
 *
 * @param signer - The TRON signer.
 * @param payload - The payment payload.
 * @param requirements - The payment requirements.
 * @param permit2Payload - The Permit2 specific payload.
 * @param context - Registered Facilitator extension capabilities.
 * @returns The verification response.
 */
export async function verifyPermit2(
  signer: FacilitatorTronSigner,
  payload: PaymentPayload,
  requirements: PaymentRequirements,
  permit2Payload: ExactPermit2Payload,
  context?: FacilitatorContext,
): Promise<VerifyResponse> {
  const payer = permit2Payload.permit2Authorization.from;
  const authorization = await verifyPermit2Authorization(
    signer,
    payload,
    requirements,
    permit2Payload,
  );
  if (!authorization.isValid) return authorization;
  const sponsorship = await verifyTrc20Sponsorship(payload, requirements, payer, context);
  if (sponsorship && !sponsorship.isValid) return sponsorship;
  return verifyPermit2AccountState(signer, requirements, payer, sponsorship === null);
}

/**
 * Submits the already-verified Permit2 settlement call.
 *
 * @param signer - Facilitator TRON signer.
 * @param payload - Verified x402 payment payload.
 * @param requirements - Trusted payment requirements.
 * @param permit2Payload - Verified Permit2 authorization.
 * @returns Core settlement response.
 */
async function submitPermit2Settlement(
  signer: FacilitatorTronSigner,
  payload: PaymentPayload,
  requirements: PaymentRequirements,
  permit2Payload: ExactPermit2Payload,
): Promise<SettleResponse> {
  const payer = permit2Payload.permit2Authorization.from;
  const authorization = permit2Payload.permit2Authorization;
  const permitTuple = [
    [authorization.permitted.token, BigInt(authorization.permitted.amount)],
    BigInt(authorization.nonce),
    BigInt(authorization.deadline),
  ] as const;
  const witnessTuple = [
    authorization.witness.to,
    BigInt(authorization.witness.validAfter),
  ] as const;
  try {
    const transaction = await signer.writeContract({
      address: X402_PERMIT2_PROXY_ADDRESSES[requirements.network]!,
      abi: x402ExactPermit2ProxyABI as unknown as readonly Record<string, unknown>[],
      functionName: "settle",
      args: [permitTuple, payer, witnessTuple, permit2Payload.signature],
    });
    const receipt = await signer.waitForTransactionReceipt({ hash: transaction });
    return receipt.status === "success"
      ? { success: true, transaction, network: payload.accepted.network, payer }
      : {
          success: false,
          errorReason: errors.INVALID_TRANSACTION_STATE,
          transaction,
          network: payload.accepted.network,
          payer,
        };
  } catch (error: unknown) {
    return {
      success: false,
      errorReason: errors.TRANSACTION_FAILED,
      errorMessage: error instanceof Error ? error.message : "Permit2 settlement failed",
      transaction: "",
      network: payload.accepted.network,
      payer,
    };
  }
}

/**
 * Settles a Permit2 payment on TRON by calling x402Permit2Proxy.settle().
 *
 * @param signer - The TRON signer.
 * @param payload - The payment payload.
 * @param requirements - The payment requirements.
 * @param permit2Payload - The Permit2 specific payload.
 * @param context - Registered Facilitator extension capabilities.
 * @returns The settlement response.
 */
export async function settlePermit2(
  signer: FacilitatorTronSigner,
  payload: PaymentPayload,
  requirements: PaymentRequirements,
  permit2Payload: ExactPermit2Payload,
  context?: FacilitatorContext,
): Promise<SettleResponse> {
  const payer = permit2Payload.permit2Authorization.from;

  const valid = await verifyPermit2(signer, payload, requirements, permit2Payload, context);
  if (!valid.isValid) {
    return {
      success: false,
      network: payload.accepted.network,
      transaction: "",
      errorReason: valid.invalidReason ?? errors.INVALID_SCHEME,
      payer,
    };
  }

  const sponsorshipFailure = await executeTrc20Sponsorship(payload, requirements, payer, context);
  if (sponsorshipFailure) return sponsorshipFailure;
  return submitPermit2Settlement(signer, payload, requirements, permit2Payload);
}

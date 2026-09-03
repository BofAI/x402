import {
  FacilitatorContext,
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  VerifyResponse,
} from "@bankofai/x402-core/types";
import {
  uptoPermit2WitnessTypes,
  PERMIT2_ADDRESSES,
  X402_UPTO_PERMIT2_PROXY_ADDRESSES,
  x402UptoPermit2ProxyABI,
  erc20AllowanceAbi,
  transferWithAuthorizationABI,
} from "../../constants";
import { FacilitatorTronSigner } from "../../signer";
import { UptoPermit2Payload } from "../../types";
import { getTronChainId, normalizeAddressForSigning } from "../../utils";
import { tronNetworksEqual } from "../../network";
import * as errors from "./errors";
import {
  executeTrc20Sponsorship,
  verifyTrc20Sponsorship,
} from "../../shared/extensions/trc20ApprovalResourceSponsoring";
import { waitAndReturnSettleResponse } from "../../shared/settleReceipt";

interface UptoVerificationOptions {
  readonly verifySponsorship?: boolean;
  readonly requireAllowance?: boolean;
}

/**
 * Verifies an Upto Permit2 payment payload on TRON.
 *
 * `requirements.amount` is treated as the authorized maximum: it must equal
 * `permitted.amount`. The witness facilitator must match one of this
 * facilitator's signer addresses.
 *
 * @param signer - The TRON signer.
 * @param payload - The payment payload.
 * @param requirements - The payment requirements (amount = authorized maximum).
 * @param permit2Payload - The Upto Permit2 specific payload.
 * @param context - Registered Facilitator extension capabilities.
 * @param options - Internal controls for the post-delegation revalidation pass.
 * @returns The verification response.
 */
export async function verifyUptoPermit2(
  signer: FacilitatorTronSigner,
  payload: PaymentPayload,
  requirements: PaymentRequirements,
  permit2Payload: UptoPermit2Payload,
  context?: FacilitatorContext,
  options: UptoVerificationOptions = {},
): Promise<VerifyResponse> {
  const payer = permit2Payload.permit2Authorization.from;

  if (payload.accepted.scheme !== "upto" || requirements.scheme !== "upto") {
    return { isValid: false, invalidReason: errors.INVALID_SCHEME, payer };
  }

  if (!tronNetworksEqual(payload.accepted.network, requirements.network)) {
    return { isValid: false, invalidReason: errors.NETWORK_MISMATCH, payer };
  }

  const network = requirements.network;
  const permit2Address = PERMIT2_ADDRESSES[network];
  const proxyAddress = X402_UPTO_PERMIT2_PROXY_ADDRESSES[network];
  if (!permit2Address || !proxyAddress) {
    return { isValid: false, invalidReason: errors.MISSING_PERMIT2_ADDRESS, payer };
  }

  const normalizedProxy = normalizeAddressForSigning(proxyAddress);
  const tokenAddress = normalizeAddressForSigning(requirements.asset);

  // Verify spender is x402UptoPermit2Proxy
  if (normalizeAddressForSigning(permit2Payload.permit2Authorization.spender) !== normalizedProxy) {
    return { isValid: false, invalidReason: errors.INVALID_PERMIT2_SPENDER, payer };
  }

  // Verify recipient
  const payloadTo = normalizeAddressForSigning(permit2Payload.permit2Authorization.witness.to);
  const requiresPayTo = normalizeAddressForSigning(requirements.payTo);
  if (payloadTo !== requiresPayTo) {
    return { isValid: false, invalidReason: errors.PERMIT2_RECIPIENT_MISMATCH, payer };
  }

  // Verify the witness facilitator matches one of our own signer addresses.
  const witnessFacilitator = normalizeAddressForSigning(
    permit2Payload.permit2Authorization.witness.facilitator,
  );
  const facilitatorMatch = signer
    .getAddresses()
    .some(addr => normalizeAddressForSigning(addr) === witnessFacilitator);
  if (!facilitatorMatch) {
    return { isValid: false, invalidReason: errors.INVALID_PERMIT2_FACILITATOR, payer };
  }

  // Verify deadline (with 6 second buffer)
  const now = Math.floor(Date.now() / 1000);
  if (BigInt(permit2Payload.permit2Authorization.deadline) < BigInt(now + 6)) {
    return { isValid: false, invalidReason: errors.PERMIT2_DEADLINE_EXPIRED, payer };
  }

  // Verify validAfter is not in the future
  if (BigInt(permit2Payload.permit2Authorization.witness.validAfter) > BigInt(now)) {
    return { isValid: false, invalidReason: errors.PERMIT2_NOT_YET_VALID, payer };
  }

  // Verify amount equals the authorized maximum
  if (
    BigInt(permit2Payload.permit2Authorization.permitted.amount) !== BigInt(requirements.amount)
  ) {
    return { isValid: false, invalidReason: errors.PERMIT2_AMOUNT_MISMATCH, payer };
  }

  // Verify token
  if (
    normalizeAddressForSigning(permit2Payload.permit2Authorization.permitted.token) !== tokenAddress
  ) {
    return { isValid: false, invalidReason: errors.PERMIT2_TOKEN_MISMATCH, payer };
  }

  // Verify signature using the upto-specific witness types (includes facilitator)
  const chainId = getTronChainId(network);
  const normalizedPermit2 = normalizeAddressForSigning(permit2Address);

  const typedData = {
    address: payer,
    types: uptoPermit2WitnessTypes as unknown as Record<string, { name: string; type: string }[]>,
    primaryType: "PermitWitnessTransferFrom" as const,
    domain: { name: "Permit2", chainId, verifyingContract: normalizedPermit2 },
    message: {
      permitted: {
        token: permit2Payload.permit2Authorization.permitted.token,
        amount: BigInt(permit2Payload.permit2Authorization.permitted.amount),
      },
      spender: permit2Payload.permit2Authorization.spender,
      nonce: BigInt(permit2Payload.permit2Authorization.nonce),
      deadline: BigInt(permit2Payload.permit2Authorization.deadline),
      witness: {
        to: permit2Payload.permit2Authorization.witness.to,
        facilitator: permit2Payload.permit2Authorization.witness.facilitator,
        validAfter: BigInt(permit2Payload.permit2Authorization.witness.validAfter),
      },
    },
    signature: permit2Payload.signature,
  };

  try {
    const isValid = await signer.verifyTypedData(typedData);
    if (!isValid) {
      return { isValid: false, invalidReason: errors.PERMIT2_INVALID_SIGNATURE, payer };
    }
  } catch {
    return { isValid: false, invalidReason: errors.PERMIT2_INVALID_SIGNATURE, payer };
  }

  const sponsorship =
    options.verifySponsorship === false
      ? null
      : await verifyTrc20Sponsorship(payload, requirements, payer, context);
  if (sponsorship && !sponsorship.isValid) return sponsorship;

  // Check Permit2 allowance covers the authorized maximum when the Approval is
  // not supplied through the resource-sponsoring extension.
  try {
    if (options.requireAllowance ?? sponsorship === null) {
      const allowance = (await signer.readContract({
        address: requirements.asset,
        abi: erc20AllowanceAbi as unknown as readonly Record<string, unknown>[],
        functionName: "allowance",
        args: [payer, permit2Address],
      })) as bigint;

      if (allowance < BigInt(requirements.amount)) {
        return { isValid: false, invalidReason: errors.PERMIT2_ALLOWANCE_REQUIRED, payer };
      }
    }
  } catch {
    // If allowance check fails, proceed optimistically
  }

  // Check balance covers the authorized maximum
  try {
    const balance = (await signer.readContract({
      address: requirements.asset,
      abi: transferWithAuthorizationABI as unknown as readonly Record<string, unknown>[],
      functionName: "balanceOf",
      args: [payer],
    })) as bigint;

    if (balance < BigInt(requirements.amount)) {
      return {
        isValid: false,
        invalidReason: errors.INSUFFICIENT_FUNDS,
        invalidMessage: `Insufficient funds. Required: ${requirements.amount}, Available: ${balance.toString()}`,
        payer,
      };
    }
  } catch {
    // If balance check fails, continue
  }

  return { isValid: true, invalidReason: undefined, payer };
}

/**
 * Settles an Upto Permit2 payment on TRON by calling x402UptoPermit2Proxy.settle().
 *
 * Here `requirements.amount` is the *actual* settlement amount, which may be less
 * than the authorized maximum (`permitted.amount`). The payload is re-verified
 * against the maximum, then settled for the actual amount.
 *
 * @param signer - The TRON signer.
 * @param payload - The payment payload.
 * @param requirements - The payment requirements (amount = actual settlement amount).
 * @param permit2Payload - The Upto Permit2 specific payload.
 * @param context - Registered Facilitator extension capabilities.
 * @returns The settlement response.
 */
export async function settleUptoPermit2(
  signer: FacilitatorTronSigner,
  payload: PaymentPayload,
  requirements: PaymentRequirements,
  permit2Payload: UptoPermit2Payload,
  context?: FacilitatorContext,
): Promise<SettleResponse> {
  const payer = permit2Payload.permit2Authorization.from;
  const settlementAmount = BigInt(requirements.amount);
  const maxAmount = BigInt(permit2Payload.permit2Authorization.permitted.amount);

  // Re-verify against the authorized maximum (verify performs strict
  // permitted.amount === requirements.amount equality).
  const verifyRequirements: PaymentRequirements = {
    ...requirements,
    amount: permit2Payload.permit2Authorization.permitted.amount,
  };

  const valid = await verifyUptoPermit2(
    signer,
    payload,
    verifyRequirements,
    permit2Payload,
    context,
  );
  if (!valid.isValid) {
    return {
      success: false,
      network: payload.accepted.network,
      transaction: "",
      errorReason: valid.invalidReason ?? errors.INVALID_SCHEME,
      payer,
    };
  }

  // The actual settlement amount must not exceed the authorized maximum.
  if (settlementAmount > maxAmount) {
    return {
      success: false,
      network: payload.accepted.network,
      transaction: "",
      errorReason: errors.SETTLEMENT_EXCEEDS_AMOUNT,
      payer,
    };
  }

  // Zero settlement — no on-chain tx needed.
  if (settlementAmount === 0n) {
    return {
      success: true,
      transaction: "",
      network: payload.accepted.network,
      payer,
      amount: "0",
    };
  }

  const sponsorshipFailure = await executeTrc20Sponsorship(
    payload,
    verifyRequirements,
    payer,
    context,
    verifyRequirements.amount,
    permit2Payload.permit2Authorization.deadline,
    () =>
      verifyUptoPermit2(signer, payload, verifyRequirements, permit2Payload, context, {
        verifySponsorship: false,
        requireAllowance: false,
      }),
  );
  if (sponsorshipFailure) return sponsorshipFailure;

  const proxyAddress = X402_UPTO_PERMIT2_PROXY_ADDRESSES[requirements.network]!;

  try {
    const permitTuple = [
      [
        permit2Payload.permit2Authorization.permitted.token,
        BigInt(permit2Payload.permit2Authorization.permitted.amount),
      ],
      BigInt(permit2Payload.permit2Authorization.nonce),
      BigInt(permit2Payload.permit2Authorization.deadline),
    ] as const;

    const witnessTuple = [
      permit2Payload.permit2Authorization.witness.to,
      permit2Payload.permit2Authorization.witness.facilitator,
      BigInt(permit2Payload.permit2Authorization.witness.validAfter),
    ] as const;

    const tx = await signer.writeContract({
      address: proxyAddress,
      abi: x402UptoPermit2ProxyABI as unknown as readonly Record<string, unknown>[],
      functionName: "settle",
      args: [permitTuple, settlementAmount, payer, witnessTuple, permit2Payload.signature],
    });

    return waitAndReturnSettleResponse(signer, tx, payload.accepted.network, payer, {
      failedStatusReason: errors.INVALID_TRANSACTION_STATE,
      amount: settlementAmount.toString(),
    });
  } catch (err) {
    return {
      success: false,
      errorReason: errors.TRANSACTION_FAILED,
      errorMessage: err instanceof Error ? err.message : String(err),
      transaction: "",
      network: payload.accepted.network,
      payer,
    };
  }
}

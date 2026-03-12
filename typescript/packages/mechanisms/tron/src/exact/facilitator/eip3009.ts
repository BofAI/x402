import {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  VerifyResponse,
} from "@bankofai/x402-core/types";
import { authorizationTypes, transferWithAuthorizationABI } from "../../constants";
import { FacilitatorTronSigner } from "../../signer";
import { ExactEIP3009Payload } from "../../types";
import { getTronChainId, normalizeAddressForSigning } from "../../utils";
import * as errors from "./errors";

/**
 * Verifies a TIP-712 TransferWithAuthorization payment payload on TRON.
 *
 * @param signer - The TRON signer.
 * @param payload - The payment payload.
 * @param requirements - The payment requirements.
 * @param tronPayload - The TIP-712 specific payload.
 * @returns The verification response.
 */
export async function verifyEIP3009(
  signer: FacilitatorTronSigner,
  payload: PaymentPayload,
  requirements: PaymentRequirements,
  tronPayload: ExactEIP3009Payload,
): Promise<VerifyResponse> {
  const payer = tronPayload.authorization.from;

  if (payload.accepted.scheme !== "exact" || requirements.scheme !== "exact") {
    return { isValid: false, invalidReason: errors.INVALID_SCHEME, payer };
  }

  if (!requirements.extra?.name || !requirements.extra?.version) {
    return { isValid: false, invalidReason: errors.MISSING_TIP712_DOMAIN, payer };
  }

  if (payload.accepted.network !== requirements.network) {
    return { isValid: false, invalidReason: errors.NETWORK_MISMATCH, payer };
  }

  const { name, version } = requirements.extra;
  const chainId = getTronChainId(requirements.network);
  const tokenAddress = normalizeAddressForSigning(requirements.asset);

  const typedData = {
    address: tronPayload.authorization.from,
    types: authorizationTypes,
    primaryType: "TransferWithAuthorization" as const,
    domain: { name, version, chainId, verifyingContract: tokenAddress },
    message: {
      from: tronPayload.authorization.from,
      to: tronPayload.authorization.to,
      value: BigInt(tronPayload.authorization.value),
      validAfter: BigInt(tronPayload.authorization.validAfter),
      validBefore: BigInt(tronPayload.authorization.validBefore),
      nonce: tronPayload.authorization.nonce,
    },
    signature: tronPayload.signature!,
  };

  try {
    const isValid = await signer.verifyTypedData(typedData);
    if (!isValid) {
      return { isValid: false, invalidReason: errors.INVALID_SIGNATURE, payer };
    }
  } catch {
    return { isValid: false, invalidReason: errors.INVALID_SIGNATURE, payer };
  }

  const payloadTo = normalizeAddressForSigning(tronPayload.authorization.to);
  const requiresPayTo = normalizeAddressForSigning(requirements.payTo);
  if (payloadTo !== requiresPayTo) {
    return { isValid: false, invalidReason: errors.RECIPIENT_MISMATCH, payer };
  }

  const now = Math.floor(Date.now() / 1000);
  if (BigInt(tronPayload.authorization.validBefore) < BigInt(now + 6)) {
    return { isValid: false, invalidReason: errors.VALID_BEFORE_EXPIRED, payer };
  }

  if (BigInt(tronPayload.authorization.validAfter) > BigInt(now)) {
    return { isValid: false, invalidReason: errors.VALID_AFTER_FUTURE, payer };
  }

  if (BigInt(tronPayload.authorization.value) !== BigInt(requirements.amount)) {
    return { isValid: false, invalidReason: errors.VALUE_MISMATCH, payer };
  }

  try {
    const balance = (await signer.readContract({
      address: requirements.asset,
      abi: transferWithAuthorizationABI as unknown as readonly Record<string, unknown>[],
      functionName: "balanceOf",
      args: [tronPayload.authorization.from],
    })) as bigint;

    if (BigInt(balance) < BigInt(requirements.amount)) {
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
 * Settles a TIP-712 TransferWithAuthorization payment on TRON.
 *
 * @param signer - The TRON signer.
 * @param payload - The payment payload.
 * @param requirements - The payment requirements.
 * @param tronPayload - The TIP-712 specific payload.
 * @returns The settlement response.
 */
export async function settleEIP3009(
  signer: FacilitatorTronSigner,
  payload: PaymentPayload,
  requirements: PaymentRequirements,
  tronPayload: ExactEIP3009Payload,
): Promise<SettleResponse> {
  const payer = tronPayload.authorization.from;

  const valid = await verifyEIP3009(signer, payload, requirements, tronPayload);
  if (!valid.isValid) {
    return {
      success: false,
      network: payload.accepted.network,
      transaction: "",
      errorReason: valid.invalidReason ?? errors.INVALID_SCHEME,
      payer,
    };
  }

  try {
    const sig = tronPayload.signature!;
    const cleanSig = sig.startsWith("0x") ? sig.slice(2) : sig;
    const r = `0x${cleanSig.slice(0, 64)}`;
    const s = `0x${cleanSig.slice(64, 128)}`;
    const v = parseInt(cleanSig.slice(128, 130), 16);

    const tx = await signer.writeContract({
      address: requirements.asset,
      abi: transferWithAuthorizationABI as unknown as readonly Record<string, unknown>[],
      functionName: "transferWithAuthorization",
      args: [
        tronPayload.authorization.from,
        tronPayload.authorization.to,
        BigInt(tronPayload.authorization.value),
        BigInt(tronPayload.authorization.validAfter),
        BigInt(tronPayload.authorization.validBefore),
        tronPayload.authorization.nonce,
        v,
        r,
        s,
      ],
    });

    const receipt = await signer.waitForTransactionReceipt({ hash: tx });

    if (receipt.status !== "success") {
      return {
        success: false,
        errorReason: errors.INVALID_TRANSACTION_STATE,
        transaction: tx,
        network: payload.accepted.network,
        payer,
      };
    }

    return {
      success: true,
      transaction: tx,
      network: payload.accepted.network,
      payer,
    };
  } catch {
    return {
      success: false,
      errorReason: errors.TRANSACTION_FAILED,
      transaction: "",
      network: payload.accepted.network,
      payer,
    };
  }
}

import type {
  PaymentPayload,
  PaymentRequirements,
  VerifyResponse,
} from "@bankofai/x402-core/types";
import {
  erc20AllowanceAbi,
  permit2WitnessTypes,
  PERMIT2_ADDRESSES,
  transferWithAuthorizationABI,
  X402_PERMIT2_PROXY_ADDRESSES,
} from "../../constants";
import type { FacilitatorTronSigner } from "../../signer";
import type { ExactPermit2Payload } from "../../types";
import { getTronChainId, normalizeAddressForSigning } from "../../utils";
import * as errors from "./errors";

const DEADLINE_BUFFER_SECONDS = 6;

interface Permit2Addresses {
  permit2: string;
  proxy: string;
}

/**
 * Creates a consistent invalid verification response.
 *
 * @param reason - Stable error code.
 * @param payer - Payment payer.
 * @param message - Optional diagnostic message.
 * @returns Invalid verification response.
 */
function invalid(reason: string, payer: string, message?: string): VerifyResponse {
  return { isValid: false, invalidReason: reason, invalidMessage: message, payer };
}

/**
 * Resolves required contracts or returns a verification error.
 *
 * @param network - TRON CAIP-2 network.
 * @param payer - Payment payer.
 * @returns Required addresses or an invalid response.
 */
function resolveAddresses(network: string, payer: string): Permit2Addresses | VerifyResponse {
  const permit2 = PERMIT2_ADDRESSES[network];
  const proxy = X402_PERMIT2_PROXY_ADDRESSES[network];
  return permit2 && proxy ? { permit2, proxy } : invalid(errors.MISSING_PERMIT2_ADDRESS, payer);
}

/**
 * Validates Permit2 fields that do not require cryptographic verification.
 *
 * @param payload - Client payment payload.
 * @param requirements - Trusted payment requirements.
 * @param authorization - Permit2 authorization fields.
 * @param addresses - Locally configured Permit2 addresses.
 * @returns First validation error, or null.
 */
function validateAuthorizationFields(
  payload: PaymentPayload,
  requirements: PaymentRequirements,
  authorization: ExactPermit2Payload["permit2Authorization"],
  addresses: Permit2Addresses,
): VerifyResponse | null {
  const payer = authorization.from;
  if (payload.accepted.scheme !== "exact" || requirements.scheme !== "exact") {
    return invalid(errors.INVALID_SCHEME, payer);
  }
  if (payload.accepted.network !== requirements.network) {
    return invalid(errors.NETWORK_MISMATCH, payer);
  }
  if (requirements.extra?.assetTransferMethod !== "permit2") {
    return invalid(errors.INVALID_ASSET_TRANSFER_METHOD, payer);
  }
  if (
    normalizeAddressForSigning(authorization.spender) !==
    normalizeAddressForSigning(addresses.proxy)
  ) {
    return invalid(errors.INVALID_PERMIT2_SPENDER, payer);
  }
  if (
    normalizeAddressForSigning(authorization.witness.to) !==
    normalizeAddressForSigning(requirements.payTo)
  ) {
    return invalid(errors.PERMIT2_RECIPIENT_MISMATCH, payer);
  }
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (BigInt(authorization.deadline) < now + BigInt(DEADLINE_BUFFER_SECONDS)) {
    return invalid(errors.PERMIT2_DEADLINE_EXPIRED, payer);
  }
  if (BigInt(authorization.witness.validAfter) > now) {
    return invalid(errors.PERMIT2_NOT_YET_VALID, payer);
  }
  if (BigInt(authorization.permitted.amount) !== BigInt(requirements.amount)) {
    return invalid(errors.PERMIT2_AMOUNT_MISMATCH, payer);
  }
  if (
    normalizeAddressForSigning(authorization.permitted.token) !==
    normalizeAddressForSigning(requirements.asset)
  ) {
    return invalid(errors.PERMIT2_TOKEN_MISMATCH, payer);
  }
  return null;
}

/**
 * Builds the canonical TIP-712 verification request.
 *
 * @param network - TRON CAIP-2 network.
 * @param permit2Address - Canonical Permit2 contract.
 * @param permit2Payload - Client Permit2 payload.
 * @returns Signer verification request.
 */
function buildTypedData(
  network: string,
  permit2Address: string,
  permit2Payload: ExactPermit2Payload,
): Parameters<FacilitatorTronSigner["verifyTypedData"]>[0] {
  const authorization = permit2Payload.permit2Authorization;
  return {
    address: authorization.from,
    types: permit2WitnessTypes,
    primaryType: "PermitWitnessTransferFrom",
    domain: {
      name: "Permit2",
      chainId: getTronChainId(network),
      verifyingContract: normalizeAddressForSigning(permit2Address),
    },
    message: {
      permitted: {
        token: authorization.permitted.token,
        amount: BigInt(authorization.permitted.amount),
      },
      spender: authorization.spender,
      nonce: BigInt(authorization.nonce),
      deadline: BigInt(authorization.deadline),
      witness: {
        to: authorization.witness.to,
        validAfter: BigInt(authorization.witness.validAfter),
      },
    },
    signature: permit2Payload.signature,
  };
}

/**
 * Verifies Permit2 semantics and signature without reading token state.
 *
 * @param signer - Facilitator signer.
 * @param payload - Client payment payload.
 * @param requirements - Trusted payment requirements.
 * @param permit2Payload - Client Permit2 payload.
 * @returns Verification response.
 */
export async function verifyPermit2Authorization(
  signer: FacilitatorTronSigner,
  payload: PaymentPayload,
  requirements: PaymentRequirements,
  permit2Payload: ExactPermit2Payload,
): Promise<VerifyResponse> {
  const payer = permit2Payload.permit2Authorization.from;
  const addresses = resolveAddresses(requirements.network, payer);
  if ("isValid" in addresses) return addresses;
  const fieldError = validateAuthorizationFields(
    payload,
    requirements,
    permit2Payload.permit2Authorization,
    addresses,
  );
  if (fieldError) return fieldError;
  try {
    const isValid = await signer.verifyTypedData(
      buildTypedData(requirements.network, addresses.permit2, permit2Payload),
    );
    return isValid
      ? { isValid: true, invalidReason: undefined, payer }
      : invalid(errors.PERMIT2_INVALID_SIGNATURE, payer);
  } catch {
    return invalid(errors.PERMIT2_INVALID_SIGNATURE, payer);
  }
}

/**
 * Reads allowance and balance with fail-closed error handling.
 *
 * @param signer - Facilitator signer.
 * @param requirements - Trusted payment requirements.
 * @param payer - Payment payer.
 * @param requireAllowance - Whether existing Permit2 allowance must cover payment.
 * @returns Account-state verification response.
 */
export async function verifyPermit2AccountState(
  signer: FacilitatorTronSigner,
  requirements: PaymentRequirements,
  payer: string,
  requireAllowance: boolean,
): Promise<VerifyResponse> {
  const permit2 = PERMIT2_ADDRESSES[requirements.network];
  if (!permit2) return invalid(errors.MISSING_PERMIT2_ADDRESS, payer);
  try {
    if (requireAllowance) {
      const allowance = BigInt(
        (await signer.readContract({
          address: requirements.asset,
          abi: erc20AllowanceAbi as unknown as readonly Record<string, unknown>[],
          functionName: "allowance",
          args: [payer, permit2],
        })) as bigint | string | number,
      );
      if (allowance < BigInt(requirements.amount)) {
        return invalid(errors.PERMIT2_ALLOWANCE_REQUIRED, payer);
      }
    }
    const balance = BigInt(
      (await signer.readContract({
        address: requirements.asset,
        abi: transferWithAuthorizationABI as unknown as readonly Record<string, unknown>[],
        functionName: "balanceOf",
        args: [payer],
      })) as bigint | string | number,
    );
    return balance >= BigInt(requirements.amount)
      ? { isValid: true, invalidReason: undefined, payer }
      : invalid(
          errors.INSUFFICIENT_FUNDS,
          payer,
          `Insufficient funds. Required: ${requirements.amount}, Available: ${balance.toString()}`,
        );
  } catch {
    return invalid(errors.CHAIN_READ_FAILED, payer, "TRON contract read failed");
  }
}

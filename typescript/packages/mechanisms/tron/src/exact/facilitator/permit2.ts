import {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  VerifyResponse,
} from "@bankofai/x402-core/types";
import {
  permit2WitnessTypes,
  PERMIT2_ADDRESSES,
  X402_PERMIT2_PROXY_ADDRESSES,
  x402ExactPermit2ProxyABI,
  erc20AllowanceAbi,
  transferWithAuthorizationABI,
} from "../../constants";
import { FacilitatorTronSigner } from "../../signer";
import { ExactPermit2Payload } from "../../types";
import { getTronChainId, normalizeAddressForSigning } from "../../utils";
import * as errors from "./errors";

/**
 * Verifies a Permit2 payment payload on TRON.
 *
 * @param signer - The TRON signer.
 * @param payload - The payment payload.
 * @param requirements - The payment requirements.
 * @param permit2Payload - The Permit2 specific payload.
 * @returns The verification response.
 */
export async function verifyPermit2(
  signer: FacilitatorTronSigner,
  payload: PaymentPayload,
  requirements: PaymentRequirements,
  permit2Payload: ExactPermit2Payload,
): Promise<VerifyResponse> {
  const payer = permit2Payload.permit2Authorization.from;
  const facilitatorAddresses = signer
    .getAddresses()
    .map(address => normalizeAddressForSigning(address));

  if (payload.accepted.scheme !== "exact" || requirements.scheme !== "exact") {
    return { isValid: false, invalidReason: errors.INVALID_SCHEME, payer };
  }

  if (payload.accepted.network !== requirements.network) {
    return { isValid: false, invalidReason: errors.NETWORK_MISMATCH, payer };
  }

  const network = requirements.network;
  const permit2Address = PERMIT2_ADDRESSES[network];
  const proxyAddress = X402_PERMIT2_PROXY_ADDRESSES[network];
  if (!permit2Address || !proxyAddress) {
    return { isValid: false, invalidReason: errors.MISSING_PERMIT2_ADDRESS, payer };
  }

  const normalizedProxy = normalizeAddressForSigning(proxyAddress);
  const tokenAddress = normalizeAddressForSigning(requirements.asset);

  // Verify spender is x402Permit2Proxy
  if (normalizeAddressForSigning(permit2Payload.permit2Authorization.spender) !== normalizedProxy) {
    return { isValid: false, invalidReason: errors.INVALID_PERMIT2_SPENDER, payer };
  }

  // Verify recipient
  const payloadTo = normalizeAddressForSigning(permit2Payload.permit2Authorization.witness.to);
  const requiresPayTo = normalizeAddressForSigning(requirements.payTo);
  if (payloadTo !== requiresPayTo) {
    return { isValid: false, invalidReason: errors.PERMIT2_RECIPIENT_MISMATCH, payer };
  }

  const payloadFacilitator = normalizeAddressForSigning(
    permit2Payload.permit2Authorization.witness.facilitator,
  );
  if (!facilitatorAddresses.includes(payloadFacilitator)) {
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

  // Verify amount
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

  // Verify signature
  const chainId = getTronChainId(network);
  const normalizedPermit2 = normalizeAddressForSigning(permit2Address);

  const typedData = {
    address: payer,
    types: permit2WitnessTypes,
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

  // Check Permit2 allowance
  try {
    const allowance = (await signer.readContract({
      address: requirements.asset,
      abi: erc20AllowanceAbi as unknown as readonly Record<string, unknown>[],
      functionName: "allowance",
      args: [payer, permit2Address],
    })) as bigint;

    if (allowance < BigInt(requirements.amount)) {
      return { isValid: false, invalidReason: errors.PERMIT2_ALLOWANCE_REQUIRED, payer };
    }
  } catch {
    // If allowance check fails, proceed optimistically
  }

  // Check balance
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
 * Settles a Permit2 payment on TRON by calling x402Permit2Proxy.settle().
 *
 * @param signer - The TRON signer.
 * @param payload - The payment payload.
 * @param requirements - The payment requirements.
 * @param permit2Payload - The Permit2 specific payload.
 * @returns The settlement response.
 */
export async function settlePermit2(
  signer: FacilitatorTronSigner,
  payload: PaymentPayload,
  requirements: PaymentRequirements,
  permit2Payload: ExactPermit2Payload,
): Promise<SettleResponse> {
  const payer = permit2Payload.permit2Authorization.from;

  const valid = await verifyPermit2(signer, payload, requirements, permit2Payload);
  if (!valid.isValid) {
    return {
      success: false,
      network: payload.accepted.network,
      transaction: "",
      errorReason: valid.invalidReason ?? errors.INVALID_SCHEME,
      payer,
    };
  }

  const proxyAddress = X402_PERMIT2_PROXY_ADDRESSES[requirements.network]!;

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
      abi: x402ExactPermit2ProxyABI as unknown as readonly Record<string, unknown>[],
      functionName: "settle",
      args: [permitTuple, payer, witnessTuple, permit2Payload.signature],
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

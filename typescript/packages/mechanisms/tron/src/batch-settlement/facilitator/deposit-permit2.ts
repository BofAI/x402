import { PaymentRequirements, VerifyResponse } from "@bankofai/x402-core/types";
import { FacilitatorTronSigner } from "../../signer";
import { PERMIT2_ADDRESSES, erc20AllowanceAbi } from "../../constants";
import { getTronChainId, normalizeAddressForSigning } from "../../utils";
import {
  getPermit2DepositCollectorAddress as getCollectorAddressForNetwork,
  batchPermit2WitnessTypes,
} from "../../shared/batch-settlement/constants";
import { buildPermit2CollectorData } from "../../shared/batch-settlement/encoding";
import { BatchSettlementDepositPayload } from "../types";
import { toBigInt } from "./utils";
import * as Errors from "../errors";

/**
 * Returns the Permit2 deposit collector address for a network.
 *
 * @param network - CAIP-2 network identifier.
 * @returns Permit2 deposit collector address (Base58Check).
 */
export function getPermit2DepositCollectorAddress(network: string): string {
  return getCollectorAddressForNetwork(network);
}

/**
 * Encodes collector data for a Permit2 deposit payload.
 *
 * @param payload - Deposit payload containing the Permit2 authorization.
 * @returns ABI-encoded collector data.
 */
export function buildPermit2DepositCollectorData(
  payload: BatchSettlementDepositPayload,
): `0x${string}` {
  const auth = payload.deposit.authorization.permit2Authorization;
  if (!auth) {
    throw new Error(Errors.ErrPermit2AuthorizationRequired);
  }
  return buildPermit2CollectorData(auth.nonce, auth.deadline, auth.signature);
}

/**
 * Verifies the channel-bound Permit2 typed-data authorization and that the payer
 * has granted Permit2 a sufficient allowance.
 *
 * @param signer - Facilitator signer for reads and signature verification.
 * @param payload - Batch deposit payload.
 * @param requirements - Payment requirements for the request.
 * @param network - CAIP-2 network identifier.
 * @returns A failure response, or `null` when valid.
 */
export async function verifyPermit2DepositAuthorization(
  signer: FacilitatorTronSigner,
  payload: BatchSettlementDepositPayload,
  requirements: PaymentRequirements,
  network: string,
): Promise<VerifyResponse | null> {
  const auth = payload.deposit.authorization.permit2Authorization;
  const payer = payload.channelConfig.payer;

  if (!auth) {
    return { isValid: false, invalidReason: Errors.ErrPermit2AuthorizationRequired, payer };
  }

  const permit2Address = PERMIT2_ADDRESSES[network];
  if (!permit2Address) {
    return { isValid: false, invalidReason: Errors.ErrPermit2AuthorizationRequired, payer };
  }

  const collector = normalizeAddressForSigning(getCollectorAddressForNetwork(network));

  if (normalizeAddressForSigning(auth.from) !== normalizeAddressForSigning(payer)) {
    return { isValid: false, invalidReason: Errors.ErrPermit2InvalidSignature, payer };
  }
  if (normalizeAddressForSigning(auth.spender) !== collector) {
    return { isValid: false, invalidReason: Errors.ErrPermit2InvalidSpender, payer };
  }
  if (
    normalizeAddressForSigning(auth.permitted.token) !==
    normalizeAddressForSigning(requirements.asset)
  ) {
    return { isValid: false, invalidReason: Errors.ErrTokenMismatch, payer };
  }
  if (BigInt(auth.permitted.amount) !== BigInt(payload.deposit.amount)) {
    return { isValid: false, invalidReason: Errors.ErrPermit2AmountMismatch, payer };
  }
  if (auth.witness.channelId !== payload.voucher.channelId) {
    return { isValid: false, invalidReason: Errors.ErrChannelIdMismatch, payer };
  }

  const now = Math.floor(Date.now() / 1000);
  if (BigInt(auth.deadline) < BigInt(now + 6)) {
    return { isValid: false, invalidReason: Errors.ErrPermit2DeadlineExpired, payer };
  }

  try {
    const ok = await signer.verifyTypedData({
      address: normalizeAddressForSigning(auth.from),
      domain: {
        name: "Permit2",
        chainId: getTronChainId(network),
        verifyingContract: normalizeAddressForSigning(permit2Address),
      },
      types: batchPermit2WitnessTypes as unknown as Record<
        string,
        Array<{ name: string; type: string }>
      >,
      primaryType: "PermitWitnessTransferFrom",
      message: {
        permitted: {
          token: normalizeAddressForSigning(auth.permitted.token),
          amount: BigInt(auth.permitted.amount),
        },
        spender: normalizeAddressForSigning(auth.spender),
        nonce: BigInt(auth.nonce),
        deadline: BigInt(auth.deadline),
        witness: { channelId: auth.witness.channelId },
      },
      signature: auth.signature,
    });
    if (!ok) {
      return { isValid: false, invalidReason: Errors.ErrPermit2InvalidSignature, payer };
    }
  } catch {
    return { isValid: false, invalidReason: Errors.ErrPermit2InvalidSignature, payer };
  }

  // Payer must have approved Permit2 to move the token.
  try {
    const allowance = toBigInt(
      await signer.readContract({
        address: requirements.asset,
        abi: erc20AllowanceAbi as unknown as readonly Record<string, unknown>[],
        functionName: "allowance",
        args: [normalizeAddressForSigning(payer), normalizeAddressForSigning(permit2Address)],
      }),
    );
    if (allowance < BigInt(payload.deposit.amount)) {
      return { isValid: false, invalidReason: Errors.ErrPermit2AllowanceRequired, payer };
    }
  } catch {
    return { isValid: false, invalidReason: Errors.ErrPermit2AllowanceRequired, payer };
  }

  return null;
}

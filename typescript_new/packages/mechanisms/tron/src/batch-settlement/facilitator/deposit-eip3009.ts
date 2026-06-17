import { PaymentRequirements, VerifyResponse } from "@x402/core/types";
import { FacilitatorTronSigner } from "../../signer";
import { getTronChainId, normalizeAddressForSigning } from "../../utils";
import {
  getErc3009DepositCollectorAddress as getCollectorAddressForNetwork,
  receiveAuthorizationTypes,
} from "../../shared/batch-settlement/constants";
import {
  buildErc3009CollectorData,
  buildErc3009DepositNonce,
} from "../../shared/batch-settlement/encoding";
import { BatchSettlementDepositPayload } from "../types";
import { erc3009AuthorizationTimeInvalidReason } from "./utils";
import * as Errors from "../errors";

/**
 * Returns the ERC-3009 deposit collector address for a network.
 *
 * @param network - CAIP-2 network identifier.
 * @returns ERC-3009 deposit collector address (Base58Check).
 */
export function getEip3009DepositCollectorAddress(network: string): string {
  return getCollectorAddressForNetwork(network);
}

/**
 * Encodes collector data for an EIP-3009 deposit payload.
 *
 * @param payload - Deposit payload containing the ERC-3009 authorization.
 * @returns ABI-encoded collector data.
 */
export function buildEip3009DepositCollectorData(
  payload: BatchSettlementDepositPayload,
): `0x${string}` {
  const auth = payload.deposit.authorization.erc3009Authorization;
  if (!auth) {
    throw new Error(Errors.ErrErc3009AuthorizationRequired);
  }
  return buildErc3009CollectorData(auth.validAfter, auth.validBefore, auth.salt, auth.signature);
}

/**
 * Verifies the ERC-3009 authorization fields and TIP-712 signature.
 *
 * @param signer - Facilitator signer for typed-data verification.
 * @param payload - Deposit payload to verify.
 * @param requirements - Payment requirements containing token domain metadata.
 * @param network - CAIP-2 network identifier.
 * @returns A failure response, or `null` when valid.
 */
export async function verifyEip3009DepositAuthorization(
  signer: FacilitatorTronSigner,
  payload: BatchSettlementDepositPayload,
  requirements: PaymentRequirements,
  network: string,
): Promise<VerifyResponse | null> {
  const { deposit, voucher } = payload;
  const payer = payload.channelConfig.payer;
  const auth = deposit.authorization.erc3009Authorization;

  if (!auth) {
    return { isValid: false, invalidReason: Errors.ErrErc3009AuthorizationRequired, payer };
  }

  const extra = requirements.extra as { name?: string; version?: string } | undefined;
  if (!extra?.name || !extra?.version) {
    return { isValid: false, invalidReason: Errors.ErrMissingEip712Domain, payer };
  }

  const validAfter = BigInt(auth.validAfter);
  const validBefore = BigInt(auth.validBefore);
  const timeInvalid = erc3009AuthorizationTimeInvalidReason(validAfter, validBefore);
  if (timeInvalid) {
    return { isValid: false, invalidReason: timeInvalid, payer };
  }

  const erc3009Nonce = buildErc3009DepositNonce(voucher.channelId, auth.salt);
  const collector = getCollectorAddressForNetwork(network);

  const ok = await signer.verifyTypedData({
    address: normalizeAddressForSigning(payer),
    domain: {
      name: extra.name,
      version: extra.version,
      chainId: getTronChainId(network),
      verifyingContract: normalizeAddressForSigning(requirements.asset),
    },
    types: receiveAuthorizationTypes as unknown as Record<
      string,
      Array<{ name: string; type: string }>
    >,
    primaryType: "ReceiveWithAuthorization",
    message: {
      from: normalizeAddressForSigning(payer),
      to: normalizeAddressForSigning(collector),
      value: BigInt(deposit.amount),
      validAfter,
      validBefore,
      nonce: erc3009Nonce,
    },
    signature: auth.signature,
  });

  if (!ok) {
    return { isValid: false, invalidReason: Errors.ErrInvalidReceiveAuthorizationSignature, payer };
  }

  return null;
}

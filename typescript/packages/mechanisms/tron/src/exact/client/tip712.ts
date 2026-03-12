import { PaymentRequirements, PaymentPayloadResult } from "@bankofai/x402-core/types";
import { authorizationTypes } from "../../constants";
import { ClientTronSigner } from "../../signer";
import { ExactTIP712Payload } from "../../types";
import { createNonce, getTronChainId, normalizeAddressForSigning } from "../../utils";

/**
 * Creates a TIP-712 TransferWithAuthorization payload for TRON.
 * Equivalent to EIP-3009 on EVM networks.
 *
 * @param signer - The TRON signer to sign the payload.
 * @param x402Version - The version of the x402 protocol.
 * @param paymentRequirements - The requirements for the payment.
 * @returns The generated payment payload.
 */
export async function createTIP712Payload(
  signer: ClientTronSigner,
  x402Version: number,
  paymentRequirements: PaymentRequirements,
): Promise<PaymentPayloadResult> {
  const nonce = createNonce();
  const now = Math.floor(Date.now() / 1000);

  const fromAddress = normalizeAddressForSigning(signer.address);
  const toAddress = normalizeAddressForSigning(paymentRequirements.payTo);

  const authorization: ExactTIP712Payload["authorization"] = {
    from: fromAddress,
    to: toAddress,
    value: paymentRequirements.amount,
    validAfter: (now - 600).toString(),
    validBefore: (now + paymentRequirements.maxTimeoutSeconds).toString(),
    nonce,
  };

  const signature = await signTIP712Authorization(signer, authorization, paymentRequirements);

  const payload: ExactTIP712Payload = {
    authorization,
    signature,
  };

  return {
    x402Version,
    payload,
  };
}

/**
 * Signs the TIP-712 authorization.
 *
 * @param signer - The TRON signer.
 * @param authorization - The authorization details.
 * @param requirements - The payment requirements.
 * @returns The signature.
 */
async function signTIP712Authorization(
  signer: ClientTronSigner,
  authorization: ExactTIP712Payload["authorization"],
  requirements: PaymentRequirements,
): Promise<`0x${string}`> {
  const chainId = getTronChainId(requirements.network);

  if (!requirements.extra?.name || !requirements.extra?.version) {
    throw new Error(
      `TIP-712 domain parameters (name, version) are required in payment requirements for asset ${requirements.asset}`,
    );
  }

  const { name, version } = requirements.extra;
  const tokenAddress = normalizeAddressForSigning(requirements.asset);

  const domain = {
    name,
    version,
    chainId,
    verifyingContract: tokenAddress,
  };

  const message = {
    from: authorization.from,
    to: authorization.to,
    value: BigInt(authorization.value),
    validAfter: BigInt(authorization.validAfter),
    validBefore: BigInt(authorization.validBefore),
    nonce: authorization.nonce,
  };

  return await signer.signTypedData({
    domain,
    types: authorizationTypes,
    primaryType: "TransferWithAuthorization",
    message,
  });
}

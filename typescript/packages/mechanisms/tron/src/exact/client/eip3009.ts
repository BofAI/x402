import { PaymentRequirements, PaymentPayloadResult } from "@bankofai/x402-core/types";
import { authorizationTypes } from "../../constants";
import { ClientTronSigner } from "../../signer";
import { ExactEIP3009Payload } from "../../types";
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
export async function createEIP3009Payload(
  signer: ClientTronSigner,
  x402Version: number,
  paymentRequirements: PaymentRequirements,
): Promise<PaymentPayloadResult> {
  const nonce = createNonce();
  const now = Math.floor(Date.now() / 1000);

  const fromAddress = normalizeAddressForSigning(signer.address);
  const toAddress = normalizeAddressForSigning(paymentRequirements.payTo);

  const authorization: ExactEIP3009Payload["authorization"] = {
    from: fromAddress,
    to: toAddress,
    value: paymentRequirements.amount,
    validAfter: (now - 600).toString(),
    validBefore: (now + paymentRequirements.maxTimeoutSeconds).toString(),
    nonce,
  };

  const signature = await signEIP3009Authorization(signer, authorization, paymentRequirements);

  const payload: ExactEIP3009Payload = {
    authorization,
    signature,
  };

  return {
    x402Version,
    payload,
  };
}

/**
 * Signs a TRON TransferWithAuthorization payload using TIP-712 typed data.
 *
 * @param signer - The client signer used to produce the authorization signature.
 * @param authorization - The authorization payload to sign.
 * @param requirements - The payment requirements containing token and domain data.
 * @returns The signed authorization bytes.
 */
async function signEIP3009Authorization(
  signer: ClientTronSigner,
  authorization: ExactEIP3009Payload["authorization"],
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

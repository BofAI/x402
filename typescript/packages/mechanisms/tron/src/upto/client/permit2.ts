import {
  PaymentPayloadContext,
  PaymentRequirements,
  PaymentPayloadResult,
} from "@bankofai/x402-core/types";
import {
  uptoPermit2WitnessTypes,
  PERMIT2_ADDRESSES,
  X402_UPTO_PERMIT2_PROXY_ADDRESSES,
} from "../../constants";
import { ClientTronSigner } from "../../signer";
import { UptoPermit2Payload } from "../../types";
import { createNonce, getTronChainId, normalizeAddressForSigning } from "../../utils";
import {
  isTrc20ApprovalResourceSponsoringDeclared,
  trySignTrc20ApprovalExtension,
} from "../../shared/extensions/resourceSponsoring";

/**
 * Creates an Upto Permit2 payload using the x402UptoPermit2Proxy witness pattern on TRON.
 *
 * The spender is set to x402UptoPermit2Proxy and the witness binds the settling
 * facilitator's address (taken from `requirements.extra.permit2FacilitatorAddress`).
 * `permitted.amount` is the maximum authorized amount; the facilitator may settle
 * for any amount up to it.
 *
 * @param signer - The TRON signer to sign the payload.
 * @param x402Version - The version of the x402 protocol.
 * @param paymentRequirements - The requirements for the payment.
 * @param context - Optional context containing Server-declared extensions.
 * @returns The generated payment payload.
 */
export async function createUptoPermit2Payload(
  signer: ClientTronSigner,
  x402Version: number,
  paymentRequirements: PaymentRequirements,
  context?: PaymentPayloadContext,
): Promise<PaymentPayloadResult> {
  const now = Math.floor(Date.now() / 1000);
  const nonce = createNonce();
  const network = paymentRequirements.network;

  const permit2Address = PERMIT2_ADDRESSES[network];
  if (!permit2Address) {
    throw new Error(`No Permit2 contract address configured for network ${network}`);
  }

  const proxyAddress = X402_UPTO_PERMIT2_PROXY_ADDRESSES[network];
  if (!proxyAddress) {
    throw new Error(`No x402UptoPermit2Proxy contract address configured for network ${network}`);
  }

  const facilitatorAddress = paymentRequirements.extra?.permit2FacilitatorAddress as
    | string
    | undefined;
  if (!facilitatorAddress) {
    throw new Error(
      "upto scheme requires permit2FacilitatorAddress in paymentRequirements.extra. " +
        "Ensure the server is configured with an upto facilitator that provides getExtra().",
    );
  }

  const validAfter = "0";
  const deadline = (now + paymentRequirements.maxTimeoutSeconds).toString();

  if (BigInt(deadline) <= BigInt(validAfter)) {
    throw new Error(
      `Invalid time window: deadline (${deadline}) must be after validAfter (${validAfter}). ` +
        `Check that maxTimeoutSeconds (${paymentRequirements.maxTimeoutSeconds}) is positive.`,
    );
  }

  const fromAddress = normalizeAddressForSigning(signer.address);
  const tokenAddress = normalizeAddressForSigning(paymentRequirements.asset);
  const payToAddress = normalizeAddressForSigning(paymentRequirements.payTo);
  const spenderAddress = normalizeAddressForSigning(proxyAddress);
  const facilitator = normalizeAddressForSigning(facilitatorAddress);

  const permit2Authorization: UptoPermit2Payload["permit2Authorization"] = {
    from: fromAddress,
    permitted: {
      token: tokenAddress,
      amount: paymentRequirements.amount,
    },
    spender: spenderAddress,
    nonce,
    deadline,
    witness: {
      to: payToAddress,
      facilitator,
      validAfter,
    },
  };

  const requiredAllowance = BigInt(paymentRequirements.amount);
  const sponsorshipDeclared = isTrc20ApprovalResourceSponsoringDeclared(context);
  if (!sponsorshipDeclared) {
    await signer.ensureAllowance?.({
      token: paymentRequirements.asset,
      amount: requiredAllowance,
      network,
    });
  }

  const signature = await signUptoPermit2Authorization(
    signer,
    permit2Authorization,
    paymentRequirements,
  );

  const payload: UptoPermit2Payload = {
    signature,
    permit2Authorization,
  };

  const approvalExtension = sponsorshipDeclared
    ? await trySignTrc20ApprovalExtension(
        signer,
        paymentRequirements,
        context,
        requiredAllowance.toString(),
      )
    : { handled: false, extensions: undefined };

  if (sponsorshipDeclared && !approvalExtension.handled) {
    await signer.ensureAllowance?.({
      token: paymentRequirements.asset,
      amount: requiredAllowance,
      network,
    });
  }

  return {
    x402Version,
    payload,
    ...(approvalExtension.extensions ? { extensions: approvalExtension.extensions } : {}),
  };
}

/**
 * Signs the Upto Permit2 authorization using the 3-field upto witness types.
 *
 * @param signer - The TRON signer.
 * @param permit2Authorization - The authorization details.
 * @param requirements - The payment requirements.
 * @returns The signature.
 */
async function signUptoPermit2Authorization(
  signer: ClientTronSigner,
  permit2Authorization: UptoPermit2Payload["permit2Authorization"],
  requirements: PaymentRequirements,
): Promise<`0x${string}`> {
  const chainId = getTronChainId(requirements.network);
  const permit2Address = normalizeAddressForSigning(PERMIT2_ADDRESSES[requirements.network]!);

  const domain = {
    name: "Permit2",
    chainId,
    verifyingContract: permit2Address,
  };

  const message = {
    permitted: {
      token: permit2Authorization.permitted.token,
      amount: BigInt(permit2Authorization.permitted.amount),
    },
    spender: permit2Authorization.spender,
    nonce: BigInt(permit2Authorization.nonce),
    deadline: BigInt(permit2Authorization.deadline),
    witness: {
      to: permit2Authorization.witness.to,
      facilitator: permit2Authorization.witness.facilitator,
      validAfter: BigInt(permit2Authorization.witness.validAfter),
    },
  };

  return await signer.signTypedData({
    domain,
    types: uptoPermit2WitnessTypes as unknown as Record<string, { name: string; type: string }[]>,
    primaryType: "PermitWitnessTransferFrom",
    message,
  });
}

import {
  PaymentPayloadContext,
  PaymentRequirements,
  PaymentPayloadResult,
} from "@bankofai/x402-core/types";
import {
  permit2WitnessTypes,
  PERMIT2_ADDRESSES,
  X402_PERMIT2_PROXY_ADDRESSES,
} from "../../constants";
import { ClientTronSigner } from "../../signer";
import { ExactPermit2Payload } from "../../types";
import { createNonce, getTronChainId, normalizeAddressForSigning } from "../../utils";
import { trySignTrc20ApprovalResourceSponsoringExtension } from "./trc20approval";
import { isTrc20ApprovalResourceSponsoringDeclared } from "../../shared/extensions/resourceSponsoring";

/**
 * Creates a Permit2 payload using the x402Permit2Proxy witness pattern on TRON.
 * The spender is set to x402Permit2Proxy, which enforces that funds
 * can only be sent to the witness.to address.
 *
 * @param signer - The TRON signer to sign the payload.
 * @param x402Version - The version of the x402 protocol.
 * @param paymentRequirements - The requirements for the payment.
 * @param context - Optional context containing Server-declared extensions.
 * @returns The generated payment payload.
 */
export async function createPermit2Payload(
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

  const proxyAddress = X402_PERMIT2_PROXY_ADDRESSES[network];
  if (!proxyAddress) {
    throw new Error(`No x402Permit2Proxy contract address configured for network ${network}`);
  }

  const validAfter = "0";
  const deadline = (now + paymentRequirements.maxTimeoutSeconds).toString();

  const fromAddress = normalizeAddressForSigning(signer.address);
  const tokenAddress = normalizeAddressForSigning(paymentRequirements.asset);
  const payToAddress = normalizeAddressForSigning(paymentRequirements.payTo);
  const spenderAddress = normalizeAddressForSigning(proxyAddress);

  const permit2Authorization: ExactPermit2Payload["permit2Authorization"] = {
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

  const signature = await signPermit2Authorization(
    signer,
    permit2Authorization,
    paymentRequirements,
  );

  const payload: ExactPermit2Payload = {
    signature,
    permit2Authorization,
  };

  const approvalExtension = sponsorshipDeclared
    ? await trySignTrc20ApprovalResourceSponsoringExtension(signer, paymentRequirements, context)
    : { handled: false, extensions: undefined };

  // Preserve the existing self-funded Approval fallback when the extension is
  // absent or the signer cannot create a serialized signed TRON transaction.
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
 * Signs the Permit2 authorization.
 *
 * @param signer - The TRON signer.
 * @param permit2Authorization - The authorization details.
 * @param requirements - The payment requirements.
 * @returns The signature.
 */
async function signPermit2Authorization(
  signer: ClientTronSigner,
  permit2Authorization: ExactPermit2Payload["permit2Authorization"],
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
      validAfter: BigInt(permit2Authorization.witness.validAfter),
    },
  };

  return await signer.signTypedData({
    domain,
    types: permit2WitnessTypes,
    primaryType: "PermitWitnessTransferFrom",
    message,
  });
}

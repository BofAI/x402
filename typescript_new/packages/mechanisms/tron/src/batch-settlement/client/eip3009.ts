import { PaymentRequirements, PaymentPayloadResult } from "@x402/core/types";
import { ClientTronSigner } from "../../signer";
import { createNonce, getTronChainId, normalizeAddressForSigning } from "../../utils";
import {
  getErc3009DepositCollectorAddress,
  receiveAuthorizationTypes,
} from "../../shared/batch-settlement/constants";
import { computeChannelId } from "../../shared/batch-settlement/utils";
import { buildErc3009DepositNonce } from "../../shared/batch-settlement/encoding";
import { ChannelConfig, BatchSettlementDepositPayload } from "../types";
import { signVoucher } from "./voucher";

/**
 * Creates a deposit payload bundling an ERC-3009 `ReceiveWithAuthorization`
 * approval together with a cumulative voucher signature (TIP-712).
 *
 * @param signer - Client wallet used to sign the ERC-3009 authorization (`from` = payer).
 * @param x402Version - Protocol version to embed in the payload envelope.
 * @param paymentRequirements - Server-provided payment requirements (asset, network, amount, etc.).
 * @param channelConfig - Immutable channel configuration (payer, receiver, token, …).
 * @param depositAmount - Number of tokens (decimal string) to deposit into the channel.
 * @param maxClaimableAmount - Cumulative ceiling for the accompanying voucher.
 * @param voucherSigner - Optional key that signs the voucher; defaults to `signer`.
 * @returns A {@link PaymentPayloadResult} with the signed deposit + voucher payload.
 */
export async function createBatchSettlementEIP3009DepositPayload(
  signer: ClientTronSigner,
  x402Version: number,
  paymentRequirements: PaymentRequirements,
  channelConfig: ChannelConfig,
  depositAmount: string,
  maxClaimableAmount: string,
  voucherSigner?: ClientTronSigner,
): Promise<PaymentPayloadResult> {
  const salt = createNonce();
  const now = Math.floor(Date.now() / 1000);
  const chainId = getTronChainId(paymentRequirements.network);

  if (!paymentRequirements.extra?.name || !paymentRequirements.extra?.version) {
    throw new Error(
      `TIP-712 domain parameters (name, version) are required in payment requirements for asset ${paymentRequirements.asset}`,
    );
  }

  const { name, version } = paymentRequirements.extra;
  const channelId = computeChannelId(channelConfig, paymentRequirements.network);
  const erc3009Nonce = buildErc3009DepositNonce(channelId, salt);

  const collector = getErc3009DepositCollectorAddress(paymentRequirements.network);
  const validAfter = (now - 600).toString();
  const validBefore = (now + paymentRequirements.maxTimeoutSeconds).toString();

  const signature = await signer.signTypedData({
    domain: {
      name,
      version,
      chainId,
      verifyingContract: normalizeAddressForSigning(paymentRequirements.asset),
    },
    types: receiveAuthorizationTypes as unknown as Record<
      string,
      Array<{ name: string; type: string }>
    >,
    primaryType: "ReceiveWithAuthorization",
    message: {
      from: normalizeAddressForSigning(signer.address),
      to: normalizeAddressForSigning(collector),
      value: BigInt(depositAmount),
      validAfter: BigInt(validAfter),
      validBefore: BigInt(validBefore),
      nonce: erc3009Nonce,
    },
  });

  const voucher = await signVoucher(
    voucherSigner ?? signer,
    channelId,
    maxClaimableAmount,
    paymentRequirements.network,
  );

  const payload: BatchSettlementDepositPayload = {
    type: "deposit",
    channelConfig,
    voucher,
    deposit: {
      amount: depositAmount,
      authorization: {
        erc3009Authorization: { validAfter, validBefore, salt, signature },
      },
    },
  };

  return { x402Version, payload };
}

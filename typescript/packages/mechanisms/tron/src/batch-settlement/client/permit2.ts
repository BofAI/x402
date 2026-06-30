import { PaymentRequirements, PaymentPayloadResult } from "@bankofai/x402-core/types";
import { ClientTronSigner } from "../../signer";
import { PERMIT2_ADDRESSES } from "../../constants";
import { createNonce, getTronChainId, normalizeAddressForSigning } from "../../utils";
import {
  getPermit2DepositCollectorAddress,
  batchPermit2WitnessTypes,
} from "../../shared/batch-settlement/constants";
import { computeChannelId } from "../../shared/batch-settlement/utils";
import { ChannelConfig, BatchSettlementDepositPayload } from "../types";
import { signVoucher } from "./voucher";

/**
 * Builds a batch deposit payload using a channel-bound Permit2 witness transfer.
 *
 * @param signer - Payer signer for the Permit2 authorization.
 * @param x402Version - Protocol version for the payment envelope.
 * @param paymentRequirements - Server-provided payment requirements.
 * @param channelConfig - Channel configuration bound into the voucher and witness.
 * @param depositAmount - Token amount deposited into the channel.
 * @param maxClaimableAmount - Cumulative amount signed in the voucher.
 * @param voucherSigner - Optional signer for the voucher.
 * @returns Signed deposit payload and voucher.
 */
export async function createBatchSettlementPermit2DepositPayload(
  signer: ClientTronSigner,
  x402Version: number,
  paymentRequirements: PaymentRequirements,
  channelConfig: ChannelConfig,
  depositAmount: string,
  maxClaimableAmount: string,
  voucherSigner?: ClientTronSigner,
): Promise<PaymentPayloadResult> {
  const network = paymentRequirements.network;
  const chainId = getTronChainId(network);

  const permit2Address = PERMIT2_ADDRESSES[network];
  if (!permit2Address) {
    throw new Error(`No Permit2 contract address configured for network ${network}`);
  }

  const nonce = createNonce();
  const deadline = Math.floor(Date.now() / 1000 + paymentRequirements.maxTimeoutSeconds).toString();
  const channelId = computeChannelId(channelConfig, network);

  const tokenAddress = normalizeAddressForSigning(paymentRequirements.asset);
  const spender = normalizeAddressForSigning(getPermit2DepositCollectorAddress(network));
  const from = normalizeAddressForSigning(signer.address);

  const permit2Authorization = {
    from,
    permitted: { token: tokenAddress, amount: depositAmount },
    spender,
    nonce,
    deadline,
    witness: { channelId },
  };

  const signature = await signer.signTypedData({
    domain: {
      name: "Permit2",
      chainId,
      verifyingContract: normalizeAddressForSigning(permit2Address),
    },
    types: batchPermit2WitnessTypes as unknown as Record<
      string,
      Array<{ name: string; type: string }>
    >,
    primaryType: "PermitWitnessTransferFrom",
    message: {
      permitted: { token: tokenAddress, amount: BigInt(depositAmount) },
      spender,
      nonce: BigInt(nonce),
      deadline: BigInt(deadline),
      witness: { channelId },
    },
  });

  const voucher = await signVoucher(
    voucherSigner ?? signer,
    channelId,
    maxClaimableAmount,
    network,
  );

  const payload: BatchSettlementDepositPayload = {
    type: "deposit",
    channelConfig,
    voucher,
    deposit: {
      amount: depositAmount,
      authorization: {
        permit2Authorization: { ...permit2Authorization, signature },
      },
    },
  };

  return { x402Version, payload };
}

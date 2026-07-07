import { ClientTronSigner } from "../../signer";
import { voucherTypes } from "../../shared/batch-settlement/constants";
import { getBatchSettlementTip712Domain } from "../../shared/batch-settlement/utils";
import { BatchSettlementVoucherFields } from "../types";

/**
 * Signs a cumulative voucher using the client's wallet (TIP-712).
 *
 * The voucher authorises the receiver to claim up to `maxClaimableAmount` from
 * the channel identified by `channelId`.
 *
 * @param signer - Client wallet used to produce the TIP-712 signature.
 * @param channelId - Identifier of the payment channel (see `computeChannelId`).
 * @param maxClaimableAmount - Cumulative ceiling the receiver may claim (decimal string).
 * @param network - CAIP-2 network identifier (e.g. `"tron:0xcd8690dc"`).
 * @returns Signed voucher fields ready to be included in a payment payload.
 */
export async function signVoucher(
  signer: ClientTronSigner,
  channelId: `0x${string}`,
  maxClaimableAmount: string,
  network: string,
): Promise<BatchSettlementVoucherFields> {
  const signature = await signer.signTypedData({
    domain: getBatchSettlementTip712Domain(network),
    types: voucherTypes as unknown as Record<string, Array<{ name: string; type: string }>>,
    primaryType: "Voucher",
    message: {
      channelId,
      maxClaimableAmount: BigInt(maxClaimableAmount),
    },
  });

  return {
    channelId,
    maxClaimableAmount,
    signature,
  };
}

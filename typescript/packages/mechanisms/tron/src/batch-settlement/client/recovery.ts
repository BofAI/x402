import type { PaymentRequired, PaymentRequirements } from "@x402/core/types";
import { normalizeAddressForSigning } from "../../utils";
import { BATCH_SETTLEMENT_SCHEME, voucherTypes } from "../../shared/batch-settlement/constants";
import {
  computeChannelId,
  getBatchSettlementTip712Domain,
  recoverTypedDataAddress,
} from "../../shared/batch-settlement/utils";
import * as Errors from "../errors";
import type { BatchSettlementChannelStateExtra, BatchSettlementVoucherStateExtra } from "../types";
import {
  type BatchSettlementClientDeps,
  buildChannelConfig,
  readChannelBalanceAndTotalClaimed,
} from "./channel";
import type { BatchSettlementClientContext } from "./storage";

/**
 * Handles a corrective 402 response from the server when the client's cumulative
 * base is out of sync.
 *
 * @param deps - Signer + storage + identity inputs.
 * @param paymentRequired - The decoded 402 response body.
 * @returns `true` if the channel state was resynced and the request can be retried.
 */
export async function processCorrectivePaymentRequired(
  deps: BatchSettlementClientDeps,
  paymentRequired: PaymentRequired,
): Promise<boolean> {
  if (
    paymentRequired.error !== Errors.ErrCumulativeAmountMismatch &&
    paymentRequired.error !== Errors.ErrCumulativeAmountBelowClaimed
  ) {
    return false;
  }

  const accept = paymentRequired.accepts.find(a => a.scheme === BATCH_SETTLEMENT_SCHEME);
  if (!accept) return false;

  const channelState = accept.extra.channelState as BatchSettlementChannelStateExtra | undefined;
  const voucherState = accept.extra.voucherState as BatchSettlementVoucherStateExtra | undefined;
  const hasSig =
    channelState?.chargedCumulativeAmount !== undefined &&
    voucherState?.signedMaxClaimable !== undefined &&
    voucherState.signature !== undefined;

  if (!hasSig) return recoverFromOnChainState(deps, accept);
  return recoverFromSignature(deps, accept, channelState, voucherState);
}

/**
 * Recovers channel state from a corrective 402 that includes a server-provided
 * voucher signature, verifying it matches the client's own signing key.
 *
 * @param deps - Signer + storage + identity inputs.
 * @param accept - Batch settlement payment requirements from the corrective 402.
 * @param channelState - Server channel snapshot.
 * @param voucherState - Latest signed voucher proof.
 * @returns `true` when local channel state was updated successfully.
 */
export async function recoverFromSignature(
  deps: BatchSettlementClientDeps,
  accept: PaymentRequirements,
  channelState: BatchSettlementChannelStateExtra,
  voucherState: BatchSettlementVoucherStateExtra,
): Promise<boolean> {
  const charged = BigInt(String(channelState.chargedCumulativeAmount));
  const signed = BigInt(String(voucherState.signedMaxClaimable));
  const sig = voucherState.signature as `0x${string}`;

  if (charged > signed) return false;

  const config = buildChannelConfig(deps, accept);
  const channelId = computeChannelId(config, accept.network);

  const [chBalance, chTotalClaimed] = await readChannelBalanceAndTotalClaimed(
    deps.signer,
    channelId,
    accept.network,
  );

  if (charged < chTotalClaimed) return false;

  const recovered = recoverTypedDataAddress(
    getBatchSettlementTip712Domain(accept.network),
    voucherTypes,
    { channelId, maxClaimableAmount: signed },
    sig,
  );

  const expectedSigner = normalizeAddressForSigning(
    deps.payerAuthorizer ?? deps.voucherSigner?.address ?? deps.signer.address,
  );
  if (recovered.toLowerCase() !== expectedSigner.toLowerCase()) return false;

  const ctx: BatchSettlementClientContext = {
    chargedCumulativeAmount: charged.toString(),
    signedMaxClaimable: signed.toString(),
    signature: sig,
    balance: chBalance.toString(),
    totalClaimed: chTotalClaimed.toString(),
  };

  await deps.storage.set(channelId.toLowerCase(), ctx);
  return true;
}

/**
 * Recovers channel state purely from onchain state when the server has no stored
 * voucher (e.g. after a cooperative refund deleted the channel record).
 *
 * @param deps - Signer + storage + identity inputs.
 * @param accept - Batch settlement payment requirements from the corrective 402.
 * @returns `true` when local channel state was updated from onchain data.
 */
export async function recoverFromOnChainState(
  deps: BatchSettlementClientDeps,
  accept: PaymentRequirements,
): Promise<boolean> {
  const config = buildChannelConfig(deps, accept);
  const channelId = computeChannelId(config, accept.network);

  const [chBalance, chTotalClaimed] = await readChannelBalanceAndTotalClaimed(
    deps.signer,
    channelId,
    accept.network,
  );

  const ctx: BatchSettlementClientContext = {
    chargedCumulativeAmount: chTotalClaimed.toString(),
    balance: chBalance.toString(),
    totalClaimed: chTotalClaimed.toString(),
  };

  await deps.storage.set(channelId.toLowerCase(), ctx);
  return true;
}

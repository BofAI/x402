import {
  PaymentPayload,
  PaymentRequirements,
  SchemeNetworkFacilitator,
  FacilitatorContext,
  SettleResponse,
  VerifyResponse,
} from "@bankofai/x402-core/types";
import { FacilitatorTronSigner } from "../../signer";
import { BATCH_SETTLEMENT_SCHEME } from "../../shared/batch-settlement/constants";
import {
  isBatchSettlementDepositPayload,
  isBatchSettlementVoucherPayload,
  isBatchSettlementClaimPayload,
  isBatchSettlementSettlePayload,
  isBatchSettlementRefundPayload,
  isBatchSettlementEnrichedRefundPayload,
  type TronAuthorizerSigner,
} from "../types";
import { verifyDeposit, settleDeposit } from "./deposit";
import { verifyVoucher } from "./voucher";
import { executeClaimWithSignature } from "./claim";
import { executeSettle } from "./settle";
import { executeRefundWithSignature } from "./refund";
import * as Errors from "../errors";

/**
 * Facilitator-side implementation of the `batch-settlement` scheme for TRON networks.
 *
 * Routes incoming verify/settle requests to the appropriate handler based on
 * payload type (deposit, voucher, claim, settle, refund).
 */
export class BatchSettlementTronScheme implements SchemeNetworkFacilitator {
  readonly scheme = BATCH_SETTLEMENT_SCHEME;
  readonly caipFamily = "tron:*";

  /**
   * Creates a facilitator scheme for verifying and settling batch-settlement payments.
   *
   * @param signer - Facilitator TRON signer used for tx submission and onchain reads.
   * @param authorizerSigner - Dedicated key that provides TIP-712 signatures for
   *   `claimWithSignature` / `refundWithSignature` when the server omits them.
   */
  constructor(
    private readonly signer: FacilitatorTronSigner,
    private readonly authorizerSigner: TronAuthorizerSigner,
  ) {}

  /**
   * Returns facilitator-specific extra fields to be merged into payment requirements.
   *
   * @param _ - Network identifier (unused).
   * @returns Extra fields containing `receiverAuthorizer`.
   */
  getExtra(_: string): { receiverAuthorizer: string } | undefined {
    void _;
    return { receiverAuthorizer: this.authorizerSigner.address };
  }

  /**
   * Returns all facilitator signer addresses available for the given network.
   *
   * @param _ - Network identifier (unused).
   * @returns Array of addresses.
   */
  getSigners(_: string): string[] {
    void _;
    return [...this.signer.getAddresses()];
  }

  /**
   * Verifies a payment payload (deposit or voucher) without executing settlement.
   *
   * @param payload - The x402 payment payload envelope.
   * @param requirements - Server payment requirements.
   * @param context - Optional facilitator extension context (unused).
   * @returns A {@link VerifyResponse} indicating validity with payer and channel state in `extra`.
   */
  async verify(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
    context?: FacilitatorContext,
  ): Promise<VerifyResponse> {
    void context;
    const rawPayload = payload.payload;

    if (
      payload.accepted.scheme !== BATCH_SETTLEMENT_SCHEME ||
      requirements.scheme !== BATCH_SETTLEMENT_SCHEME
    ) {
      return { isValid: false, invalidReason: Errors.ErrInvalidScheme };
    }
    if (payload.accepted.network !== requirements.network) {
      return { isValid: false, invalidReason: Errors.ErrNetworkMismatch };
    }

    if (isBatchSettlementDepositPayload(rawPayload)) {
      return verifyDeposit(this.signer, payload, rawPayload, requirements);
    }
    if (isBatchSettlementVoucherPayload(rawPayload)) {
      return verifyVoucher(this.signer, rawPayload, requirements, rawPayload.channelConfig);
    }
    if (isBatchSettlementRefundPayload(rawPayload)) {
      return verifyVoucher(this.signer, rawPayload, requirements, rawPayload.channelConfig);
    }

    return { isValid: false, invalidReason: Errors.ErrInvalidPayloadType };
  }

  /**
   * Executes settlement for a payment payload, dispatching by settle action.
   *
   * @param payload - The x402 payment payload envelope.
   * @param requirements - Server payment requirements.
   * @param context - Optional facilitator extension context (unused).
   * @returns A {@link SettleResponse} with the transaction hash on success.
   */
  async settle(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
    context?: FacilitatorContext,
  ): Promise<SettleResponse> {
    void context;
    const rawPayload = payload.payload;

    if (isBatchSettlementDepositPayload(rawPayload)) {
      return settleDeposit(this.signer, payload, rawPayload, requirements);
    }
    if (isBatchSettlementClaimPayload(rawPayload)) {
      return executeClaimWithSignature(
        this.signer,
        rawPayload,
        requirements,
        this.authorizerSigner,
      );
    }
    if (isBatchSettlementEnrichedRefundPayload(rawPayload)) {
      return executeRefundWithSignature(
        this.signer,
        rawPayload,
        requirements,
        this.authorizerSigner,
      );
    }
    if (isBatchSettlementSettlePayload(rawPayload)) {
      return executeSettle(this.signer, rawPayload, requirements);
    }

    return {
      success: false,
      errorReason: Errors.ErrInvalidPayloadType,
      transaction: "",
      network: requirements.network,
    };
  }
}

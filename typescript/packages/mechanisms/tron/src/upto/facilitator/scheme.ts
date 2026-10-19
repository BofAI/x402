import {
  TronSettlementTracker,
  type TronSettlementOptions,
  type TronPendingSettlementContext,
} from "../../shared/pendingSettlement";
import {
  PaymentPayload,
  PaymentRequirements,
  SchemeNetworkFacilitator,
  FacilitatorContext,
  SettleResponse,
  VerifyResponse,
} from "@x402/core/types";
import { FacilitatorTronSigner } from "../../signer";
import { UptoPermit2Payload, isUptoPermit2Payload } from "../../types";
import { X402_UPTO_PERMIT2_PROXY_ADDRESSES } from "../../constants";
import { verifyUptoPermit2, settleUptoPermit2 } from "./permit2";
import * as errors from "./errors";

/**
 * TRON facilitator implementation for the Upto payment scheme.
 * Settles Permit2 authorizations for an actual amount up to the authorized maximum.
 */
export class UptoTronScheme implements SchemeNetworkFacilitator {
  readonly scheme = "upto";
  readonly caipFamily = "tron:*";
  private readonly settlement: TronSettlementTracker;

  /**
   * Creates a new UptoTronScheme facilitator instance.
   *
   * @param signer - The TRON signer for facilitator operations
   * @param options - Pending settlement storage configuration.
   */
  constructor(
    private readonly signer: FacilitatorTronSigner,
    options: TronSettlementOptions = {},
  ) {
    this.settlement = new TronSettlementTracker(options.pendingSettlementStore);
  }

  /**
   * Returns extra metadata for the upto scheme, including the facilitator address
   * the client must bind into the witness.
   *
   * @param network - The network identifier
   * @returns The extra configuration object, or undefined when unavailable
   */
  getExtra(network: string): Record<string, unknown> | undefined {
    if (!X402_UPTO_PERMIT2_PROXY_ADDRESSES[network]) {
      return undefined;
    }
    const signers = this.signer.getAddresses();
    if (signers.length === 0) {
      return undefined;
    }
    const permit2FacilitatorAddress = signers[Math.floor(Math.random() * signers.length)];
    return {
      assetTransferMethod: "permit2",
      permit2FacilitatorAddress,
    };
  }

  /**
   * Returns facilitator wallet addresses for the supported response.
   *
   * @param _ - The network identifier (unused, addresses are network-agnostic)
   * @returns Array of facilitator wallet addresses
   */
  getSigners(_: string): string[] {
    return [...this.signer.getAddresses()];
  }

  /**
   * Verifies an upto payment payload.
   *
   * @param payload - The payment payload to verify
   * @param requirements - The payment requirements (amount = authorized maximum)
   * @param context - Optional facilitator context (unused)
   * @returns Promise resolving to verification response
   */
  async verify(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
    context?: FacilitatorContext,
  ): Promise<VerifyResponse> {
    const rawPayload = payload.payload as Record<string, unknown>;
    if (!isUptoPermit2Payload(rawPayload)) {
      return { isValid: false, invalidReason: errors.UNSUPPORTED_PAYLOAD_TYPE, payer: "" };
    }

    return verifyUptoPermit2(
      this.signer,
      payload,
      requirements,
      rawPayload as UptoPermit2Payload,
      context,
    );
  }

  /**
   * Settles an upto payment for the actual amount in `requirements.amount`.
   *
   * @param payload - The payment payload to settle
   * @param requirements - The payment requirements (amount = actual settlement amount)
   * @param context - Optional facilitator context (unused)
   * @returns Promise resolving to settlement response
   */
  async settle(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
    context?: FacilitatorContext,
  ): Promise<SettleResponse> {
    return this.settlement.run(payload, requirements, pending =>
      this.settleOnce(payload, requirements, context, pending),
    );
  }

  /**
   * Dispatch a settlement using the original transaction when one exists.
   *
   * @param payload - Payment payload for this settlement.
   * @param requirements - Effective payment requirements, including the actual settlement amount.
   * @param context - Registered facilitator extension capabilities.
   * @param pending - Original-transaction tracking for this attempt.
   * @returns Settlement result preserving the original transaction identity.
   */
  private async settleOnce(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
    context: FacilitatorContext | undefined,
    pending: TronPendingSettlementContext,
  ): Promise<SettleResponse> {
    const rawPayload = payload.payload as Record<string, unknown>;
    if (!isUptoPermit2Payload(rawPayload)) {
      return {
        success: false,
        network: payload.accepted.network,
        transaction: "",
        errorReason: errors.UNSUPPORTED_PAYLOAD_TYPE,
        payer: "",
      };
    }

    return settleUptoPermit2(
      this.signer,
      payload,
      requirements,
      rawPayload as UptoPermit2Payload,
      context,
      pending,
    );
  }
}

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
import { ExactEIP3009Payload, ExactTronPayload, isPermit2Payload } from "../../types";
import { X402_PERMIT2_PROXY_ADDRESSES } from "../../constants";
import { verifyEIP3009, settleEIP3009 } from "./eip3009";
import { verifyPermit2, settlePermit2 } from "./permit2";
import { TRC20_APPROVAL_RESOURCE_SPONSORING_KEY } from "../../shared/extensions/trc20ApprovalContract";
import * as errors from "./errors";

/**
 * TRON facilitator implementation for the Exact payment scheme.
 * Thin router that delegates to TIP-712 or Permit2 based on payload type.
 */
export class ExactTronScheme implements SchemeNetworkFacilitator {
  readonly scheme = "exact";
  readonly caipFamily = "tron:*";
  private readonly settlement: TronSettlementTracker;

  /**
   * Creates a new ExactTronScheme facilitator instance.
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
   * Gets extra configuration for the facilitator.
   *
   * @param network - The network identifier
   * @returns The extra configuration object
   */
  getExtra(network: string): Record<string, unknown> | undefined {
    const supportedMethods: string[] = ["eip3009"];
    const signers = this.signer.getAddresses();
    if (X402_PERMIT2_PROXY_ADDRESSES[network]) {
      supportedMethods.push("permit2");
    }
    return {
      supportedAssetTransferMethods: supportedMethods,
      // The 2-field `exact` witness does not bind a facilitator, so the client
      // ignores this. Emitted for the upcoming `upto` path, whose 3-field witness
      // requires the client to sign over the settling facilitator's address.
      ...(signers.length > 0 && X402_PERMIT2_PROXY_ADDRESSES[network]
        ? { permit2FacilitatorAddress: signers[0] }
        : {}),
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
   * Verifies a payment payload. Routes to Permit2 or TIP-712 based on payload type.
   *
   * @param payload - The payment payload to verify
   * @param requirements - The payment requirements
   * @param context - Optional facilitator context for extension capabilities
   * @returns Promise resolving to verification response
   */
  async verify(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
    context?: FacilitatorContext,
  ): Promise<VerifyResponse> {
    const rawPayload = payload.payload as ExactTronPayload;

    if (isPermit2Payload(rawPayload)) {
      return verifyPermit2(this.signer, payload, requirements, rawPayload, context);
    }

    if (
      Object.prototype.hasOwnProperty.call(
        payload.extensions ?? {},
        TRC20_APPROVAL_RESOURCE_SPONSORING_KEY,
      )
    ) {
      return { isValid: false, invalidReason: errors.APPROVAL_EXTENSION_INVALID };
    }

    return verifyEIP3009(this.signer, payload, requirements, rawPayload as ExactEIP3009Payload);
  }

  /**
   * Settles a payment. Routes to Permit2 or TIP-712 based on payload type.
   *
   * @param payload - The payment payload to settle
   * @param requirements - The payment requirements
   * @param context - Optional facilitator context for extension capabilities
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
    const rawPayload = payload.payload as ExactTronPayload;

    if (isPermit2Payload(rawPayload)) {
      return settlePermit2(this.signer, payload, requirements, rawPayload, context, pending);
    }

    if (
      Object.prototype.hasOwnProperty.call(
        payload.extensions ?? {},
        TRC20_APPROVAL_RESOURCE_SPONSORING_KEY,
      )
    ) {
      return {
        success: false,
        network: payload.accepted.network,
        transaction: "",
        errorReason: errors.APPROVAL_EXTENSION_INVALID,
      };
    }

    return settleEIP3009(
      this.signer,
      payload,
      requirements,
      rawPayload as ExactEIP3009Payload,
      pending,
    );
  }
}

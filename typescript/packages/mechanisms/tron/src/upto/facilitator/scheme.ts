import {
  PaymentPayload,
  PaymentRequirements,
  SchemeNetworkFacilitator,
  FacilitatorContext,
  SettleResponse,
  VerifyResponse,
} from "@bankofai/x402-core/types";
import { FacilitatorTronSigner } from "../../signer";
import { UptoPermit2Payload, isUptoPermit2Payload } from "../../types";
import { X402_UPTO_PERMIT2_PROXY_ADDRESSES } from "../../constants";
import { verifyUptoPermit2, settleUptoPermit2 } from "./permit2";
import * as errors from "./errors";
import {
  createTronSettlementReconciliationContext,
  parseTronSettlementReconciliationContext,
  reconcileTronSettlement,
} from "../../reconciliation";

/**
 * TRON facilitator implementation for the Upto payment scheme.
 * Settles Permit2 authorizations for an actual amount up to the authorized maximum.
 */
export class UptoTronScheme implements SchemeNetworkFacilitator {
  readonly scheme = "upto";
  readonly caipFamily = "tron:*";

  /**
   * Creates a new UptoTronScheme facilitator instance.
   *
   * @param signer - The TRON signer for facilitator operations
   */
  constructor(private readonly signer: FacilitatorTronSigner) {}

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
    );
  }

  /**
   * Reconcile an already-broadcast upto settlement from solidified chain data.
   * This path is strictly read-only and never broadcasts.
   *
   * @param transaction - Original settlement transaction id
   * @param contextOrPayload - Persisted context, or the original payment payload
   * @param requirements - Actual requirements when rebuilding a legacy context
   * @returns Final success/failure, or settlement_pending while indeterminate
   */
  async reconcile(
    transaction: string,
    contextOrPayload: unknown,
    requirements?: PaymentRequirements,
  ): Promise<SettleResponse> {
    const reconciliationContext = requirements
      ? createTronSettlementReconciliationContext(contextOrPayload as PaymentPayload, requirements)
      : parseTronSettlementReconciliationContext(contextOrPayload);
    if (reconciliationContext.scheme !== "upto") {
      throw new Error("invalid upto reconciliation context scheme");
    }
    return reconcileTronSettlement(this.signer, transaction, reconciliationContext);
  }
}

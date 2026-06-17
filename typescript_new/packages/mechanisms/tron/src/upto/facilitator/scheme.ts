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
import { ExactTronFeeConfig } from "../../shared/fee";
import { verifyUptoPermit2, settleUptoPermit2 } from "./permit2";
import * as errors from "./errors";

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
   * @param feeConfig - Optional facilitator fee configuration (advertised via getExtra).
   */
  constructor(
    private readonly signer: FacilitatorTronSigner,
    private readonly feeConfig: ExactTronFeeConfig = {},
  ) {}

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
    const facilitatorAddress = signers[Math.floor(Math.random() * signers.length)];
    return {
      assetTransferMethod: "permit2",
      facilitatorAddress,
      permit2FacilitatorAddress: facilitatorAddress,
      ...(this.feeConfig.baseFee
        ? {
            feeConfig: {
              feeTo: this.feeConfig.feeTo ?? signers[0],
              ...(this.feeConfig.caller ? { caller: this.feeConfig.caller } : {}),
              baseFee: this.feeConfig.baseFee,
              ...(this.feeConfig.allowedTokens
                ? { allowedTokens: this.feeConfig.allowedTokens }
                : {}),
            },
          }
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
    void context;

    const rawPayload = payload.payload as Record<string, unknown>;
    if (!isUptoPermit2Payload(rawPayload)) {
      return { isValid: false, invalidReason: errors.UNSUPPORTED_PAYLOAD_TYPE, payer: "" };
    }

    return verifyUptoPermit2(this.signer, payload, requirements, rawPayload as UptoPermit2Payload);
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
    void context;

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

    return settleUptoPermit2(this.signer, payload, requirements, rawPayload as UptoPermit2Payload);
  }
}

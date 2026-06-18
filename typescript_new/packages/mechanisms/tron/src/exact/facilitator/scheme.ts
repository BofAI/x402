import {
  PaymentPayload,
  PaymentRequirements,
  SchemeNetworkFacilitator,
  FacilitatorContext,
  SettleResponse,
  VerifyResponse,
} from "@bankofai/x402-core/types";
import { FacilitatorTronSigner } from "../../signer";
import { ExactEIP3009Payload, ExactTronPayload, isPermit2Payload } from "../../types";
import { X402_PERMIT2_PROXY_ADDRESSES } from "../../constants";
import { ExactTronFeeConfig } from "../../shared/fee";
import { verifyEIP3009, settleEIP3009 } from "./eip3009";
import { verifyPermit2, settlePermit2 } from "./permit2";

/**
 * TRON facilitator implementation for the Exact payment scheme.
 * Thin router that delegates to TIP-712 or Permit2 based on payload type.
 */
export class ExactTronScheme implements SchemeNetworkFacilitator {
  readonly scheme = "exact";
  readonly caipFamily = "tron:*";

  /**
   * Creates a new ExactTronScheme facilitator instance.
   *
   * @param signer - The TRON signer for facilitator operations
   * @param feeConfig - Optional facilitator fee configuration. On the deployed
   *   exact/permit2 proxy the fee is advisory only (the proxy transfers exactly
   *   `amount` and does not split a fee); it is advertised so clients and other
   *   schemes (e.g. GasFree) can observe and enforce it.
   */
  constructor(
    private readonly signer: FacilitatorTronSigner,
    private readonly feeConfig: ExactTronFeeConfig = {},
  ) {}

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
      // Advertise the fee configuration so the server can attach per-asset fee
      // terms to requirements (extra.fee) and clients/other schemes can observe
      // it. Only emitted when a baseFee is configured.
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
    // Mark unused parameters to satisfy linter
    void context;

    const rawPayload = payload.payload as ExactTronPayload;

    if (isPermit2Payload(rawPayload)) {
      return verifyPermit2(this.signer, payload, requirements, rawPayload);
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
    // Mark unused parameters to satisfy linter
    void context;

    const rawPayload = payload.payload as ExactTronPayload;

    if (isPermit2Payload(rawPayload)) {
      return settlePermit2(this.signer, payload, requirements, rawPayload);
    }

    return settleEIP3009(this.signer, payload, requirements, rawPayload as ExactEIP3009Payload);
  }
}

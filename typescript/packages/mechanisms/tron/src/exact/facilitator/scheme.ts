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
   */
  constructor(private readonly signer: FacilitatorTronSigner) {}

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

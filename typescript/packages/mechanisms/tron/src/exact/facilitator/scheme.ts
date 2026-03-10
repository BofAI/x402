import {
  PaymentPayload,
  PaymentRequirements,
  SchemeNetworkFacilitator,
  FacilitatorContext,
  SettleResponse,
  VerifyResponse,
} from "@bankofai/x402-core/types";
import { FacilitatorTronSigner } from "../../signer";
import { ExactTronPayload, ExactTIP712Payload, isPermit2Payload } from "../../types";
import { X402_PERMIT2_PROXY_ADDRESSES } from "../../constants";
import { verifyTIP712, settleTIP712 } from "./tip712";
import { verifyPermit2, settlePermit2 } from "./permit2";

/**
 * TRON facilitator implementation for the Exact payment scheme.
 * Thin router that delegates to TIP-712 or Permit2 based on payload type.
 */
export class ExactTronScheme implements SchemeNetworkFacilitator {
  readonly scheme = "exact";
  readonly caipFamily = "tron:*";

  constructor(private readonly signer: FacilitatorTronSigner) {}

  getExtra(network: string): Record<string, unknown> | undefined {
    const supportedMethods: string[] = ["tip712"];
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

  getSigners(_: string): string[] {
    return [...this.signer.getAddresses()];
  }

  async verify(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
    _context?: FacilitatorContext,
  ): Promise<VerifyResponse> {
    const rawPayload = payload.payload as ExactTronPayload;

    if (isPermit2Payload(rawPayload)) {
      return verifyPermit2(this.signer, payload, requirements, rawPayload);
    }

    return verifyTIP712(this.signer, payload, requirements, rawPayload as ExactTIP712Payload);
  }

  async settle(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
    _context?: FacilitatorContext,
  ): Promise<SettleResponse> {
    const rawPayload = payload.payload as ExactTronPayload;

    if (isPermit2Payload(rawPayload)) {
      return settlePermit2(this.signer, payload, requirements, rawPayload);
    }

    return settleTIP712(this.signer, payload, requirements, rawPayload as ExactTIP712Payload);
  }
}

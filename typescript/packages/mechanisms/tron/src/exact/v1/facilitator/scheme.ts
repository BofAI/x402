import {
  PaymentPayload,
  PaymentRequirements,
  SchemeNetworkFacilitator,
  SettleResponse,
  VerifyResponse,
} from "@bankofai/x402-core/types";
import { PaymentRequirementsV1 } from "@bankofai/x402-core/types/v1";
import { FacilitatorTronSigner } from "../../../signer";
import { ExactEIP3009Payload } from "../../../types";
import { verifyEIP3009, settleEIP3009 } from "../../facilitator/eip3009";

/**
 * TRON facilitator implementation for the Exact payment scheme (V1).
 * V1 uses the EIP-3009-style TransferWithAuthorization flow only.
 */
export class ExactTronSchemeV1 implements SchemeNetworkFacilitator {
  readonly scheme = "exact";
  readonly caipFamily = "tron:*";

  constructor(private readonly signer: FacilitatorTronSigner) {}

  getExtra(_: string): Record<string, unknown> | undefined {
    return undefined;
  }

  getSigners(_: string): string[] {
    return [...this.signer.getAddresses()];
  }

  async verify(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<VerifyResponse> {
    const requirementsV1 = requirements as unknown as PaymentRequirementsV1;
    const tronPayload = payload.payload as ExactEIP3009Payload;

    const v2LikeRequirements: PaymentRequirements = {
      scheme: requirementsV1.scheme,
      network: requirementsV1.network,
      amount: requirementsV1.maxAmountRequired,
      asset: requirementsV1.asset,
      payTo: requirementsV1.payTo,
      maxTimeoutSeconds: requirementsV1.maxTimeoutSeconds,
      extra: requirementsV1.extra,
    };

    const v2LikePayload: PaymentPayload = {
      x402Version: payload.x402Version,
      accepted: v2LikeRequirements,
      payload: tronPayload,
    };

    return verifyEIP3009(this.signer, v2LikePayload, v2LikeRequirements, tronPayload);
  }

  async settle(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<SettleResponse> {
    const requirementsV1 = requirements as unknown as PaymentRequirementsV1;
    const tronPayload = payload.payload as ExactEIP3009Payload;

    const v2LikeRequirements: PaymentRequirements = {
      scheme: requirementsV1.scheme,
      network: requirementsV1.network,
      amount: requirementsV1.maxAmountRequired,
      asset: requirementsV1.asset,
      payTo: requirementsV1.payTo,
      maxTimeoutSeconds: requirementsV1.maxTimeoutSeconds,
      extra: requirementsV1.extra,
    };

    const v2LikePayload: PaymentPayload = {
      x402Version: payload.x402Version,
      accepted: v2LikeRequirements,
      payload: tronPayload,
    };

    return settleEIP3009(this.signer, v2LikePayload, v2LikeRequirements, tronPayload);
  }
}

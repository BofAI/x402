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
  /** The payment scheme identifier. */
  readonly scheme = "exact";
  /** The CAIP family supported by this facilitator. */
  readonly caipFamily = "tron:*";

  /**
   * Creates a V1 TRON exact scheme facilitator.
   *
   * @param signer - The facilitator signer used for verification and settlement.
   */
  constructor(private readonly signer: FacilitatorTronSigner) {}

  /**
   * Returns extra facilitator metadata for a network.
   *
   * @param _ - The target network identifier.
   * @returns No extra metadata for the V1 adapter.
   */
  getExtra(_: string): Record<string, unknown> | undefined {
    return undefined;
  }

  /**
   * Returns the facilitator signer addresses for a network.
   *
   * @param _ - The target network identifier.
   * @returns The facilitator addresses exposed by the wrapped signer.
   */
  getSigners(_: string): string[] {
    return [...this.signer.getAddresses()];
  }

  /**
   * Verifies a V1 payload by adapting it to the V2 EIP-3009 verifier.
   *
   * @param payload - The payment payload supplied by the payer.
   * @param requirements - The matched V1 payment requirements.
   * @returns The verification result from the V2 verifier.
   */
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

  /**
   * Settles a V1 payload by adapting it to the V2 EIP-3009 settler.
   *
   * @param payload - The payment payload supplied by the payer.
   * @param requirements - The matched V1 payment requirements.
   * @returns The settlement result from the V2 settler.
   */
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

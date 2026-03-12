import {
  Network,
  PaymentPayload,
  PaymentRequirements,
  SchemeNetworkClient,
} from "@bankofai/x402-core/types";
import { PaymentRequirementsV1 } from "@bankofai/x402-core/types/v1";
import { ClientTronSigner } from "../../../signer";
import { createEIP3009Payload } from "../../client/eip3009";

/**
 * TRON client implementation for the Exact payment scheme (V1).
 * V1 uses the EIP-3009-style TransferWithAuthorization flow only.
 */
export class ExactTronSchemeV1 implements SchemeNetworkClient {
  /** The payment scheme identifier. */
  readonly scheme = "exact";

  /**
   * Creates a V1 TRON exact scheme client.
   *
   * @param signer - The signer used to create payment payloads.
   */
  constructor(private readonly signer: ClientTronSigner) {}

  /**
   * Creates a V1-compatible payment payload using the V2 EIP-3009 implementation.
   *
   * @param x402Version - The x402 protocol version requested by the server.
   * @param paymentRequirements - The selected payment requirements to satisfy.
   * @returns A V1-compatible payment payload envelope.
   */
  async createPaymentPayload(
    x402Version: number,
    paymentRequirements: PaymentRequirements,
  ): Promise<
    Pick<PaymentPayload, "x402Version" | "payload"> & { scheme: string; network: Network }
  > {
    const selectedV1 = paymentRequirements as unknown as PaymentRequirementsV1;

    const v2LikeRequirements: PaymentRequirements = {
      scheme: selectedV1.scheme,
      network: selectedV1.network,
      amount: selectedV1.maxAmountRequired,
      asset: selectedV1.asset,
      payTo: selectedV1.payTo,
      maxTimeoutSeconds: selectedV1.maxTimeoutSeconds,
      extra: selectedV1.extra,
    };

    const result = await createEIP3009Payload(this.signer, x402Version, v2LikeRequirements);

    return {
      x402Version,
      scheme: selectedV1.scheme,
      network: selectedV1.network,
      payload: result.payload,
    };
  }
}

import {
  PaymentRequirements,
  SchemeNetworkClient,
  PaymentPayloadResult,
  PaymentPayloadContext,
} from "@bankofai/x402-core/types";
import { ClientTronSigner } from "../../signer";
import { AssetTransferMethod } from "../../types";
import { createTIP712Payload } from "./tip712";
import { createPermit2Payload } from "./permit2";

/**
 * TRON client implementation for the Exact payment scheme.
 * Supports both TIP-712 TransferWithAuthorization and Permit2 flows.
 *
 * Routes to the appropriate authorization method based on
 * `requirements.extra.assetTransferMethod`. Defaults to TIP-712
 * for backward compatibility with older facilitators.
 */
export class ExactTronScheme implements SchemeNetworkClient {
  readonly scheme = "exact";

  /**
   * Creates a new ExactTronScheme instance.
   *
   * @param signer - The TRON signer for client operations.
   */
  constructor(private readonly signer: ClientTronSigner) {}

  /**
   * Creates a payment payload for the Exact scheme.
   * Routes to TIP-712 or Permit2 based on requirements.extra.assetTransferMethod.
   *
   * @param x402Version - The x402 protocol version
   * @param paymentRequirements - The payment requirements
   * @param context - Optional context with server-declared extensions
   * @returns Promise resolving to a payment payload result
   */
  async createPaymentPayload(
    x402Version: number,
    paymentRequirements: PaymentRequirements,
    context?: PaymentPayloadContext,
  ): Promise<PaymentPayloadResult> {
    // Mark unused parameters to satisfy linter
    void context;

    const assetTransferMethod =
      (paymentRequirements.extra?.assetTransferMethod as AssetTransferMethod) ?? "tip712";

    if (assetTransferMethod === "permit2") {
      return createPermit2Payload(this.signer, x402Version, paymentRequirements);
    }

    return createTIP712Payload(this.signer, x402Version, paymentRequirements);
  }
}

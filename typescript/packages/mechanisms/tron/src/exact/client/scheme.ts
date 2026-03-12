import {
  PaymentRequirements,
  SchemeNetworkClient,
  PaymentPayloadResult,
  PaymentPayloadContext,
} from "@bankofai/x402-core/types";
import { ClientTronSigner } from "../../signer";
import { AssetTransferMethod } from "../../types";
import { createEIP3009Payload } from "./eip3009";
import { createPermit2Payload } from "./permit2";

/**
 * TRON client implementation for the Exact payment scheme.
 * Supports both EIP-3009-style TransferWithAuthorization and Permit2 flows.
 *
 * Routes to the appropriate authorization method based on
 * `requirements.extra.assetTransferMethod`. Defaults to `eip3009`.
 */
export class ExactTronScheme implements SchemeNetworkClient {
  readonly scheme = "exact";

  constructor(private readonly signer: ClientTronSigner) {}

  async createPaymentPayload(
    x402Version: number,
    paymentRequirements: PaymentRequirements,
    _context?: PaymentPayloadContext,
  ): Promise<PaymentPayloadResult> {
    const assetTransferMethod =
      (paymentRequirements.extra?.assetTransferMethod as AssetTransferMethod) ?? "eip3009";

    if (assetTransferMethod === "permit2") {
      return createPermit2Payload(this.signer, x402Version, paymentRequirements);
    }

    return createEIP3009Payload(this.signer, x402Version, paymentRequirements);
  }
}

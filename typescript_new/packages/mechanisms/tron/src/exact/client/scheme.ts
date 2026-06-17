import {
  PaymentRequirements,
  SchemeNetworkClient,
  PaymentPayloadResult,
  PaymentPayloadContext,
} from "@x402/core/types";
import { ClientTronSigner } from "../../signer";
import { AssetTransferMethod } from "../../types";
import { transferWithAuthorizationABI } from "../../constants";
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
      (paymentRequirements.extra?.assetTransferMethod as AssetTransferMethod) ?? "eip3009";

    if (assetTransferMethod === "permit2") {
      return createPermit2Payload(this.signer, x402Version, paymentRequirements);
    }

    return createEIP3009Payload(this.signer, x402Version, paymentRequirements);
  }

  /**
   * Return the payer's TRC-20 balance for an asset.
   * Used by balance-aware selection helpers (see shared/balance).
   *
   * @param asset - The TRC-20 contract address.
   * @param network - The network identifier (unused; signer is network-bound).
   * @returns The payer's balance in smallest units.
   */
  async checkBalance(asset: string, network: string): Promise<bigint> {
    void network;
    const balance = (await this.signer.readContract({
      address: asset,
      abi: transferWithAuthorizationABI as unknown as readonly Record<string, unknown>[],
      functionName: "balanceOf",
      args: [this.signer.address],
    })) as bigint;
    return BigInt(balance);
  }
}

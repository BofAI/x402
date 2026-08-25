import {
  PaymentRequirements,
  SchemeNetworkClient,
  PaymentPayloadResult,
  PaymentPayloadContext,
} from "@bankofai/x402-core/types";
import { ClientTronSigner } from "../../signer";
import { transferWithAuthorizationABI } from "../../constants";
import { createUptoPermit2Payload } from "./permit2";
import { findDefaultAsset } from "../../shared/defaultAssets";

/**
 * TRON client implementation for the Upto payment scheme.
 *
 * The upto scheme authorizes a maximum amount via Permit2 + x402UptoPermit2Proxy.
 * The facilitator settles for an actual amount up to that maximum. The witness
 * binds the settling facilitator's address, so the server must advertise it
 * (via `requirements.extra.permit2FacilitatorAddress`).
 */
export class UptoTronScheme implements SchemeNetworkClient {
  readonly scheme = "upto";
  readonly findDefaultAsset = findDefaultAsset;

  /**
   * Creates a new UptoTronScheme instance.
   *
   * @param signer - The TRON signer for client operations.
   */
  constructor(private readonly signer: ClientTronSigner) {}

  /**
   * Creates a payment payload for the Upto scheme using Permit2.
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

    return createUptoPermit2Payload(this.signer, x402Version, paymentRequirements);
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

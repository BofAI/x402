import {
  PaymentPayloadResult,
  PaymentRequirements,
  SchemeNetworkClient,
} from "@bankofai/x402-core/types";
import { isNanoAddress } from "../../address";
import { parseRaw } from "../../amount";
import { NANO_MAINNET, XNO_ASSET } from "../../network";
import { ClientNanoWallet, ExactNanoPayload, isNanoBlockHash } from "../../types";

/**
 * Nano client implementation for the Exact payment scheme.
 *
 * The payer publishes its own send block to `payTo` through the wallet and
 * returns `{ blockHash }` as the payload. Nothing is signed for a third party.
 */
export class ExactNanoScheme implements SchemeNetworkClient {
  readonly scheme = "exact";

  /**
   * Creates a new ExactNanoScheme client instance.
   *
   * @param wallet - Wallet that publishes send blocks from the payer's account.
   */
  constructor(private readonly wallet: ClientNanoWallet) {}

  /**
   * Pays the requirements with a send block and returns its hash.
   *
   * @param x402Version - The x402 protocol version
   * @param paymentRequirements - The payment requirements
   * @returns Promise resolving to a payment payload result
   */
  async createPaymentPayload(
    x402Version: number,
    paymentRequirements: PaymentRequirements,
  ): Promise<PaymentPayloadResult> {
    if (paymentRequirements.scheme !== "exact") {
      throw new Error(`Unsupported scheme for Nano: ${paymentRequirements.scheme}`);
    }
    if (paymentRequirements.network !== NANO_MAINNET) {
      throw new Error(`Unsupported Nano network: ${paymentRequirements.network}`);
    }
    if (paymentRequirements.asset !== XNO_ASSET) {
      throw new Error(`Unsupported Nano asset: ${paymentRequirements.asset}`);
    }
    if (!isNanoAddress(paymentRequirements.payTo)) {
      throw new Error(`Invalid Nano payTo address: ${paymentRequirements.payTo}`);
    }
    const amountRaw = parseRaw(paymentRequirements.amount);
    if (amountRaw === 0n) {
      throw new Error("Nano payment amount must be greater than zero");
    }

    const blockHash = await this.wallet.send({
      to: paymentRequirements.payTo,
      amountRaw,
      network: paymentRequirements.network,
    });
    if (!isNanoBlockHash(blockHash)) {
      throw new Error("Nano wallet did not return a valid block hash");
    }

    const payload: ExactNanoPayload = { blockHash: blockHash.toUpperCase() };
    return { x402Version, payload: { ...payload } };
  }
}

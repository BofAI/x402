import {
  PaymentPayloadResult,
  PaymentRequirements,
  SchemeNetworkClient,
} from "@bankofai/x402-core/types";
import { isNanoAddress } from "../../address";
import { nanoOrderCommitment } from "../../binding";
import { parseRaw } from "../../amount";
import { NANO_MAINNET, XNO_ASSET } from "../../network";
import { ClientNanoWallet, ExactNanoPayload, isNanoBlockHash } from "../../types";

/** Options for the Nano client scheme. */
export interface ExactNanoClientOptions {
  /** Source of random bytes for the payment secret; defaults to `crypto.getRandomValues`. */
  randomBytes?: (length: number) => Uint8Array;
}

/**
 * Nano client implementation for the Exact payment scheme.
 *
 * The payer picks a random secret, asks the wallet to publish a send block to
 * `payTo` whose `representative` is the commitment to that secret (so the block
 * is bound to this payment and to this payer), and returns
 * `{ blockHash, secret }` as the payload. Nothing is signed for a third party.
 */
export class ExactNanoScheme implements SchemeNetworkClient {
  readonly scheme = "exact";
  private readonly randomBytes: (length: number) => Uint8Array;

  /**
   * Creates a new ExactNanoScheme client instance.
   *
   * @param wallet - Wallet that publishes send blocks from the payer's account.
   * @param options - Optional random source, for tests.
   */
  constructor(
    private readonly wallet: ClientNanoWallet,
    options: ExactNanoClientOptions = {},
  ) {
    this.randomBytes = options.randomBytes ?? (n => crypto.getRandomValues(new Uint8Array(n)));
  }

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

    const secret = Array.from(this.randomBytes(32), b => b.toString(16).padStart(2, "0")).join("");
    const blockHash = await this.wallet.send({
      to: paymentRequirements.payTo,
      amountRaw,
      network: paymentRequirements.network,
      representative: nanoOrderCommitment(
        secret,
        paymentRequirements.payTo,
        paymentRequirements.amount,
      ),
    });
    if (!isNanoBlockHash(blockHash)) {
      throw new Error("Nano wallet did not return a valid block hash");
    }

    const payload: ExactNanoPayload = { blockHash: blockHash.toUpperCase(), secret };
    return { x402Version, payload: { ...payload } };
  }
}

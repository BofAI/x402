import type {
  PaymentPayloadResult,
  PaymentRequirements,
  SchemeNetworkClient,
} from "@x402/core/types";
import { DEFAULT_MAX_FEE_LIMIT_SUN } from "../../constants";
import type { ClientTronSigner } from "../../signer";
import { assertSupportedTronNetwork, isValidTronAddress } from "../../utils";

/**
 * Client options for exact TRON payments.
 */
export type TronClientConfig = {
  feeLimit?: number;
};

/**
 * TRON client implementation for the Exact payment scheme.
 */
export class ExactTronScheme implements SchemeNetworkClient {
  readonly scheme = "exact";
  private readonly feeLimit: number;

  /**
   * Creates an exact TRON client scheme.
   *
   * @param signer - Client TRON signer
   * @param config - Client options
   */
  constructor(
    private readonly signer: ClientTronSigner,
    config: TronClientConfig = {},
  ) {
    this.feeLimit = config.feeLimit ?? DEFAULT_MAX_FEE_LIMIT_SUN;
  }

  /**
   * Creates a signed TRC-20 transfer payload.
   *
   * @param x402Version - x402 protocol version
   * @param paymentRequirements - Selected payment requirements
   * @returns Payment payload result
   */
  async createPaymentPayload(
    x402Version: number,
    paymentRequirements: PaymentRequirements,
  ): Promise<PaymentPayloadResult> {
    if (x402Version !== 2) {
      throw new Error("TRON exact currently supports x402 version 2 only");
    }
    if (paymentRequirements.scheme !== "exact") {
      throw new Error("Unsupported scheme for TRON exact client");
    }
    assertSupportedTronNetwork(paymentRequirements.network);
    if (!isValidTronAddress(paymentRequirements.asset)) {
      throw new Error("Invalid TRC-20 contract address");
    }
    if (!isValidTronAddress(paymentRequirements.payTo)) {
      throw new Error("Invalid TRON payTo address");
    }
    if (!/^[1-9][0-9]*$/.test(paymentRequirements.amount)) {
      throw new Error("Amount must be a positive integer");
    }
    if (
      !Number.isSafeInteger(paymentRequirements.maxTimeoutSeconds) ||
      paymentRequirements.maxTimeoutSeconds <= 5
    ) {
      throw new Error("maxTimeoutSeconds must be a safe integer greater than 5");
    }
    if (!Number.isSafeInteger(this.feeLimit) || this.feeLimit <= 0) {
      throw new Error("feeLimit must be a positive safe integer");
    }

    const transaction = await this.signer.buildTransferTransaction(
      paymentRequirements,
      this.feeLimit,
    );
    const signedTransaction = await this.signer.signTransaction(transaction);
    return {
      x402Version,
      payload: { transaction: signedTransaction },
    };
  }
}

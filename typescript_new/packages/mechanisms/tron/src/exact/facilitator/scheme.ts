import type {
  PaymentPayload,
  PaymentRequirements,
  SchemeNetworkFacilitator,
  SettleResponse,
  VerifyResponse,
} from "@x402/core/types";
import { deepEqual } from "@x402/core/utils";
import { DEFAULT_MAX_FEE_LIMIT_SUN, EXPIRATION_BUFFER_MS } from "../../constants";
import type { FacilitatorTronClient } from "../../signer";
import type { ExactTronPayloadV2, InspectedTronTransaction } from "../../types";
import {
  extractTransactionFromPayload,
  inspectTronTransaction,
  isSupportedTronNetwork,
  normalizeTronAddress,
} from "../../utils";

/**
 * Facilitator options for exact TRON payments.
 */
export type TronFacilitatorConfig = {
  maxFeeLimit?: number;
  now?: () => number;
};

/**
 * TRON facilitator implementation for the Exact payment scheme.
 */
export class ExactTronScheme implements SchemeNetworkFacilitator {
  readonly scheme = "exact";
  readonly caipFamily = "tron:*";
  private readonly maxFeeLimit: number;
  private readonly now: () => number;

  /**
   * Creates an exact TRON facilitator scheme.
   *
   * @param client - Facilitator network client
   * @param config - Facilitator options
   */
  constructor(
    private readonly client: FacilitatorTronClient,
    config: TronFacilitatorConfig = {},
  ) {
    this.maxFeeLimit = config.maxFeeLimit ?? DEFAULT_MAX_FEE_LIMIT_SUN;
    this.now = config.now ?? Date.now;
  }

  /**
   * Returns no extra metadata because the payer pays TRON fees.
   *
   * @param _ - Network identifier
   * @returns Undefined
   */
  getExtra(_: string): undefined {
    return undefined;
  }

  /**
   * Returns no facilitator signer addresses because the facilitator only broadcasts.
   *
   * @param _ - Network identifier
   * @returns Empty signer list
   */
  getSigners(_: string): string[] {
    return [];
  }

  /**
   * Verifies a signed TRC-20 payment.
   *
   * @param payload - Payment payload
   * @param requirements - Matched requirements
   * @returns Verification response
   */
  async verify(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<VerifyResponse> {
    const baseValidation = this.validateRequirements(payload, requirements);
    if (baseValidation) {
      return baseValidation;
    }

    let inspected: InspectedTronTransaction;
    try {
      const exactPayload = payload.payload as ExactTronPayloadV2;
      inspected = inspectTronTransaction(extractTransactionFromPayload(exactPayload));
    } catch (error) {
      return this.invalid(
        `invalid_exact_tron_payload_transaction: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    try {
      if (normalizeTronAddress(inspected.asset) !== normalizeTronAddress(requirements.asset)) {
        return this.invalid("invalid_exact_tron_payload_asset_mismatch", inspected.payer);
      }
      if (normalizeTronAddress(inspected.payTo) !== normalizeTronAddress(requirements.payTo)) {
        return this.invalid("invalid_exact_tron_payload_recipient_mismatch", inspected.payer);
      }
    } catch {
      return this.invalid("invalid_address", inspected.payer);
    }
    if (inspected.amount !== requirements.amount) {
      return this.invalid("invalid_exact_tron_payload_amount_mismatch", inspected.payer);
    }

    const now = this.now();
    if (inspected.timestamp > now + EXPIRATION_BUFFER_MS) {
      return this.invalid("invalid_exact_tron_payload_timestamp_in_future", inspected.payer);
    }
    if (inspected.expiration <= now + EXPIRATION_BUFFER_MS) {
      return this.invalid("invalid_exact_tron_payload_transaction_expired", inspected.payer);
    }
    const latestAllowedExpiration = now + requirements.maxTimeoutSeconds * 1_000;
    if (inspected.expiration > latestAllowedExpiration) {
      return this.invalid("invalid_exact_tron_payload_expiration_too_far", inspected.payer);
    }
    if (inspected.feeLimit <= 0 || inspected.feeLimit > this.maxFeeLimit) {
      return this.invalid("invalid_exact_tron_payload_fee_limit", inspected.payer);
    }

    if (this.client.preflightTransfer) {
      try {
        await this.client.preflightTransfer(inspected, requirements.network);
      } catch (error) {
        return {
          isValid: false,
          invalidReason: "invalid_exact_tron_payload_preflight_failed",
          invalidMessage: error instanceof Error ? error.message : String(error),
          payer: inspected.payer,
        };
      }
    }

    return { isValid: true, payer: inspected.payer };
  }

  /**
   * Broadcasts and confirms a verified TRC-20 payment.
   *
   * @param payload - Payment payload
   * @param requirements - Matched requirements
   * @returns Settlement response
   */
  async settle(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<SettleResponse> {
    const verification = await this.verify(payload, requirements);
    if (!verification.isValid) {
      return {
        success: false,
        network: requirements.network,
        transaction: "",
        errorReason: verification.invalidReason ?? "verification_failed",
        errorMessage: verification.invalidMessage,
        payer: verification.payer || "",
      };
    }

    try {
      const exactPayload = payload.payload as ExactTronPayloadV2;
      const transaction = extractTransactionFromPayload(exactPayload);
      const transactionId = await this.client.broadcastTransaction(
        transaction,
        requirements.network,
      );
      await this.client.waitForTransaction(transactionId, requirements.network);
      return {
        success: true,
        network: requirements.network,
        transaction: transactionId,
        payer: verification.payer,
      };
    } catch (error) {
      return {
        success: false,
        network: requirements.network,
        transaction: "",
        errorReason: "transaction_failed",
        errorMessage: error instanceof Error ? error.message : String(error),
        payer: verification.payer || "",
      };
    }
  }

  /**
   * Validates protocol and requirement parity.
   *
   * @param payload - Payment payload
   * @param requirements - Matched requirements
   * @returns Invalid response or null
   */
  private validateRequirements(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): VerifyResponse | null {
    if (payload.x402Version !== 2) {
      return this.invalid("invalid_x402_version");
    }
    if (payload.accepted.scheme !== "exact" || requirements.scheme !== "exact") {
      return this.invalid("unsupported_scheme");
    }
    if (payload.accepted.network !== requirements.network) {
      return this.invalid("network_mismatch");
    }
    if (!isSupportedTronNetwork(requirements.network)) {
      return this.invalid("invalid_network");
    }
    if (!deepEqual(payload.accepted, requirements)) {
      return this.invalid("accepted_payment_requirements_mismatch");
    }
    if (!/^[1-9][0-9]*$/.test(requirements.amount)) {
      return this.invalid("invalid_amount");
    }
    if (!Number.isFinite(requirements.maxTimeoutSeconds) || requirements.maxTimeoutSeconds <= 0) {
      return this.invalid("invalid_timeout");
    }
    return null;
  }

  /**
   * Creates an invalid verification response.
   *
   * @param reason - Invalid reason
   * @param payer - Optional payer address
   * @returns Invalid verification response
   */
  private invalid(reason: string, payer = ""): VerifyResponse {
    return { isValid: false, invalidReason: reason, payer };
  }
}

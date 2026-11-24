import {
  TronSettlementTracker,
  type TronSettlementOptions,
  type TronPendingSettlementContext,
} from "../../shared/pendingSettlement";
import {
  PaymentPayload,
  PaymentRequirements,
  SchemeNetworkFacilitator,
  FacilitatorContext,
  SettleResponse,
  VerifyResponse,
} from "@x402/core/types";
import { FacilitatorTronSigner } from "../../signer";
import type { ExactGasFreePayload } from "../../types";
import { isRecord, isTronPaymentAddress, isUint256 } from "../../shared/validation";
import { isValidTronTxHash, normalizeAddressForSigning } from "../../utils";
import { GasFreeAPIClient, GasFreeTransactionStatusError } from "../../shared/gasfree/api";
import { getTronNetworkValue, tronNetworksEqual } from "../../network";
import { assembleGasFreeTransaction } from "../../shared/gasfree/assemble";
import { SETTLEMENT_PENDING, waitAndReturnSettleResponse } from "../../shared/settleReceipt";
import * as errors from "./errors";

/**
 * Validate the signed permit and account address before using their fields.
 *
 * @param payload - Untrusted GasFree payload.
 * @returns The validated payload or a diagnostic naming the invalid field.
 */
function validateGasFreePayload(
  payload: unknown,
): { data: ExactGasFreePayload } | { message: string } {
  if (!isRecord(payload)) return { message: "Missing or invalid GasFree payload" };
  if (typeof payload.signature !== "string" || !payload.signature) {
    return { message: "Missing or invalid GasFree field signature" };
  }
  if (!isTronPaymentAddress(payload.gasfreeAddress)) {
    return { message: "Missing or invalid GasFree field gasfreeAddress" };
  }
  const permit = payload.gasfree;
  if (!isRecord(permit)) return { message: "Missing or invalid GasFree field gasfree" };

  const invalidAddress = ["token", "serviceProvider", "user", "receiver"].find(
    field => !isTronPaymentAddress(permit[field]),
  );
  const invalidField =
    invalidAddress ??
    ["value", "maxFee", "deadline", "version", "nonce"].find(field => !isUint256(permit[field]));
  if (invalidField) return { message: `Missing or invalid GasFree field gasfree.${invalidField}` };

  return { data: payload as ExactGasFreePayload };
}

/**
 * Build the terminal response for a malformed relayer transaction hash.
 *
 * @param network - Network where settlement was attempted.
 * @param payer - Payer associated with the GasFree request.
 * @returns A terminal settlement response without the malformed hash.
 */
function invalidTransactionHashResponse(
  network: PaymentRequirements["network"],
  payer: string,
): SettleResponse {
  return {
    success: false,
    errorReason: errors.INVALID_TRANSACTION_HASH,
    errorMessage: "GasFree relayer returned an invalid transaction hash",
    transaction: "",
    network,
    payer,
  };
}

/**
 * TRON facilitator for the `exact_gasfree` scheme.
 *
 * Verifies the GasFree permit (terms + TIP-712 signature) and settles it by
 * submitting through the GasFree relayer API, which pays energy on-chain.
 */
export class ExactGasFreeTronScheme implements SchemeNetworkFacilitator {
  readonly scheme = "exact_gasfree";
  readonly caipFamily = "tron:*";
  private readonly settlement: TronSettlementTracker;

  /**
   * Create the GasFree facilitator scheme.
   *
   * @param signer - The TRON facilitator signer (verify + balance reads).
   * @param apiClients - GasFree relayer clients keyed by CAIP-2 network.
   * @param options - Pending settlement storage configuration.
   */
  constructor(
    private readonly signer: FacilitatorTronSigner,
    private readonly apiClients: Record<string, GasFreeAPIClient>,
    options: TronSettlementOptions = {},
  ) {
    this.settlement = new TronSettlementTracker(options.pendingSettlementStore);
  }

  /**
   * Returns undefined — the GasFree facilitator advertises no extra config.
   *
   * @param _network - The network identifier (unused).
   * @returns undefined.
   */
  getExtra(_network: string): Record<string, unknown> | undefined {
    void _network;
    return undefined;
  }

  /**
   * Return facilitator signer addresses for the supported response.
   *
   * @param _network - The network identifier (unused).
   * @returns Facilitator signer addresses.
   */
  getSigners(_network: string): string[] {
    void _network;
    return [...this.signer.getAddresses()];
  }

  /**
   * Verify a GasFree payload against the requirements.
   *
   * @param payload - The payment payload.
   * @param requirements - The payment requirements.
   * @param context - Optional facilitator context (unused).
   * @returns The verification response.
   */
  async verify(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
    context?: FacilitatorContext,
  ): Promise<VerifyResponse> {
    void context;
    const validated = validateGasFreePayload(payload.payload);
    if ("message" in validated) {
      return {
        isValid: false,
        invalidReason: errors.MISSING_PAYLOAD,
        invalidMessage: validated.message,
      };
    }
    const gf = validated.data;
    const payer = gf.gasfree.user;

    if (payload.accepted.scheme !== "exact_gasfree" || requirements.scheme !== "exact_gasfree") {
      return { isValid: false, invalidReason: errors.INVALID_SCHEME, payer };
    }
    if (!tronNetworksEqual(payload.accepted.network, requirements.network)) {
      return { isValid: false, invalidReason: errors.NETWORK_MISMATCH, payer };
    }

    const termsError = await this.validateTerms(gf, requirements);
    if (termsError) {
      return { isValid: false, invalidReason: termsError, payer };
    }

    const validSig = await this.verifySignature(gf, requirements.network);
    if (!validSig) {
      return { isValid: false, invalidReason: errors.INVALID_SIGNATURE, payer };
    }

    return { isValid: true, payer };
  }

  /**
   * Settle a GasFree payload by submitting it to the relayer.
   *
   * @param payload - The payment payload.
   * @param requirements - The payment requirements.
   * @param context - Optional facilitator context (unused).
   * @returns The settlement response.
   */
  async settle(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
    context?: FacilitatorContext,
  ): Promise<SettleResponse> {
    const validated = validateGasFreePayload(payload.payload);
    if ("message" in validated) {
      return {
        success: false,
        errorReason: errors.MISSING_PAYLOAD,
        errorMessage: validated.message,
        transaction: "",
        network: requirements.network,
      };
    }
    return this.settlement.run(payload, requirements, pending =>
      this.settleOnce(payload, requirements, validated.data, context, pending),
    );
  }

  /**
   * Dispatch a settlement using the original transaction when one exists.
   *
   * @param payload - Payment payload for this settlement.
   * @param requirements - Effective payment requirements, including the actual settlement amount.
   * @param gf - Validated GasFree payload.
   * @param context - Registered facilitator extension capabilities.
   * @param pending - Original-transaction tracking for this attempt.
   * @returns Settlement result preserving the original transaction identity.
   */
  private async settleOnce(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
    gf: ExactGasFreePayload,
    context: FacilitatorContext | undefined,
    pending: TronPendingSettlementContext,
  ): Promise<SettleResponse> {
    if (pending.record?.transaction) {
      return waitAndReturnSettleResponse(
        this.signer,
        pending.record.transaction,
        requirements.network,
        gf.gasfree.user,
        {
          failedStatusReason: errors.TRANSACTION_FAILED,
          pending,
        },
      );
    }

    if (!pending.record) {
      const verifyResult = await this.verify(payload, requirements, context);
      if (!verifyResult.isValid) {
        return {
          success: false,
          errorReason: verifyResult.invalidReason ?? errors.INVALID_SCHEME,
          transaction: "",
          network: requirements.network,
          payer: gf.gasfree.user,
        };
      }
    }

    const payer = gf.gasfree.user;

    // Resolve the relayer client — may throw if the network is not configured.
    // verify() normally catches this earlier, but guard defensively.
    let api: GasFreeAPIClient;
    try {
      api = this.getApiClient(requirements.network);
    } catch (err) {
      return {
        success: false,
        errorReason: err instanceof Error ? err.message : String(err),
        transaction: "",
        network: requirements.network,
        payer,
      };
    }

    if (!pending.record) {
      // Best-effort balance preflight against the GasFree wallet.
      try {
        const balance = await this.readBalance(requirements.asset, gf.gasfreeAddress);
        const required = BigInt(requirements.amount) + BigInt(gf.gasfree.maxFee);
        if (balance < required) {
          return {
            success: false,
            errorReason: errors.INSUFFICIENT_FUNDS,
            transaction: "",
            network: requirements.network,
            payer,
          };
        }
      } catch {
        // Balance read failed — continue; the relayer will return the exact reason.
      }
    }

    let activeTraceId = pending.record?.data?.gasfreeTraceId;
    let tracked = false;
    try {
      const traceId =
        pending.record?.data?.gasfreeTraceId ?? (await api.submit(gf.gasfree, gf.signature));
      if (!traceId) {
        return {
          success: false,
          errorReason: errors.API_NO_RESPONSE,
          transaction: "",
          network: requirements.network,
          payer,
        };
      }

      activeTraceId = traceId;
      await pending.save("", { gasfreeTraceId: traceId });
      tracked = true;
      const result = await api.waitForSuccess(traceId);
      if (!result.txnHash) {
        return {
          success: false,
          errorReason: errors.MISSING_TRANSACTION_HASH,
          transaction: "",
          network: requirements.network,
          payer,
        };
      }
      if (!isValidTronTxHash(result.txnHash)) {
        return invalidTransactionHashResponse(requirements.network, payer);
      }

      return { success: true, transaction: result.txnHash, network: requirements.network, payer };
    } catch (err) {
      if (activeTraceId && !tracked) throw err;
      if (!activeTraceId) {
        return {
          success: false,
          errorReason: err instanceof Error ? err.message : String(err),
          transaction: "",
          network: requirements.network,
          payer,
        };
      }
      if (err instanceof GasFreeTransactionStatusError) {
        if (err.terminal) pending.markTerminal();
        if (err.transaction !== undefined && !isValidTronTxHash(err.transaction)) {
          return invalidTransactionHashResponse(requirements.network, payer);
        }
        if (err.transaction && !err.terminal) await pending.save(err.transaction);
        if (err.terminal || err.transaction) {
          return {
            success: false,
            errorReason: err.terminal ? errors.TRANSACTION_FAILED : SETTLEMENT_PENDING,
            errorMessage: err.message,
            transaction: err.transaction ?? "",
            network: requirements.network,
            payer,
          };
        }
      }
      return {
        success: false,
        errorReason: SETTLEMENT_PENDING,
        errorMessage: err instanceof Error ? err.message : String(err),
        transaction: "",
        network: requirements.network,
        payer,
        extra: { gasfreeTraceId: activeTraceId ?? "" },
      };
    }
  }

  /**
   * Resolve the GasFree relayer client for a network.
   *
   * @param network - CAIP-2 network identifier.
   * @returns The relayer API client.
   */
  private getApiClient(network: string): GasFreeAPIClient {
    const client = getTronNetworkValue(this.apiClients, network);
    if (!client) {
      throw new Error(`GasFree is not configured for network: ${network}`);
    }
    return client;
  }

  /**
   * Validate the GasFree permit terms against the requirements.
   *
   * @param gf - The GasFree payload.
   * @param requirements - The payment requirements.
   * @returns An error reason string, or null when terms are valid.
   */
  private async validateTerms(
    gf: ExactGasFreePayload,
    requirements: PaymentRequirements,
  ): Promise<string | null> {
    const norm = (a: string) => normalizeAddressForSigning(a);
    const m = gf.gasfree;

    if (!isTronPaymentAddress(requirements.asset) || norm(m.token) !== norm(requirements.asset)) {
      return errors.TOKEN_MISMATCH;
    }
    // Reject short payments only (value >= amount). GasFree's maxFee is a separate
    // signed field, so the fee does not factor into the amount check. Allowing
    // value > amount lets the client cover a fee_quote that slightly exceeds the
    // listed price; the payer cannot be charged more than they signed. Mirrors the
    // Python facilitator's `value >= required amount` semantics.
    if (!isUint256(requirements.amount) || BigInt(m.value) < BigInt(requirements.amount)) {
      return errors.AMOUNT_MISMATCH;
    }
    if (
      !isTronPaymentAddress(requirements.payTo) ||
      norm(m.receiver) !== norm(requirements.payTo)
    ) {
      return errors.PAYTO_MISMATCH;
    }

    // The serviceProvider must be an active relayer provider.
    const providerError = await this.validateServiceProvider(
      m.serviceProvider,
      requirements.network,
    );
    if (providerError) return providerError;

    const now = Math.floor(Date.now() / 1000);
    if (BigInt(m.deadline) < BigInt(now)) {
      return errors.EXPIRED;
    }
    return null;
  }

  /**
   * Validate the serviceProvider: must be an active relayer provider.
   *
   * Fail-closed: when the relayer API is unreachable or returns an empty provider
   * list, the serviceProvider cannot be verified and the payment is rejected with
   * `PROVIDER_LIST_UNAVAILABLE`. This preserves verify/settle consistency — verify
   * must predict settle, and an unverified provider may be rejected by the relayer
   * at settlement time.
   *
   * @param serviceProvider - The relayer provider address.
   * @param network - CAIP-2 network identifier.
   * @returns An error reason string, or null when valid.
   */
  private async validateServiceProvider(
    serviceProvider: string,
    network: string,
  ): Promise<string | null> {
    const norm = (a: string) => normalizeAddressForSigning(a);
    try {
      const providers = await this.getApiClient(network).getProviders();
      if (providers.length === 0) {
        return errors.PROVIDER_LIST_UNAVAILABLE;
      }
      const allowed = new Set(providers.map(p => norm(p.address)));
      return allowed.has(norm(serviceProvider)) ? null : errors.FEE_TO_MISMATCH;
    } catch {
      // Relayer API unreachable — cannot validate, fail-closed.
      return errors.PROVIDER_LIST_UNAVAILABLE;
    }
  }

  /**
   * Verify the GasFree TIP-712 signature against the assembled permit.
   *
   * @param gf - The GasFree payload.
   * @param network - CAIP-2 network identifier.
   * @returns True when the signature is valid.
   */
  private async verifySignature(gf: ExactGasFreePayload, network: string): Promise<boolean> {
    const assembled = assembleGasFreeTransaction(gf.gasfree, network);
    try {
      return await this.signer.verifyTypedData({
        address: gf.gasfree.user,
        domain: assembled.domain,
        types: assembled.types as unknown as Record<string, Array<{ name: string; type: string }>>,
        primaryType: assembled.primaryType,
        message: assembled.message,
        signature: gf.signature,
      });
    } catch {
      return false;
    }
  }

  /**
   * Read a TRC-20 balance for the GasFree wallet address.
   *
   * @param asset - The TRC-20 contract address.
   * @param gasfreeAddress - The GasFree wallet address to read.
   * @returns The balance in smallest units.
   */
  private async readBalance(asset: string, gasfreeAddress: string): Promise<bigint> {
    const balance = (await this.signer.readContract({
      address: asset,
      abi: [
        {
          type: "function",
          name: "balanceOf",
          inputs: [{ name: "account", type: "address" }],
          outputs: [{ name: "", type: "uint256" }],
          stateMutability: "view",
        },
      ] as unknown as readonly Record<string, unknown>[],
      functionName: "balanceOf",
      args: [gasfreeAddress],
    })) as bigint;
    return BigInt(balance);
  }
}

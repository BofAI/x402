import {
  PaymentRequirements,
  SchemeNetworkClient,
  PaymentPayloadResult,
  PaymentPayloadContext,
} from "@bankofai/x402-core/types";
import { TRC20_APPROVAL_GAS_SPONSORING } from "@bankofai/x402-extensions";
import { ClientTronSigner } from "../../signer";
import { AssetTransferMethod } from "../../types";
import { trc20BalanceOfAbi } from "../../constants";
import { createEIP3009Payload } from "./eip3009";
import { createPermit2Payload } from "./permit2";
import { getPermit2AllowanceReadParams } from "./permit2Helpers";
import { signTrc20ApprovalTransaction } from "./trc20approval";

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
    await this.ensureSufficientTokenBalance(paymentRequirements);

    // Mark unused parameters to satisfy linter
    void context;

    const assetTransferMethod =
      (paymentRequirements.extra?.assetTransferMethod as AssetTransferMethod) ?? "eip3009";

    if (assetTransferMethod === "permit2") {
      const result = await createPermit2Payload(this.signer, x402Version, paymentRequirements);
      const trc20Extensions = await this.trySignTrc20Approval(paymentRequirements, context);

      if (trc20Extensions) {
        return {
          ...result,
          extensions: trc20Extensions,
        };
      }

      return result;
    }

    return createEIP3009Payload(this.signer, x402Version, paymentRequirements);
  }

  /**
   * Signs a sponsored TRC-20 approval transaction when Permit2 allowance is insufficient.
   *
   * @param requirements - Payment requirements for the pending payment.
   * @param context - Optional server-declared extensions for the payment flow.
   * @returns Sponsored approval extensions when approval is needed, otherwise undefined.
   */
  private async trySignTrc20Approval(
    requirements: PaymentRequirements,
    context?: PaymentPayloadContext,
  ): Promise<Record<string, unknown> | undefined> {
    if (!context?.extensions?.[TRC20_APPROVAL_GAS_SPONSORING.key]) {
      return undefined;
    }

    if (!this.signer.buildTriggerSmartContractTransaction || !this.signer.signTransaction) {
      return undefined;
    }

    try {
      const allowance = (await this.signer.readContract(
        getPermit2AllowanceReadParams({
          tokenAddress: requirements.asset,
          ownerAddress: this.signer.address,
          network: requirements.network,
        }),
      )) as bigint;

      if (allowance >= BigInt(requirements.amount)) {
        return undefined;
      }
    } catch {
      // If allowance cannot be read, still try to provide the approval transaction.
    }

    const info = await signTrc20ApprovalTransaction(
      this.signer,
      requirements.asset,
      requirements.network,
    );

    return {
      [TRC20_APPROVAL_GAS_SPONSORING.key]: { info },
    };
  }

  /**
   * Performs a best-effort TRC-20 balance check before signing.
   */
  private async ensureSufficientTokenBalance(requirements: PaymentRequirements): Promise<void> {
    const balance = (await this.signer.readContract({
      address: requirements.asset,
      abi: trc20BalanceOfAbi,
      functionName: "balanceOf",
      args: [this.signer.address],
    })) as bigint;

    if (balance < BigInt(requirements.amount)) {
      throw new Error(
        `insufficient_funds: Insufficient token balance. Required: ${requirements.amount}, Available: ${balance.toString()}`,
      );
    }
  }
}

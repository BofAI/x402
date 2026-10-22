import type { ClientExtension } from "@x402/core/client";
import type { PaymentPayload } from "@x402/core/types";
import {
  normalizeAddressForSigning,
  tronNetworksEqual,
  type ClientTronSigner,
} from "@bankofai/x402-tron";
import {
  markTrc20ApprovalClientPrepared,
  TRC20_APPROVAL_RESOURCE_SPONSORING_KEY as KEY,
} from "@bankofai/x402-tron/exact/extensions";
import { trySignTrc20ApprovalExtension } from "./preSign.js";

/**
 * Read the actual allowance amount from the final payment authorization, including batch deposits.
 *
 * @param payload - Created payment envelope.
 * @returns Authorization amount and payer, or nothing for unsupported paths.
 */
function allowanceFor(payload: PaymentPayload): { amount: string; payer: string } | undefined {
  const body = payload.payload as {
    type?: string;
    permit2Authorization?: { from: string; permitted: { amount: string } };
    deposit?: {
      amount: string;
      authorization: { permit2Authorization?: { from: string; permitted: { amount: string } } };
    };
  };
  const auth = body.permit2Authorization ?? body.deposit?.authorization.permit2Authorization;
  if (!auth) return undefined;
  return { amount: body.deposit?.amount ?? auth.permitted.amount, payer: auth.from };
}

/**
 * Prepare Approval after scheme authorization and clean unused declarations last.
 *
 * @param signer - Network-bound payer signer and Approval capabilities.
 * @returns Official Core client extension.
 */
export function createTrc20ApprovalResourceSponsoringClientExtension(
  signer: ClientTronSigner,
): ClientExtension {
  return {
    key: KEY,
    hooks: {
      onBeforePaymentCreation: async (declaration, ctx) => {
        const info = (declaration as { info?: { version?: unknown } } | null)?.info;
        if (info?.version !== "1")
          throw new Error("trc20ApprovalResourceSponsoring: unsupported extension version");
        if (!signer.network || !tronNetworksEqual(signer.network, ctx.selectedRequirements.network))
          throw new Error("approval_signer_network_mismatch");
      },
      onAfterPaymentCreation: async (_declaration, ctx) => {
        const extension = ctx.paymentPayload.extensions?.[KEY] as
          | { info?: { signedTransaction?: unknown } }
          | undefined;
        if (!extension?.info?.signedTransaction) {
          const extensions = { ...ctx.paymentPayload.extensions };
          delete extensions[KEY];
          ctx.paymentPayload.extensions = extensions;
        }
      },
    },
    enrichPaymentPayload: async (payload, required) => {
      if (!Object.prototype.hasOwnProperty.call(required.extensions ?? {}, KEY)) return payload;
      const authorization = allowanceFor(payload);
      if (!authorization) return markTrc20ApprovalClientPrepared(payload);
      if (
        normalizeAddressForSigning(authorization.payer) !==
        normalizeAddressForSigning(signer.address)
      )
        throw new Error("approval_signer_payer_mismatch");
      const result = await trySignTrc20ApprovalExtension(
        signer,
        payload.accepted,
        { extensions: required.extensions },
        authorization.amount,
      );
      if (!result.handled) {
        if (!signer.ensureAllowance) throw new Error("approval_signing_capability_missing");
        const ensured = await signer.ensureAllowance({
          token: payload.accepted.asset,
          network: payload.accepted.network,
          amount: BigInt(authorization.amount),
        });
        if (!ensured) throw new Error("approval_allowance_insufficient");
      }
      return markTrc20ApprovalClientPrepared({
        ...payload,
        extensions: { ...payload.extensions, ...result.extensions },
      });
    },
  };
}

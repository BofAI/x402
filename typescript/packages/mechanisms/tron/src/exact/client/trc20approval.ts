import type { PaymentPayloadContext, PaymentRequirements } from "@bankofai/x402-core/types";
import type { ClientTronSigner } from "../../signer";
import {
  trySignTrc20ApprovalResourceSponsoringExtension as trySignSharedApprovalExtension,
  type Trc20ApprovalExtensionAttempt,
} from "../../shared/extensions/resourceSponsoring";

export type { Trc20ApprovalExtensionAttempt } from "../../shared/extensions/resourceSponsoring";

/**
 * Creates a pre-signed Permit2 Approval extension when advertised and needed.
 * The transaction is signed but never broadcast by the Client.
 *
 * @param signer - Client signer used to read allowance and sign the Approval.
 * @param requirements - Selected Permit2 payment requirements.
 * @param context - Server-declared extension context.
 * @returns Whether the extension handled allowance and its optional payload fields.
 */
export async function trySignTrc20ApprovalResourceSponsoringExtension(
  signer: ClientTronSigner,
  requirements: PaymentRequirements,
  context?: PaymentPayloadContext,
): Promise<Trc20ApprovalExtensionAttempt> {
  return trySignSharedApprovalExtension(signer, requirements, BigInt(requirements.amount), context);
}

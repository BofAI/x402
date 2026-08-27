import type { PaymentPayloadContext, PaymentRequirements } from "@bankofai/x402-core/types";
import { erc20AllowanceAbi, PERMIT2_ADDRESSES } from "../../constants";
import type { ClientTronSigner } from "../../signer";
import {
  TRC20_APPROVAL_MAX_AMOUNT,
  TRC20_APPROVAL_RESOURCE_SPONSORING_KEY,
  TRC20_APPROVAL_RESOURCE_SPONSORING_VERSION,
  type Trc20ApprovalResourceSponsoringInfo,
} from "../../exact/extensions";

export interface Trc20ApprovalExtensionAttempt {
  handled: boolean;
  extensions?: Record<string, unknown>;
}

/**
 * Checks whether the Resource Server declared versioned Approval sponsorship.
 *
 * @param context - Optional Server-provided Client extension context.
 * @returns Whether the sponsorship extension key is present.
 */
export function isTrc20ApprovalResourceSponsoringDeclared(
  context?: PaymentPayloadContext,
): boolean {
  return Object.prototype.hasOwnProperty.call(
    context?.extensions ?? {},
    TRC20_APPROVAL_RESOURCE_SPONSORING_KEY,
  );
}

/**
 * Creates a pre-signed Permit2 Approval extension when advertised and needed.
 * The transaction is signed but never broadcast by the Client.
 *
 * @param signer - Client signer used to read allowance and sign the Approval.
 * @param requirements - Selected Permit2 payment or deposit requirements.
 * @param requiredAllowance - Permit2 allowance required by the selected operation.
 * @param context - Server-declared extension context.
 * @returns Whether the extension handled allowance and its optional payload fields.
 */
export async function trySignTrc20ApprovalResourceSponsoringExtension(
  signer: ClientTronSigner,
  requirements: PaymentRequirements,
  requiredAllowance: bigint,
  context?: PaymentPayloadContext,
): Promise<Trc20ApprovalExtensionAttempt> {
  const declaration = context?.extensions?.[TRC20_APPROVAL_RESOURCE_SPONSORING_KEY] as
    | { info?: Record<string, unknown> }
    | undefined;
  if (!declaration) return { handled: false };
  if (declaration.info?.version !== TRC20_APPROVAL_RESOURCE_SPONSORING_VERSION) {
    throw new Error("trc20ApprovalResourceSponsoring: unsupported extension version");
  }

  const permit2 = PERMIT2_ADDRESSES[requirements.network];
  if (!permit2) {
    throw new Error(`No Permit2 contract address configured for network ${requirements.network}`);
  }

  const allowance = BigInt(
    (await signer.readContract({
      address: requirements.asset,
      abi: erc20AllowanceAbi as unknown as readonly Record<string, unknown>[],
      functionName: "allowance",
      args: [signer.address, permit2],
    })) as bigint | string | number,
  );

  if (allowance >= requiredAllowance) return { handled: true };
  if (allowance !== 0n) {
    throw new Error("approval_reset_required");
  }
  if (!signer.signPermit2Approval) return { handled: false };

  const signedTransaction = await signer.signPermit2Approval({
    token: requirements.asset,
    network: requirements.network,
  });
  const info: Trc20ApprovalResourceSponsoringInfo = {
    from: signer.address,
    asset: requirements.asset,
    spender: permit2,
    amount: TRC20_APPROVAL_MAX_AMOUNT,
    signedTransaction,
    version: TRC20_APPROVAL_RESOURCE_SPONSORING_VERSION,
  };

  return {
    handled: true,
    extensions: {
      [TRC20_APPROVAL_RESOURCE_SPONSORING_KEY]: { info },
    },
  };
}

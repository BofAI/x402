import type { FacilitatorExtension } from "@bankofai/x402-core/types";

export interface Trc20ApprovalGasSponsoringSigner {
  getAddresses(): readonly string[];
  readContract(args: {
    address: string;
    abi: readonly unknown[];
    functionName: string;
    args?: readonly unknown[];
  }): Promise<unknown>;
  writeContract(args: {
    address: string;
    abi: readonly unknown[];
    functionName: string;
    args: readonly unknown[];
  }): Promise<string>;
  waitForTransactionReceipt(args: { hash: string }): Promise<{ status: string }>;
  sendRawTransaction(args: { signedTransaction: Record<string, unknown> }): Promise<string>;
  getSignWeight(args: { transaction: Record<string, unknown> }): Promise<unknown>;
}

export const TRC20_APPROVAL_GAS_SPONSORING = {
  key: "trc20ApprovalGasSponsoring",
} as const satisfies FacilitatorExtension;

export const TRC20_APPROVAL_GAS_SPONSORING_VERSION = "1";

export interface Trc20ApprovalGasSponsoringFacilitatorExtension extends FacilitatorExtension {
  key: "trc20ApprovalGasSponsoring";
  signer?: Trc20ApprovalGasSponsoringSigner;
}

/**
 * Creates a facilitator extension instance for sponsored TRC-20 approvals.
 *
 * @param signer - Signer used to verify and broadcast the pre-signed approval transaction.
 * @returns Facilitator extension instance for TRC-20 approval sponsoring.
 */
export function createTrc20ApprovalGasSponsoringExtension(
  signer: Trc20ApprovalGasSponsoringSigner,
): Trc20ApprovalGasSponsoringFacilitatorExtension {
  return {
    ...TRC20_APPROVAL_GAS_SPONSORING,
    signer,
  };
}

export interface Trc20ApprovalGasSponsoringInfo {
  [key: string]: unknown;
  from: string;
  asset: string;
  spender: string;
  amount: string;
  signedTransaction: Record<string, unknown>;
  version: string;
}

export interface Trc20ApprovalGasSponsoringServerInfo {
  [key: string]: unknown;
  description: string;
  version: string;
}

export interface Trc20ApprovalGasSponsoringExtension {
  info: Trc20ApprovalGasSponsoringServerInfo | Trc20ApprovalGasSponsoringInfo;
  schema: Record<string, unknown>;
}

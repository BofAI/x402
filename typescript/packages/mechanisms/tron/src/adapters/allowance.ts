import type { TronWeb } from "tronweb";
import type { ClientTronSigner, AllowanceMode } from "../signer";
import type { Trc20ApprovalPolicy } from "../approvalPolicy";
import { erc20AllowanceAbi, erc20ApproveAbi, PERMIT2_ADDRESSES } from "../constants";
import { buildSignAndBroadcast, type SignTransactionFn } from "../transactions/contracts";
import { pollTransactionPacked } from "../transactions/receipt";

export const MAX_UINT256 = (1n << 256n) - 1n;
export const APPROVE_FEE_LIMIT_SUN = 100_000_000;

/**
 * Ensure the token's Permit2 allowance covers `amount`, broadcasting a one-time
 * `approve(Permit2, MAX_UINT256)` if it does not. Mirrors the Python client's
 * `ensure_allowance`, with two deliberate differences: the spender is the
 * canonical Permit2 (not Python's PaymentPermit), and an allowance-read error is
 * surfaced rather than swallowed (so we never approve on bad/zeroed data).
 *
 * @param deps - TronWeb, the owner address, the wallet sign hook, and a reader.
 * @param deps.tronWeb - TronWeb instance used to build and broadcast approval transactions.
 * @param deps.ownerAddress - Token owner granting the allowance.
 * @param deps.signTransaction - Optional wallet hook for signing an approval transaction.
 * @param deps.readContract - Contract reader used to inspect the current allowance.
 * @param deps.approvalPolicy - Token-specific Approval update policy.
 * @param args - Token, required amount (payment + fee), network, and mode.
 * @param args.token - TRC-20 token contract address.
 * @param args.amount - Required Permit2 allowance.
 * @param args.network - Canonical TRON CAIP-2 network.
 * @param args.mode - Allowance handling mode.
 * @returns `true` once the allowance is sufficient.
 */
export async function ensurePermit2Allowance(
  deps: {
    tronWeb: TronWeb;
    ownerAddress: string;
    signTransaction?: SignTransactionFn;
    readContract: NonNullable<ClientTronSigner["readContract"]>;
    approvalPolicy: Trc20ApprovalPolicy;
  },
  args: { token: string; amount: bigint; network: string; mode?: AllowanceMode },
): Promise<boolean> {
  const mode = args.mode ?? "auto";
  if (mode === "skip") {
    return true;
  }
  if (mode === "interactive") {
    throw new Error("ensureAllowance: interactive approval mode is not implemented");
  }

  const permit2Address = PERMIT2_ADDRESSES[args.network];
  if (!permit2Address) {
    throw new Error(`No Permit2 contract address configured for network ${args.network}`);
  }

  // Read the ERC-20 allowance the token grants Permit2. Do NOT swallow errors:
  // approving on a failed/zeroed read would burn TRX needlessly.
  const currentRaw = (await deps.readContract({
    address: args.token,
    abi: erc20AllowanceAbi as unknown as readonly Record<string, unknown>[],
    functionName: "allowance",
    args: [deps.ownerAddress, permit2Address],
  })) as bigint | string | number;
  // Normalize: tronweb contract reads can surface a string/number rather than a
  // bigint; comparing a non-bigint against `args.amount` (bigint) misbehaves or
  // throws. Mirror readGasFreeBalance's BigInt() coercion.
  const current = BigInt(currentRaw);

  if (current >= args.amount) {
    return true;
  }

  const strategy = deps.approvalPolicy.strategyFor(args.network, args.token);
  if (strategy === "unsupported") {
    throw new Error("approval_asset_unsupported");
  }
  if (current !== 0n && strategy === "zero-first") {
    throw new Error("approval_reset_required");
  }

  // An approve is required but this wallet only signs typed data — surface a
  // clear error early rather than failing later at facilitator settlement.
  if (!deps.signTransaction) {
    throw new Error(
      "ensureAllowance: a one-time Permit2 approve is required but the wallet " +
        "cannot sign transactions (no signTransaction). Approve Permit2 out-of-band " +
        "or use a wallet that supports signTransaction.",
    );
  }

  // One-time approve(Permit2, MAX_UINT256); the user's wallet pays the TRX.
  const txid = await buildSignAndBroadcast(
    deps.tronWeb,
    deps.ownerAddress,
    deps.signTransaction,
    {
      address: args.token,
      abi: erc20ApproveAbi as unknown as readonly Record<string, unknown>[],
      functionName: "approve",
      args: [permit2Address, MAX_UINT256],
    },
    { feeLimit: APPROVE_FEE_LIMIT_SUN },
  );

  // Confirm at packed speed (~3s), not solidification (~60s): the allowance is
  // live once the approve is packed, which is all the following payment needs.
  const receipt = await pollTransactionPacked(deps.tronWeb, txid);
  if (receipt.status !== "success") {
    throw new Error(`Permit2 approval did not succeed (status=${receipt.status}, tx=${txid})`);
  }
  return true;
}


import { decodePaymentResponseHeader } from "@bankofai/x402-core/http";
import type { PaymentRequirements, SettleResponse } from "@bankofai/x402-core/types";
import type { ClientTronSigner } from "../../signer";
import { normalizeAddressForSigning } from "../../utils";
import { batchSettlementABI } from "../../shared/batch-settlement/abi";
import {
  getBatchSettlementAddress,
  MIN_WITHDRAW_DELAY,
} from "../../shared/batch-settlement/constants";
import { computeChannelId } from "../../shared/batch-settlement/utils";
import type {
  BatchSettlementPaymentRequirementsExtra,
  BatchSettlementPaymentResponseExtra,
  ChannelConfig,
} from "../types";
import { toBigInt } from "../facilitator/utils";
import type { BatchSettlementClientContext, ClientChannelStorage } from "./storage";

const abi = batchSettlementABI as unknown as readonly Record<string, unknown>[];
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

type ResponseChannelState = NonNullable<BatchSettlementPaymentResponseExtra["channelState"]>;

/**
 * Reads the nested channel state from a settlement response extra object.
 *
 * @param extra - Settlement response extra fields.
 * @returns Channel state fields, or undefined when absent.
 */
function readResponseChannelState(
  extra: Record<string, unknown>,
): ResponseChannelState | undefined {
  const channelState = extra.channelState;
  if (typeof channelState !== "object" || channelState === null) return undefined;
  return channelState as ResponseChannelState;
}

/**
 * Runtime dependency bag shared by every storage-bound client helper.
 */
export interface BatchSettlementClientDeps {
  signer: ClientTronSigner;
  storage: ClientChannelStorage;
  salt: `0x${string}`;
  payerAuthorizer?: string;
  voucherSigner?: ClientTronSigner;
}

/**
 * Constructs the immutable {@link ChannelConfig} from payment requirements and a
 * client deps bag (signer, salt, optional payerAuthorizer / voucherSigner).
 *
 * @param deps - Client identity inputs.
 * @param paymentRequirements - Server payment requirements providing receiver, asset, and extra.
 * @returns The ChannelConfig that uniquely identifies this payment channel.
 */
export function buildChannelConfig(
  deps: BatchSettlementClientDeps,
  paymentRequirements: PaymentRequirements,
): ChannelConfig {
  const extra = paymentRequirements.extra as
    | Partial<BatchSettlementPaymentRequirementsExtra>
    | undefined;
  const receiverAuthorizer = extra?.receiverAuthorizer;
  if (!receiverAuthorizer || normalizeAddressForSigning(receiverAuthorizer) === ZERO_ADDRESS) {
    throw new Error("Payment requirements must include a non-zero extra.receiverAuthorizer");
  }

  return {
    payer: normalizeAddressForSigning(deps.signer.address),
    payerAuthorizer: normalizeAddressForSigning(
      deps.payerAuthorizer ?? deps.voucherSigner?.address ?? deps.signer.address,
    ),
    receiver: normalizeAddressForSigning(paymentRequirements.payTo),
    receiverAuthorizer: normalizeAddressForSigning(receiverAuthorizer),
    token: normalizeAddressForSigning(paymentRequirements.asset),
    withdrawDelay:
      typeof extra?.withdrawDelay === "number" ? extra.withdrawDelay : MIN_WITHDRAW_DELAY,
    salt: deps.salt,
  };
}

/**
 * Updates local channel state from a parsed `SettleResponse`.
 *
 * @param storage - Client channel storage.
 * @param settle - The parsed settle response.
 */
export async function processSettleResponse(
  storage: ClientChannelStorage,
  settle: SettleResponse,
): Promise<void> {
  const extra = settle.extra ?? {};
  const channelState = readResponseChannelState(extra);
  if (!channelState) return;

  const key = channelState.channelId.toLowerCase();
  const prev = await storage.get(key);
  const next: BatchSettlementClientContext = { ...(prev ?? {}) };

  if (channelState.chargedCumulativeAmount !== undefined) {
    next.chargedCumulativeAmount = String(channelState.chargedCumulativeAmount);
  }
  if (channelState.balance !== undefined) next.balance = String(channelState.balance);
  if (channelState.totalClaimed !== undefined)
    next.totalClaimed = String(channelState.totalClaimed);

  await storage.set(key, next);
}

/**
 * Reconciles local channel state with the outcome of a cooperative refund.
 *
 * @param storage - Client channel storage.
 * @param channelKey - Lowercased channel id used as the storage key.
 * @param settleExtra - The `extra` block from the refund settle response.
 */
export async function updateChannelAfterRefund(
  storage: ClientChannelStorage,
  channelKey: string,
  settleExtra: Record<string, unknown>,
): Promise<void> {
  const channelState = readResponseChannelState(settleExtra);
  if (!channelState) {
    await storage.delete(channelKey);
    return;
  }

  const balanceAfter =
    channelState.balance !== undefined ? BigInt(String(channelState.balance)) : undefined;
  if (balanceAfter === undefined || balanceAfter <= 0n) {
    await storage.delete(channelKey);
    return;
  }

  const prev = await storage.get(channelKey);
  const next: BatchSettlementClientContext = { ...(prev ?? {}) };
  next.balance = balanceAfter.toString();
  if (channelState.chargedCumulativeAmount !== undefined) {
    next.chargedCumulativeAmount = String(channelState.chargedCumulativeAmount);
  }
  if (channelState.totalClaimed !== undefined)
    next.totalClaimed = String(channelState.totalClaimed);
  await storage.set(channelKey, next);
}

/**
 * Processes the `PAYMENT-RESPONSE` header after a successful request.
 *
 * @param storage - Client channel storage.
 * @param getHeader - Function to retrieve a response header by name.
 */
export async function processPaymentResponse(
  storage: ClientChannelStorage,
  getHeader: (name: string) => string | null | undefined,
): Promise<void> {
  const raw = getHeader("PAYMENT-RESPONSE");
  if (!raw) return;
  const settle = decodePaymentResponseHeader(raw);
  await processSettleResponse(storage, settle);
}

/**
 * Recovers a channel record from onchain state (useful after a cold start).
 *
 * @param deps - Signer + storage + identity inputs.
 * @param paymentRequirements - Server payment requirements used to derive the ChannelConfig.
 * @returns The recovered client context.
 */
export async function recoverChannel(
  deps: BatchSettlementClientDeps,
  paymentRequirements: PaymentRequirements,
): Promise<BatchSettlementClientContext> {
  const config = buildChannelConfig(deps, paymentRequirements);
  const channelId = computeChannelId(config, paymentRequirements.network);
  const [chBalance, chTotalClaimed] = await readChannelBalanceAndTotalClaimed(
    deps.signer,
    channelId,
    paymentRequirements.network,
  );

  const ctx: BatchSettlementClientContext = {
    chargedCumulativeAmount: chTotalClaimed.toString(),
    balance: chBalance.toString(),
    totalClaimed: chTotalClaimed.toString(),
  };

  await deps.storage.set(channelId.toLowerCase(), ctx);
  return ctx;
}

/**
 * Reads `channels(channelId)` returning `[balance, totalClaimed]`.
 *
 * @param signer - Signer providing `readContract`.
 * @param channelId - The `bytes32` channel id to query.
 * @param network - CAIP-2 network identifier.
 * @returns Tuple of `[balance, totalClaimed]` as bigints.
 */
export async function readChannelBalanceAndTotalClaimed(
  signer: ClientTronSigner,
  channelId: `0x${string}`,
  network: string,
): Promise<[bigint, bigint]> {
  const result = await signer.readContract({
    address: getBatchSettlementAddress(network),
    abi,
    functionName: "channels",
    args: [channelId],
  });
  if (Array.isArray(result)) return [toBigInt(result[0]), toBigInt(result[1])];
  const obj = result as Record<string, unknown>;
  return [toBigInt(obj.balance ?? obj["0"]), toBigInt(obj.totalClaimed ?? obj["1"])];
}

/**
 * Returns whether a local channel record exists for the given channel.
 *
 * @param storage - Client channel storage.
 * @param channelId - The channel identifier to check.
 * @returns `true` when a channel record is stored.
 */
export async function hasChannel(
  storage: ClientChannelStorage,
  channelId: string,
): Promise<boolean> {
  return (await storage.get(channelId.toLowerCase())) !== undefined;
}

/**
 * Returns the local channel context for a channel, if present.
 *
 * @param storage - Client channel storage.
 * @param channelId - The channel identifier.
 * @returns Stored context or `undefined`.
 */
export async function getChannel(
  storage: ClientChannelStorage,
  channelId: string,
): Promise<BatchSettlementClientContext | undefined> {
  return storage.get(channelId.toLowerCase());
}

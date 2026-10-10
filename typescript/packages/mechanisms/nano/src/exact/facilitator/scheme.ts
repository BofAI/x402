import {
  PaymentPayload,
  PaymentRequirements,
  SchemeNetworkFacilitator,
  SettleResponse,
  VerifyResponse,
} from "@bankofai/x402-core/types";
import { nanoAddressToPublicKey } from "../../address";
import { parseRaw } from "../../amount";
import { NANO_CAIP_FAMILY, NANO_MAINNET, XNO_ASSET } from "../../network";
import { isNanoBlockHash, NanoBlockInfo, NanoRpcClient } from "../../types";
import { InMemoryNanoUsedBlockStore, NanoUsedBlockStore } from "./usedBlocks";
import * as errors from "./errors";

/** Allowed clock skew, in seconds, for a block timestamp in the future. */
const MAX_FUTURE_SKEW_SECONDS = 60;

/** Configuration for the Nano `exact` facilitator. */
export interface ExactNanoFacilitatorConfig {
  /** Node RPC used for the single `block_info` lookup per payment. */
  rpc: NanoRpcClient;
  /**
   * Oldest block accepted, in seconds. Defaults to the requirement's
   * `maxTimeoutSeconds`.
   */
  maxBlockAgeSeconds?: number;
  /** Replay guard; defaults to a process-local in-memory store. */
  usedBlocks?: NanoUsedBlockStore;
}

type VerifiedBlock = { isValid: true; payer: string; hash: string; amount: string };
type RejectedBlock = {
  isValid: false;
  invalidReason: string;
  invalidMessage?: string;
  payer?: string;
};

/**
 * Nano facilitator implementation for the Exact payment scheme.
 *
 * Nano has no third-party settlement: the payer publishes its own send block
 * and hands over the hash. Verification is one `block_info` call checking the
 * block is a confirmed, recent send to `payTo` of at least the required
 * amount. Settlement broadcasts nothing; it records the hash so the same
 * block cannot pay twice and returns it as the transaction.
 */
export class ExactNanoScheme implements SchemeNetworkFacilitator {
  readonly scheme = "exact";
  readonly caipFamily = NANO_CAIP_FAMILY;
  private readonly usedBlocks: NanoUsedBlockStore;

  /**
   * Creates a new ExactNanoScheme facilitator instance.
   *
   * @param config - RPC client, block age limit and replay store.
   */
  constructor(private readonly config: ExactNanoFacilitatorConfig) {
    this.usedBlocks = config.usedBlocks ?? new InMemoryNanoUsedBlockStore();
  }

  /**
   * Nano needs no extra data in the supported response.
   *
   * @param _ - The network identifier (unused).
   * @returns Always undefined.
   */
  getExtra(_: string): Record<string, unknown> | undefined {
    return undefined;
  }

  /**
   * The facilitator signs nothing, so it has no signer addresses.
   *
   * @param _ - The network identifier (unused).
   * @returns An empty list.
   */
  getSigners(_: string): string[] {
    return [];
  }

  /**
   * Verifies that the payload names a confirmed send block paying the requirements.
   *
   * @param payload - The payment payload to verify
   * @param requirements - The payment requirements
   * @returns Promise resolving to verification response
   */
  async verify(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<VerifyResponse> {
    const result = await this.checkBlock(payload, requirements);
    if (!result.isValid) {
      return result;
    }
    return { isValid: true, payer: result.payer };
  }

  /**
   * Settles a payment. The block is already on the ledger, so this re-verifies
   * it, marks the hash as used and returns it.
   *
   * @param payload - The payment payload to settle
   * @param requirements - The payment requirements
   * @returns Promise resolving to settlement response
   */
  async settle(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<SettleResponse> {
    const result = await this.checkBlock(payload, requirements);
    if (!result.isValid) {
      return {
        success: false,
        errorReason: result.invalidReason,
        errorMessage: result.invalidMessage,
        payer: result.payer,
        transaction: "",
        network: requirements.network,
      };
    }
    if (!(await this.usedBlocks.add(result.hash))) {
      return {
        success: false,
        errorReason: errors.BLOCK_ALREADY_USED,
        payer: result.payer,
        transaction: "",
        network: requirements.network,
      };
    }
    return {
      success: true,
      payer: result.payer,
      transaction: result.hash,
      network: requirements.network,
      amount: result.amount,
    };
  }

  /**
   * Run every check against the requirements and the node's view of the block.
   *
   * @param payload - The payment payload.
   * @param requirements - The payment requirements.
   * @returns The verified block, or the reason it was rejected.
   */
  private async checkBlock(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<VerifiedBlock | RejectedBlock> {
    if (payload.accepted.scheme !== "exact" || requirements.scheme !== "exact") {
      return { isValid: false, invalidReason: errors.INVALID_SCHEME };
    }
    if (requirements.network !== NANO_MAINNET || payload.accepted.network !== NANO_MAINNET) {
      return { isValid: false, invalidReason: errors.NETWORK_MISMATCH };
    }
    if (requirements.asset !== XNO_ASSET) {
      return { isValid: false, invalidReason: errors.INVALID_ASSET };
    }

    let payToKey: string;
    let required: bigint;
    try {
      payToKey = nanoAddressToPublicKey(requirements.payTo);
    } catch {
      return { isValid: false, invalidReason: errors.INVALID_PAY_TO };
    }
    try {
      required = parseRaw(requirements.amount);
    } catch {
      return { isValid: false, invalidReason: errors.INVALID_REQUIRED_AMOUNT };
    }

    const blockHash = (payload.payload as { blockHash?: unknown }).blockHash;
    if (!isNanoBlockHash(blockHash)) {
      return { isValid: false, invalidReason: errors.INVALID_PAYLOAD };
    }
    const hash = blockHash.toUpperCase();
    if (await this.usedBlocks.has(hash)) {
      return { isValid: false, invalidReason: errors.BLOCK_ALREADY_USED };
    }

    let info: NanoBlockInfo;
    try {
      info = await this.config.rpc.blockInfo(hash);
    } catch (error) {
      return {
        isValid: false,
        invalidReason: errors.CHAIN_READ_FAILED,
        invalidMessage: error instanceof Error ? error.message : String(error),
      };
    }
    const payer = info.block_account;

    if (info.confirmed !== "true" && info.confirmed !== true) {
      return { isValid: false, invalidReason: errors.BLOCK_NOT_CONFIRMED, payer };
    }

    const contents = info.contents;
    const isStateSend = contents?.type === "state" && (info.subtype ?? contents.subtype) === "send";
    const isLegacySend = contents?.type === "send";
    if (!isStateSend && !isLegacySend) {
      return { isValid: false, invalidReason: errors.NOT_A_SEND_BLOCK, payer };
    }

    // The recipient of a send is the link (state) or destination (legacy),
    // never block_account, which is the payer.
    let recipientKey: string;
    try {
      recipientKey = isStateSend
        ? linkToPublicKey(contents.link, contents.link_as_account)
        : nanoAddressToPublicKey(contents.destination ?? "");
    } catch {
      return { isValid: false, invalidReason: errors.INVALID_BLOCK, payer };
    }
    if (recipientKey !== payToKey) {
      return { isValid: false, invalidReason: errors.RECIPIENT_MISMATCH, payer };
    }

    let paid: bigint;
    try {
      paid = parseRaw(info.amount ?? "");
    } catch {
      return { isValid: false, invalidReason: errors.INVALID_BLOCK, payer };
    }
    if (paid < required) {
      return {
        isValid: false,
        invalidReason: errors.AMOUNT_INSUFFICIENT,
        invalidMessage: `paid ${paid} raw, required ${required} raw`,
        payer,
      };
    }

    const timestamp = Number(info.local_timestamp ?? "0");
    const now = Math.floor(Date.now() / 1000);
    const maxAge = this.config.maxBlockAgeSeconds ?? requirements.maxTimeoutSeconds;
    if (
      !Number.isSafeInteger(timestamp) ||
      timestamp <= 0 ||
      now - timestamp > maxAge ||
      timestamp - now > MAX_FUTURE_SKEW_SECONDS
    ) {
      return { isValid: false, invalidReason: errors.BLOCK_EXPIRED, payer };
    }

    return { isValid: true, payer, hash, amount: paid.toString() };
  }
}

/**
 * Resolve the recipient public key of a state send block. Uses the raw `link`
 * field and, when the node also returned `link_as_account`, requires both to agree.
 *
 * @param link - 64-character hex link field.
 * @param linkAsAccount - Optional address form of the link.
 * @returns Uppercase hex public key of the recipient.
 */
function linkToPublicKey(link: string | undefined, linkAsAccount: string | undefined): string {
  if (link === undefined) {
    return nanoAddressToPublicKey(linkAsAccount ?? "");
  }
  if (!isNanoBlockHash(link)) {
    throw new Error("Invalid link field");
  }
  const key = link.toUpperCase();
  if (linkAsAccount !== undefined && nanoAddressToPublicKey(linkAsAccount) !== key) {
    throw new Error("link and link_as_account disagree");
  }
  return key;
}

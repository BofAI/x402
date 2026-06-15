import type { Network } from "@x402/core/types";
import { TronWeb, Trx } from "tronweb";
import { SUPPORTED_TRON_NETWORKS, TRC20_TRANSFER_SELECTOR } from "./constants";
import type { ExactTronPayloadV2, InspectedTronTransaction, SignedTronTransaction } from "./types";

/**
 * Returns true when the network is supported by this mechanism.
 *
 * @param network - Network identifier
 * @returns True when supported
 */
export function isSupportedTronNetwork(
  network: string,
): network is (typeof SUPPORTED_TRON_NETWORKS)[number] {
  return SUPPORTED_TRON_NETWORKS.includes(network as (typeof SUPPORTED_TRON_NETWORKS)[number]);
}

/**
 * Assert that a network is supported by this mechanism.
 *
 * @param network - Network identifier
 */
export function assertSupportedTronNetwork(network: string): asserts network is Network {
  if (!isSupportedTronNetwork(network)) {
    throw new Error(`Unsupported TRON network: ${network}`);
  }
}

/**
 * Validate a TRON address.
 *
 * @param address - Base58Check or hex TRON address
 * @returns True when valid
 */
export function isValidTronAddress(address: string): boolean {
  return TronWeb.isAddress(address);
}

/**
 * Convert a TRON address into canonical lowercase hex.
 *
 * @param address - Base58Check or hex TRON address
 * @returns Canonical hex address
 */
export function normalizeTronAddress(address: string): string {
  if (!isValidTronAddress(address)) {
    throw new Error(`Invalid TRON address: ${address}`);
  }
  return TronWeb.address.toHex(address).toLowerCase();
}

/**
 * Extract a signed transaction from an exact payload.
 *
 * @param payload - Exact TRON payload
 * @returns Signed transaction
 */
export function extractTransactionFromPayload(payload: ExactTronPayloadV2): SignedTronTransaction {
  if (!payload || !payload.transaction || typeof payload.transaction !== "object") {
    throw new Error("invalid_exact_tron_payload_transaction");
  }
  return payload.transaction;
}

/**
 * Decode and validate the static structure of a signed TRC-20 transfer.
 *
 * @param transaction - Signed TRON transaction
 * @returns Normalized transfer details
 */
export function inspectTronTransaction(
  transaction: SignedTronTransaction,
): InspectedTronTransaction {
  if (!transaction.txID || !/^[0-9a-fA-F]{64}$/.test(transaction.txID)) {
    throw new Error("invalid_transaction_id");
  }
  if (!Array.isArray(transaction.signature) || transaction.signature.length !== 1) {
    throw new Error("exactly_one_signature_required");
  }

  const contracts = transaction.raw_data?.contract;
  if (!Array.isArray(contracts) || contracts.length !== 1) {
    throw new Error("exactly_one_contract_required");
  }

  const contract = contracts[0];
  if (
    contract.type !== "TriggerSmartContract" ||
    !contract.parameter?.type_url?.endsWith(".TriggerSmartContract")
  ) {
    throw new Error("trc20_transfer_required");
  }

  const value = contract.parameter.value;
  const ownerAddress = value.owner_address;
  const contractAddress = value.contract_address;
  const data = value.data;
  if (
    typeof ownerAddress !== "string" ||
    typeof contractAddress !== "string" ||
    typeof data !== "string"
  ) {
    throw new Error("invalid_trigger_smart_contract");
  }
  if ((value.call_value ?? 0) !== 0 || (value.call_token_value ?? 0) !== 0) {
    throw new Error("native_value_not_allowed");
  }

  const normalizedData = data.replace(/^0x/, "").toLowerCase();
  if (!/^[0-9a-f]{136}$/.test(normalizedData)) {
    throw new Error("invalid_trc20_transfer_data");
  }
  if (normalizedData.slice(0, 8) !== TRC20_TRANSFER_SELECTOR) {
    throw new Error("trc20_transfer_required");
  }

  const recipientWord = normalizedData.slice(8, 72);
  if (!recipientWord.startsWith("000000000000000000000000")) {
    throw new Error("non_canonical_recipient_address");
  }
  const recipientHex = `41${recipientWord.slice(-40)}`;
  const amountWord = normalizedData.slice(72, 136);
  const amount = BigInt(`0x${amountWord}`);
  if (amount <= 0n) {
    throw new Error("amount_must_be_positive");
  }

  const recovered = Trx.ecRecover(transaction);
  if (typeof recovered !== "string") {
    throw new Error("multisig_not_supported");
  }
  if (normalizeTronAddress(recovered) !== normalizeTronAddress(ownerAddress)) {
    throw new Error("signature_owner_mismatch");
  }

  const timestamp = transaction.raw_data.timestamp;
  const expiration = transaction.raw_data.expiration;
  const feeLimit = transaction.raw_data.fee_limit ?? 0;
  if (
    !Number.isSafeInteger(timestamp) ||
    !Number.isSafeInteger(expiration) ||
    !Number.isSafeInteger(feeLimit)
  ) {
    throw new Error("invalid_transaction_limits");
  }
  if (expiration <= timestamp) {
    throw new Error("invalid_transaction_expiration");
  }

  return {
    transactionId: transaction.txID,
    payer: TronWeb.address.fromHex(normalizeTronAddress(ownerAddress)),
    asset: TronWeb.address.fromHex(normalizeTronAddress(contractAddress)),
    payTo: TronWeb.address.fromHex(recipientHex),
    amount: amount.toString(),
    timestamp,
    expiration,
    feeLimit,
  };
}

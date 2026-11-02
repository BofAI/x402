import { sha256 } from "@noble/hashes/sha256";
import { encodeNanoAddress } from "./address";

/**
 * The payment secret: 128 to 512 bits of hex chosen by the payer for one
 * payment. Only a hash of it ever reaches the ledger, so it stays private until
 * the payer presents it in the payment payload.
 */
const SECRET_PATTERN = /^[0-9a-fA-F]{32,128}$/;

/**
 * Check whether a value is a payment secret.
 *
 * @param value - Candidate secret.
 * @returns Whether the value is 32 to 128 hex characters.
 */
export function isNanoPaymentSecret(value: unknown): value is string {
  return typeof value === "string" && SECRET_PATTERN.test(value);
}

/**
 * The order commitment a payment's send block carries as its `representative`:
 * the `nano_` account whose public key is
 * `SHA256("xno-binding/v1/rep|" + secret + "|" + payTo + "|" + amountRaw)`
 * (option C of the XNO payment-to-order binding standard,
 * github.com/dhyabi2/xno-call-binding/blob/main/docs/BINDING-STANDARD.md, with the
 * payer's secret as the order id).
 *
 * The paying key signs the block, so only the payer can put this value in it,
 * and a stranger who reads the block off the ledger cannot present its hash:
 * redeeming needs the secret whose hash this is.
 *
 * @param secret - The payer's payment secret (hex).
 * @param payTo - The `payTo` string of the requirements being paid.
 * @param amountRaw - The `amount` of the requirements, in raw.
 * @returns The commitment as a `nano_` account.
 */
export function nanoOrderCommitment(secret: string, payTo: string, amountRaw: string): string {
  const preimage = `xno-binding/v1/rep|${secret}|${payTo}|${amountRaw}`;
  return encodeNanoAddress(sha256(new TextEncoder().encode(preimage)));
}

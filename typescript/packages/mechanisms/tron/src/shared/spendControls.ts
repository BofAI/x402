/**
 * Enforce Core's resolved atomic cap against the amount actually authorized.
 *
 * @param amount - Maximum token debit authorized by this operation.
 * @param cap - Resolved atomic cap, or undefined when controls are disabled.
 */
export function assertTronSpendCap(amount: bigint, cap?: string): void {
  if (cap === undefined) return;
  if (!/^[0-9]+$/.test(cap)) throw new Error("invalid_payment_spend_cap");
  if (amount > BigInt(cap)) throw new Error("payment_amount_exceeds_spend_cap");
}

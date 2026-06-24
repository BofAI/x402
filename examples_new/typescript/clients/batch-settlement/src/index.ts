/**
 * x402 batch-settlement client — chain-agnostic, EVM + TRON.
 *
 * Registers the `batch-settlement` client scheme for each configured chain, wraps
 * `fetch` so 402 challenges are paid automatically, then fires a burst of N
 * requests against the same endpoint. The first request opens a payment channel
 * (one on-chain deposit); the rest are paid by off-chain vouchers. Optionally
 * refunds the channel's remaining balance at the end.
 *
 * Which chain is used is decided by the payment-selection pipeline from what the
 * server advertises and what wallets are configured here — this file imports no
 * chain SDK directly.
 */
import { x402Client, wrapFetchWithPayment, decodePaymentResponseHeader } from "@bankofai/x402-fetch";

import { registerEvm } from "./chains/evm.js";
import { registerTron } from "./chains/tron.js";
import type { BatchClientOptions, RefundableScheme } from "./env.js";

const RESOURCE_URL = process.env.RESOURCE_URL || "http://localhost:4041/weather";
const NUMBER_OF_REQUESTS = Number(process.env.NUMBER_OF_REQUESTS ?? "3");
const REFUND_AFTER = process.env.REFUND_AFTER_REQUESTS === "true";
const REFUND_AMOUNT = process.env.REFUND_AMOUNT?.trim() || undefined;

const opts: BatchClientOptions = {
  salt: (process.env.CHANNEL_SALT?.trim() ||
    "0x0000000000000000000000000000000000000000000000000000000000000000") as `0x${string}`,
  depositMultiplier: Number(process.env.DEPOSIT_MULTIPLIER ?? "5"),
};

const client = new x402Client();

const refundable: RefundableScheme[] = [
  ...(await registerEvm(client, opts)),
  ...(await registerTron(client, opts)),
];
if (refundable.length === 0) {
  console.error("❌ No wallet configured for EVM or TRON (see agent-wallet setup).");
  process.exit(1);
}

const fetchWithPay = wrapFetchWithPayment(fetch, client);

console.log(`→ ${NUMBER_OF_REQUESTS}× GET ${RESOURCE_URL}\n`);
// The chain is chosen by the payment pipeline at request time; capture which
// network actually settled (from the PAYMENT-RESPONSE header) so we refund only
// that channel — not every registered scheme.
let usedNetwork: string | undefined;
for (let i = 1; i <= NUMBER_OF_REQUESTS; i++) {
  const t0 = performance.now();
  const res = await fetchWithPay(RESOURCE_URL, { method: "GET" });
  usedNetwork ??= networkFromPaymentResponse(res);
  const body = await res.json();
  const secs = ((performance.now() - t0) / 1000).toFixed(3);
  console.log(`request ${i}/${NUMBER_OF_REQUESTS} — ${res.status} in ${secs}s`);
  console.log(JSON.stringify(body, null, 2));
}

if (REFUND_AFTER) {
  const scheme = refundable.find(s => s.label === usedNetwork);
  if (!scheme) {
    console.log("\n↩️  nothing to refund (no settled payment captured)");
  } else {
    console.log(
      REFUND_AMOUNT
        ? `\n↩️  refunding ${REFUND_AMOUNT} base units on ${scheme.label}`
        : `\n↩️  refunding remaining channel balance on ${scheme.label}`,
    );
    const result = await scheme.refund(RESOURCE_URL, REFUND_AMOUNT ? { amount: REFUND_AMOUNT } : {});
    console.log(JSON.stringify(result, null, 2));
  }
}

/**
 * Reads the settled network from a paid response's `PAYMENT-RESPONSE` header
 * via the SDK decoder, or `undefined` if absent/unparseable.
 *
 * @param res - The response returned by the payment-wrapped fetch.
 * @returns The CAIP-2 network string, or `undefined`.
 */
function networkFromPaymentResponse(res: Response): string | undefined {
  const header = res.headers.get("payment-response") ?? res.headers.get("x-payment-response");
  if (!header) return undefined;
  try {
    return decodePaymentResponseHeader(header).network;
  } catch {
    return undefined;
  }
}

/**
 * x402 upto client — chain-agnostic, EVM + TRON.
 *
 * Registers the `upto` client scheme for each configured chain, wraps `fetch` so
 * 402 challenges are paid automatically, then fires N usage-billed requests. Each
 * request signs an authorization for up to the server's advertised maximum; the
 * server settles only the real usage it reports (<= max), so every request can
 * cost a different amount from the same one-time authorization shape.
 *
 * Which chain is used is decided by the payment-selection pipeline from what the
 * server advertises and what wallets are configured here — this file imports no
 * chain SDK directly.
 */
import { x402Client, wrapFetchWithPayment } from "@bankofai/x402-fetch";

import { registerEvm } from "./chains/evm.js";
import { registerTron } from "./chains/tron.js";

const RESOURCE_URL = process.env.RESOURCE_URL || "http://localhost:4051/generate";
const NUMBER_OF_REQUESTS = Number(process.env.NUMBER_OF_REQUESTS ?? "3");

const client = new x402Client();

const networks: string[] = [...(await registerEvm(client)), ...(await registerTron(client))];
if (networks.length === 0) {
  console.error("❌ No wallet configured for EVM or TRON (see agent-wallet setup).");
  process.exit(1);
}

const fetchWithPay = wrapFetchWithPayment(fetch, client);

console.log(`→ ${NUMBER_OF_REQUESTS}× GET ${RESOURCE_URL}\n`);
for (let i = 1; i <= NUMBER_OF_REQUESTS; i++) {
  const t0 = performance.now();
  const res = await fetchWithPay(RESOURCE_URL, { method: "GET" });
  const body = await res.json();
  const secs = ((performance.now() - t0) / 1000).toFixed(3);
  console.log(`request ${i}/${NUMBER_OF_REQUESTS} — ${res.status} in ${secs}s`);
  console.log(JSON.stringify(body, null, 2));
}

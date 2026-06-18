/**
 * x402 fetch client — chain-agnostic.
 *
 * Registers EVM and TRON `exact` schemes (each gated on a configured wallet),
 * wraps `fetch` so 402 challenges are paid automatically, and hits a protected
 * resource. The payment-selection pipeline picks an option matching a registered
 * scheme/network; this file imports no chain SDK directly.
 */
import { x402Client, wrapFetchWithPayment } from "@bankofai/x402-fetch";

import { registerEvm } from "./chains/evm.js";
import { registerTron } from "./chains/tron.js";

const RESOURCE_URL = process.env.RESOURCE_URL || "http://localhost:4021/weather";

const client = new x402Client();

const evm = await registerEvm(client);
const tron = await registerTron(client);
if (!evm && !tron) {
  console.error("❌ No wallet configured for EVM or TRON (see agent-wallet setup).");
  process.exit(1);
}

const fetchWithPay = wrapFetchWithPayment(fetch, client);

console.log(`→ GET ${RESOURCE_URL}`);
const res = await fetchWithPay(RESOURCE_URL);
console.log(`← ${res.status} ${res.statusText}`);
console.log(JSON.stringify(await res.json(), null, 2));

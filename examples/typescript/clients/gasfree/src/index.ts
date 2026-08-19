/**
 * x402 GasFree fetch client (TRON-only, scheme `exact_gasfree`).
 *
 * Registers the TRON `exact_gasfree` client scheme (gated on a configured TRON
 * wallet), wraps `fetch` so 402 challenges are paid automatically, and hits a
 * protected resource. The payer signs a TIP-712 GasFree permit; a relayer pays
 * the on-chain energy — the payer needs no TRX.
 */
import { x402Client, wrapFetchWithPayment } from "@bankofai/x402-fetch";

import { registerTronGasFree } from "./chains/tron.js";

// Dedicated env var (set in .env-gasfree) so the GasFree line stays on its own
// :4031 server, independent of the other scenarios.
const RESOURCE_URL =
  process.env.RESOURCE_URL || "http://localhost:4031/weather";

const client = new x402Client();

const tron = await registerTronGasFree(client);
if (!tron) {
  console.error("❌ No TRON wallet configured (see agent-wallet setup).");
  process.exit(1);
}

const fetchWithPay = wrapFetchWithPayment(fetch, client);

console.log(`→ GET ${RESOURCE_URL}`);
const res = await fetchWithPay(RESOURCE_URL);
const body = await res.json();
console.log(`← ${res.status} ${res.statusText}`);
console.log(JSON.stringify(body, null, 2));
if (!res.ok) {
  throw new Error(`request failed with HTTP ${res.status}`);
}

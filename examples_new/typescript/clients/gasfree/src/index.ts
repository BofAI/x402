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

// Dedicated env var so the shared .env-local (RESOURCE_URL → main-line :4021)
// never shadows the GasFree server port.
const RESOURCE_URL = process.env.GASFREE_RESOURCE_URL || "http://localhost:4031/weather";

const client = new x402Client();

const tron = await registerTronGasFree(client);
if (!tron) {
  console.error("❌ No TRON wallet configured (see agent-wallet setup).");
  process.exit(1);
}

const fetchWithPay = wrapFetchWithPayment(fetch, client);

console.log(`→ GET ${RESOURCE_URL}`);
const res = await fetchWithPay(RESOURCE_URL);
console.log(`← ${res.status} ${res.statusText}`);
console.log(JSON.stringify(await res.json(), null, 2));

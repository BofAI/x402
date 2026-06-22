/**
 * x402 fetch client — chain-agnostic.
 *
 * Registers EVM and TRON schemes (each gated on a configured wallet), wraps
 * `fetch` so 402 challenges are paid automatically, and hits protected
 * resources. The payment-selection pipeline picks an option matching a
 * registered scheme/network; this file imports no chain SDK directly.
 */
import { x402Client, wrapFetchWithPayment } from "@bankofai/x402-fetch";

import { registerEvm } from "./chains/evm.js";
import { registerTron } from "./chains/tron.js";

const DEFAULT_RESOURCE_URLS = [
  "http://localhost:4021/weather",
  "http://localhost:4021/generate",
  "http://localhost:4021/stream",
];

const resourceUrls = process.env.RESOURCE_URLS
  ? process.env.RESOURCE_URLS.split(",").map(url => url.trim()).filter(Boolean)
  : process.env.RESOURCE_URL
    ? [process.env.RESOURCE_URL]
    : DEFAULT_RESOURCE_URLS;

const client = new x402Client();

const evm = await registerEvm(client);
const tron = await registerTron(client);
if (!evm && !tron) {
  console.error("❌ No wallet configured for EVM or TRON (see agent-wallet setup).");
  process.exit(1);
}

const fetchWithPay = wrapFetchWithPayment(fetch, client);

for (const resourceUrl of resourceUrls) {
  console.log(`GET ${resourceUrl}`);
  const res = await fetchWithPay(resourceUrl);
  console.log(`${res.status} ${res.statusText}`);
  console.log(JSON.stringify(await res.json(), null, 2));
}

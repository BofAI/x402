/**
 * x402 batch-settlement resource server (Express) — chain-agnostic, EVM + TRON.
 *
 * Protects `GET /weather` behind the `batch-settlement` scheme. The first request
 * on a fresh channel carries an on-chain deposit; subsequent requests are paid by
 * off-chain vouchers. A per-chain `BatchSettlementChannelManager` claims the
 * vouchers and settles to `payTo` in the background. Per-chain setup lives in
 * `src/chains/`; a chain registers only when its payout address is set.
 */
import express from "express";
import { HTTPFacilitatorClient } from "@bankofai/x402-core/server";
import {
  x402ResourceServer,
  x402HTTPResourceServer,
  paymentMiddlewareFromHTTPServer,
} from "@bankofai/x402-express";

import { hasEvm, registerEvm, evmAccepts, type StoppableManager } from "./chains/evm.js";
import { hasTron, registerTron, tronAccepts } from "./chains/tron.js";
import { ResourceStrippingFacilitatorClient } from "./resourceStrippingFacilitator.js";

const PORT = parseInt(process.env.SERVER_PORT || "4041", 10);
const FACILITATOR_URL = process.env.FACILITATOR_URL || "http://localhost:4042";
// Opt-in: drop `paymentPayload.resource` (a localhost URL when running locally)
// before verify/settle, to dodge edge WAFs that flag it as SSRF. See
// resourceStrippingFacilitator.ts. Off by default — wire payload stays untouched.
// The wrapped client is reused by the channel managers below, so claim/settle
// calls are stripped too.
const STRIP_RESOURCE_URL = process.env.STRIP_RESOURCE_URL === "true";
// Optional facilitator API key. When set, it's sent as `X-API-KEY` on every
// facilitator call (verify/settle/supported). Hosted facilitators use it to pick
// a rate-limit tier; anonymous calls still work, so it's unset by default.
const FACILITATOR_API_KEY = process.env.FACILITATOR_API_KEY;

const apiKeyHeaders: Record<string, string> = FACILITATOR_API_KEY ? { "X-API-KEY": FACILITATOR_API_KEY } : {};
const httpFacilitator = new HTTPFacilitatorClient({
  url: FACILITATOR_URL,
  ...(FACILITATOR_API_KEY
    ? {
        createAuthHeaders: async () => ({
          verify: apiKeyHeaders,
          settle: apiKeyHeaders,
          supported: apiKeyHeaders,
        }),
      }
    : {}),
});
const facilitatorClient = STRIP_RESOURCE_URL
  ? new ResourceStrippingFacilitatorClient(httpFacilitator)
  : httpFacilitator;
const resourceServer = new x402ResourceServer(facilitatorClient);

// Register each chain (and start its channel manager) only when its payout is set.
type Accept = ReturnType<typeof evmAccepts>[number] | ReturnType<typeof tronAccepts>[number];
const accepts: Accept[] = [];
const managers: StoppableManager[] = [];
if (hasEvm()) {
  managers.push(...registerEvm(resourceServer, facilitatorClient));
  accepts.push(...evmAccepts());
}
if (hasTron()) {
  managers.push(...registerTron(resourceServer, facilitatorClient));
  accepts.push(...tronAccepts());
}
if (accepts.length === 0) {
  console.error("❌ No payout address configured (set EVM_ADDRESS and/or TRON_ADDRESS).");
  process.exit(1);
}

const routes = {
  "GET /weather": {
    accepts,
    description: "Current weather (paid via batch-settlement channel)",
    mimeType: "application/json",
  },
};

const httpServer = new x402HTTPResourceServer(resourceServer, routes);

const app = express();
app.use(paymentMiddlewareFromHTTPServer(httpServer));

app.get("/weather", (_req, res) => {
  res.json({ report: { weather: "sunny", temperature: 70 } });
});

const server = app.listen(PORT, () => {
  console.log(
    `🌤️  Batch-settlement server on http://localhost:${PORT}  (evm=${hasEvm()}, tron=${hasTron()}) → facilitator ${FACILITATOR_URL}${STRIP_RESOURCE_URL ? " [resource.url stripped]" : ""}${FACILITATOR_API_KEY ? " [api key]" : ""}`,
  );
});

// Flush pending claims/settles before exiting so vouchers aren't lost.
process.on("SIGINT", async () => {
  console.log("\nShutting down — flushing pending claims…");
  await Promise.allSettled(managers.map(m => m.stop({ flush: true })));
  server.close(() => process.exit(0));
});

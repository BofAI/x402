/**
 * x402 upto resource server (Express) — chain-agnostic, EVM + TRON.
 *
 * Protects `GET /generate` behind the `upto` scheme. The client authorizes up to
 * the advertised maximum (`MAX_PRICE`); the route handler then decides the REAL
 * usage for this request and tells the middleware to settle only that much via a
 * `Settlement-Overrides` response header. This is usage-based billing: authorize
 * a ceiling once, charge actual usage per request.
 *
 * Per-chain setup lives in `src/chains/`; a chain registers only when its payout
 * address is set.
 */
import express from "express";
import { HTTPFacilitatorClient } from "@bankofai/x402-core/server";
import {
  x402ResourceServer,
  x402HTTPResourceServer,
  paymentMiddlewareFromHTTPServer,
  setSettlementOverrides,
} from "@bankofai/x402-express";

import { hasEvm, registerEvm, evmAccepts } from "./chains/evm.js";
import { hasTron, registerTron, tronAccepts } from "./chains/tron.js";
import { ResourceStrippingFacilitatorClient } from "./resourceStrippingFacilitator.js";

const PORT = parseInt(process.env.SERVER_PORT || "4051", 10);
const FACILITATOR_URL = process.env.FACILITATOR_URL || "http://localhost:4052";
// The authorization ceiling the client signs. Real charge is a random fraction
// of this, decided per request below.
const MAX_PRICE = process.env.MAX_PRICE || "$0.10";
// Opt-in: drop `paymentPayload.resource` (a localhost URL when running locally)
// before verify/settle, to dodge edge WAFs that flag it as SSRF. See
// resourceStrippingFacilitator.ts. Off by default — wire payload stays untouched.
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

// Register each chain and collect its accepts, only when its payout is set.
type Accept = ReturnType<typeof evmAccepts>[number] | ReturnType<typeof tronAccepts>[number];
const accepts: Accept[] = [];
if (hasEvm()) {
  registerEvm(resourceServer);
  accepts.push(...evmAccepts(MAX_PRICE));
}
if (hasTron()) {
  registerTron(resourceServer);
  accepts.push(...tronAccepts(MAX_PRICE));
}
if (accepts.length === 0) {
  console.error("❌ No payout address configured (set EVM_ADDRESS and/or TRON_ADDRESS).");
  process.exit(1);
}

const routes = {
  "GET /generate": {
    accepts,
    description: `AI text generation — billed by usage, up to ${MAX_PRICE}`,
    mimeType: "application/json",
  },
};

const httpServer = new x402HTTPResourceServer(resourceServer, routes);

const app = express();
app.use(paymentMiddlewareFromHTTPServer(httpServer));

app.get("/generate", (_req, res) => {
  // Simulate work that produces a variable cost. In production this might be LLM
  // token count, bytes served, compute time, etc. We express it as a percentage
  // of the authorized maximum so it stays asset-/decimal-agnostic across chains;
  // the middleware resolves it against the matched requirement's amount.
  // Kept in [1, 100) so a request never settles a zero amount.
  const chargedPercent = `${(1 + Math.random() * 99).toFixed(2)}%`;

  // Tell the middleware to settle only the used fraction (<= authorized max).
  setSettlementOverrides(res, { amount: chargedPercent });

  res.json({
    result: "Here is your generated text...",
    usage: {
      authorizedMax: MAX_PRICE,
      charged: chargedPercent,
      note: "Settled amount = charged% of the authorized maximum.",
    },
  });
});

app.listen(PORT, () => {
  console.log(
    `🧾 Upto server on http://localhost:${PORT}  (evm=${hasEvm()}, tron=${hasTron()}) → facilitator ${FACILITATOR_URL}${STRIP_RESOURCE_URL ? " [resource.url stripped]" : ""}${FACILITATOR_API_KEY ? " [api key]" : ""}`,
  );
  console.log(`  GET /generate — usage-based billing via upto (max ${MAX_PRICE})`);
});

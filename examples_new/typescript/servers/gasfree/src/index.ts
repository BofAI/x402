/**
 * x402 GasFree resource server (Express, TRON-only).
 *
 * Protects `GET /weather` behind payment using the TRON `exact_gasfree` scheme.
 * The resource server is keyless: it advertises `accepts` and delegates
 * verify/settle to a facilitator over HTTP.
 */
import express from "express";
import { HTTPFacilitatorClient } from "@bankofai/x402-core/server";
import {
  x402ResourceServer,
  x402HTTPResourceServer,
  paymentMiddlewareFromHTTPServer,
} from "@bankofai/x402-express";

import { hasTron, registerTron, tronAccepts } from "./chains/tron.js";
import { ResourceStrippingFacilitatorClient } from "./resourceStrippingFacilitator.js";

// Dedicated env vars (set in .env-gasfree) so the GasFree line keeps its own
// :4031/:4032, independent of the other scenarios.
const PORT = parseInt(process.env.SERVER_PORT || "4031", 10);
const FACILITATOR_URL = process.env.FACILITATOR_URL || "http://localhost:4032";
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

if (!hasTron()) {
  console.error("❌ No payout address configured (set TRON_ADDRESS).");
  process.exit(1);
}
registerTron(resourceServer);

const routes = {
  "GET /weather": {
    accepts: tronAccepts(),
    description: "Current weather (paid, GasFree)",
    mimeType: "application/json",
  },
};

const httpServer = new x402HTTPResourceServer(resourceServer, routes);

const app = express();
app.use(paymentMiddlewareFromHTTPServer(httpServer));

app.get("/weather", (_req, res) => {
  res.json({ report: { weather: "sunny", temperature: 70 } });
});

app.listen(PORT, () => {
  console.log(
    `🌤️  GasFree resource server on http://localhost:${PORT} → facilitator ${FACILITATOR_URL}${STRIP_RESOURCE_URL ? " [resource.url stripped]" : ""}${FACILITATOR_API_KEY ? " [api key]" : ""}`,
  );
});

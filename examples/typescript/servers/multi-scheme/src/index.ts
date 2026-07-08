/**
 * x402 multi-scheme resource server (Express, EVM `exact` + TRON `exact`/`exact_gasfree`).
 *
 * Protects `GET /weather` behind payment and accepts BOTH TRON schemes on the same
 * network — `exact` (permit2, payer pays TRX energy) and `exact_gasfree` (relayer
 * pays energy, payer needs no TRX) — alongside EVM `exact`. The resource server
 * is keyless: it advertises `accepts` and delegates verify/settle to facilitators
 * over HTTP, routing each payment by `(network, scheme)`.
 *
 * Two facilitators are wired:
 * - basic  (:4022)  — settles `exact` (EVM + TRON permit2).
 * - gasfree (:4032) — settles `exact_gasfree` (TRON relayer).
 * The resource server fetches `/supported` from each and dispatches accordingly.
 */
import express from "express";
import { HTTPFacilitatorClient } from "@bankofai/x402-core/server";
import { createResourceServer } from "@bankofai/x402-core";
import {
  x402HTTPResourceServer,
  paymentMiddlewareFromHTTPServer,
} from "@bankofai/x402-express";

import { hasEvm, registerEvm, evmAccepts, evmExtensions } from "./chains/evm.js";
import { hasTron, registerTron, tronAccepts } from "./chains/tron.js";
import { ResourceStrippingFacilitatorClient } from "./resourceStrippingFacilitator.js";

// Dedicated env vars (set in .env-multi-scheme) so this scenario keeps its own
// :4061, independent of the other scenarios.
const PORT = parseInt(process.env.SERVER_PORT || "4061", 10);
// Two facilitators: basic settles `exact`, gasfree settles `exact_gasfree`.
const EXACT_FACILITATOR_URL =
  process.env.EXACT_FACILITATOR_URL || process.env.FACILITATOR_URL || "http://localhost:4022";
const GASFREE_FACILITATOR_URL = process.env.GASFREE_FACILITATOR_URL || "http://localhost:4032";
// Opt-in: drop `paymentPayload.resource` (a localhost URL when running locally)
// before verify/settle, to dodge edge WAFs that flag it as SSRF. See
// resourceStrippingFacilitator.ts. Off by default — wire payload stays untouched.
const STRIP_RESOURCE_URL = process.env.STRIP_RESOURCE_URL === "true";
// Optional facilitator API key. When set, it's sent as `X-API-KEY` on every
// facilitator call (verify/settle/supported). Hosted facilitators use it to pick
// a rate-limit tier; anonymous calls still work, so it's unset by default.
const FACILITATOR_API_KEY = process.env.FACILITATOR_API_KEY;

function makeFacilitator(url: string): HTTPFacilitatorClient {
  return new HTTPFacilitatorClient({
    url,
    ...(FACILITATOR_API_KEY
      ? {
          createAuthHeaders: async () => ({
            verify: { "X-API-KEY": FACILITATOR_API_KEY },
            settle: { "X-API-KEY": FACILITATOR_API_KEY },
            supported: { "X-API-KEY": FACILITATOR_API_KEY },
          }),
        }
      : {}),
  });
}

function wrap(client: HTTPFacilitatorClient): HTTPFacilitatorClient | ResourceStrippingFacilitatorClient {
  return STRIP_RESOURCE_URL ? new ResourceStrippingFacilitatorClient(client) : client;
}

// Order matters only on overlap: earlier facilitators win a `(network, scheme)`
// slot. `exact` and `exact_gasfree` are distinct schemes, so there is no clash —
// basic handles `exact`, gasfree handles `exact_gasfree`.
const facilitatorClients = [wrap(makeFacilitator(EXACT_FACILITATOR_URL)), wrap(makeFacilitator(GASFREE_FACILITATOR_URL))];
// createResourceServer pre-attaches verify/settle logging (see express example).
const resourceServer = createResourceServer(facilitatorClients);

if (!hasEvm() && !hasTron()) {
  console.error("❌ No payout address configured (set EVM_ADDRESS and/or TRON_ADDRESS).");
  process.exit(1);
}

const accepts: Array<ReturnType<typeof evmAccepts>[number] | ReturnType<typeof tronAccepts>[number]> = [];
let extensions: Record<string, unknown> = {};
if (hasEvm()) {
  registerEvm(resourceServer);
  accepts.push(...evmAccepts());
  extensions = { ...extensions, ...evmExtensions() };
}
if (hasTron()) {
  registerTron(resourceServer);
  accepts.push(...tronAccepts());
}

const routes = {
  "GET /weather": {
    accepts,
    extensions,
    description: "Current weather (paid, multi-scheme)",
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
    `🌤️  Multi-scheme resource server on http://localhost:${PORT}  (evm=${hasEvm()}, tron=${hasTron()}) → exact ${EXACT_FACILITATOR_URL}, gasfree ${GASFREE_FACILITATOR_URL}${STRIP_RESOURCE_URL ? " [resource.url stripped]" : ""}${FACILITATOR_API_KEY ? " [api key]" : ""}`,
  );
});

/**
 * x402 resource server (Express) — chain-agnostic.
 *
 * Protects `GET /weather` behind payment. The resource server is keyless: it
 * advertises `accepts` for each enabled chain and delegates verify/settle to a
 * facilitator over HTTP. Per-chain setup lives in `src/chains/`.
 */
import express from "express";
import { HTTPFacilitatorClient } from "@bankofai/x402-core/server";
import {
  x402ResourceServer,
  x402HTTPResourceServer,
  paymentMiddlewareFromHTTPServer,
} from "@bankofai/x402-express";

import { hasEvm, registerEvm, evmAccepts, evmExtensions } from "./chains/evm.js";
import { hasTron, registerTron, tronAccepts } from "./chains/tron.js";
import { ResourceStrippingFacilitatorClient } from "./resourceStrippingFacilitator.js";
import { attachPaymentLogging } from "./loggingHooks.js";

const PORT = parseInt(process.env.SERVER_PORT || "4021", 10);
const FACILITATOR_URL = process.env.FACILITATOR_URL || "http://localhost:4022";
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
// Log every verify/settle result, including the invalidReason/errorReason the
// middleware otherwise swallows on a 402. See loggingHooks.ts.
attachPaymentLogging(resourceServer);

// Register each chain (and advertise its tokens) only when its payout is set.
// Each chain may advertise multiple tokens, so accepts is flattened. EVM prices
// are explicit asset objects; TRON prices are "<amount> <symbol>" strings.
type Accept = ReturnType<typeof evmAccepts>[number] | ReturnType<typeof tronAccepts>[number];
const accepts: Accept[] = [];
let extensions: Record<string, unknown> = {};
if (hasEvm()) {
  registerEvm(resourceServer);
  accepts.push(...evmAccepts());
  // USDC (permit2) needs the gas-sponsored Permit2 approve; advertise it.
  extensions = { ...extensions, ...evmExtensions() };
}
if (hasTron()) {
  registerTron(resourceServer);
  accepts.push(...tronAccepts());
}
if (accepts.length === 0) {
  console.error("❌ No payout address configured (set EVM_ADDRESS and/or TRON_ADDRESS).");
  process.exit(1);
}

const routes = {
  "GET /weather": {
    accepts,
    extensions,
    description: "Current weather (paid)",
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
    `🌤️  Resource server on http://localhost:${PORT}  (evm=${hasEvm()}, tron=${hasTron()}) → facilitator ${FACILITATOR_URL}${STRIP_RESOURCE_URL ? " [resource.url stripped]" : ""}${FACILITATOR_API_KEY ? " [api key]" : ""}`,
  );
});

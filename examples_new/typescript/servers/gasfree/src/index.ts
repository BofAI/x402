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

// Dedicated env vars (set in .env-gasfree) so the GasFree line keeps its own
// :4031/:4032, independent of the other scenarios.
const PORT = parseInt(process.env.SERVER_PORT || "4031", 10);
const FACILITATOR_URL = process.env.FACILITATOR_URL || "http://localhost:4032";

const facilitatorClient = new HTTPFacilitatorClient({ url: FACILITATOR_URL });
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
    `🌤️  GasFree resource server on http://localhost:${PORT} → facilitator ${FACILITATOR_URL}`,
  );
});

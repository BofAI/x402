/**
 * x402 GasFree resource server (Express, TRON-only).
 *
 * Protects `GET /weather` behind payment using the TRON `exact_gasfree` scheme.
 * The resource server is keyless: it advertises `accepts` and delegates
 * verify/settle to a facilitator over HTTP.
 */
import express, { type RequestHandler } from "express";
import { HTTPFacilitatorClient } from "@bankofai/x402-core/server";
import {
  x402ResourceServer,
  x402HTTPResourceServer,
  paymentMiddlewareFromHTTPServer,
} from "@bankofai/x402-express";

import { hasTron, registerTron, tronAccepts } from "./chains/tron.js";

// Dedicated env vars so the shared .env-local (which points the main-line apps
// at 4021/4022) never shadows the GasFree ports.
const PORT = parseInt(process.env.GASFREE_SERVER_PORT || "4031", 10);
const FACILITATOR_URL = process.env.GASFREE_FACILITATOR_URL || "http://localhost:4032";

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
// The middleware is async (returns a Promise); cast to express's RequestHandler,
// which some @types/express versions type as returning void only.
app.use(paymentMiddlewareFromHTTPServer(httpServer) as unknown as RequestHandler);

app.get("/weather", (_req, res) => {
  res.json({ report: { weather: "sunny", temperature: 70 } });
});

app.listen(PORT, () => {
  console.log(
    `🌤️  GasFree resource server on http://localhost:${PORT} → facilitator ${FACILITATOR_URL}`,
  );
});

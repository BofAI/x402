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

import { hasEvm, registerEvm, evmAccept } from "./chains/evm.js";
import { hasTron, registerTron, tronAccept } from "./chains/tron.js";

const PORT = parseInt(process.env.PORT || "4021", 10);
const FACILITATOR_URL = process.env.FACILITATOR_URL || "http://localhost:4022";

const facilitatorClient = new HTTPFacilitatorClient({ url: FACILITATOR_URL });
const resourceServer = new x402ResourceServer(facilitatorClient);

// Register each chain (and advertise it) only when its payout address is set.
const accepts: ReturnType<typeof evmAccept>[] = [];
if (hasEvm()) {
  registerEvm(resourceServer);
  accepts.push(evmAccept());
}
if (hasTron()) {
  registerTron(resourceServer);
  accepts.push(tronAccept());
}
if (accepts.length === 0) {
  console.error("❌ No payout address configured (set EVM_ADDRESS and/or TRON_ADDRESS).");
  process.exit(1);
}

const routes = {
  "GET /weather": {
    accepts,
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
    `🌤️  Resource server on http://localhost:${PORT}  (evm=${hasEvm()}, tron=${hasTron()}) → facilitator ${FACILITATOR_URL}`,
  );
});

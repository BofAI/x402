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

const PORT = parseInt(process.env.SERVER_PORT || "4041", 10);
const FACILITATOR_URL = process.env.FACILITATOR_URL || "http://localhost:4042";

const facilitatorClient = new HTTPFacilitatorClient({ url: FACILITATOR_URL });
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
    `🌤️  Batch-settlement server on http://localhost:${PORT}  (evm=${hasEvm()}, tron=${hasTron()}) → facilitator ${FACILITATOR_URL}`,
  );
});

// Flush pending claims/settles before exiting so vouchers aren't lost.
process.on("SIGINT", async () => {
  console.log("\nShutting down — flushing pending claims…");
  await Promise.allSettled(managers.map(m => m.stop({ flush: true })));
  server.close(() => process.exit(0));
});

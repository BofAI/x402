/**
 * x402 resource server (Express) — chain-agnostic.
 *
 * Protects example routes behind payment. The resource server is keyless: it
 * advertises `accepts` for each enabled chain and delegates verify/settle to a
 * facilitator over HTTP. Per-chain setup lives in `src/chains/`.
 */
import express, { type RequestHandler } from "express";
import { HTTPFacilitatorClient } from "@bankofai/x402-core/server";
import {
  x402ResourceServer,
  x402HTTPResourceServer,
  paymentMiddlewareFromHTTPServer,
  setSettlementOverrides,
} from "@bankofai/x402-express";

import { hasEvm, registerEvm, evmExactAccepts, evmUptoAccepts, evmExtensions } from "./chains/evm.js";
import {
  hasTron,
  registerTron,
  tronExactAccepts,
  tronUptoAccepts,
  tronBatchSettlementAccepts,
} from "./chains/tron.js";

const PORT = parseInt(process.env.PORT || "4021", 10);
const FACILITATOR_URL = process.env.FACILITATOR_URL || "http://localhost:4022";

const facilitatorClient = new HTTPFacilitatorClient({ url: FACILITATOR_URL });
const resourceServer = new x402ResourceServer(facilitatorClient);

type Accept = {
  scheme: string;
  network: `${string}:${string}`;
  payTo: string;
  price: string | { amount: string; asset: string; extra: Record<string, unknown> };
};

type RouteConfig = {
  accepts: Accept[];
  extensions?: Record<string, unknown>;
  description: string;
  mimeType: string;
};

type SettlementResponse = Parameters<typeof setSettlementOverrides>[0];

const exactAccepts: Accept[] = [];
const uptoAccepts: Accept[] = [];
const batchSettlementAccepts: Accept[] = [];
let extensions: Record<string, unknown> = {};
if (hasEvm()) {
  registerEvm(resourceServer);
  exactAccepts.push(...evmExactAccepts());
  uptoAccepts.push(...evmUptoAccepts());
  // USDC (permit2) needs the gas-sponsored Permit2 approve; advertise it.
  extensions = { ...extensions, ...evmExtensions() };
}
if (hasTron()) {
  registerTron(resourceServer);
  exactAccepts.push(...tronExactAccepts());
  uptoAccepts.push(...tronUptoAccepts());
  batchSettlementAccepts.push(...tronBatchSettlementAccepts());
}
if (exactAccepts.length + uptoAccepts.length + batchSettlementAccepts.length === 0) {
  console.error("❌ No payout address configured (set EVM_ADDRESS and/or TRON_ADDRESS).");
  process.exit(1);
}

const routes: Record<string, RouteConfig> = {
  "GET /weather": {
    accepts: exactAccepts,
    extensions,
    description: "Current weather (paid)",
    mimeType: "application/json",
  },
  "GET /generate": {
    accepts: uptoAccepts,
    extensions,
    description: "Usage-based generation (paid up to a max)",
    mimeType: "application/json",
  },
};

if (batchSettlementAccepts.length > 0) {
  routes["GET /stream"] = {
    accepts: batchSettlementAccepts,
    description: "Small streamed payload paid through batch settlement",
    mimeType: "application/json",
  };
}

const httpServer = new x402HTTPResourceServer(resourceServer, routes);

const app = express();
// The middleware is async (returns a Promise); cast to express's RequestHandler,
// which some @types/express versions type as returning void only.
app.use(paymentMiddlewareFromHTTPServer(httpServer) as unknown as RequestHandler);

app.get("/weather", (_req, res) => {
  res.json({ report: { weather: "sunny", temperature: 70 } });
});

app.get("/generate", (_req, res) => {
  const tokensGenerated = 128;
  setSettlementOverrides(res as unknown as SettlementResponse, { amount: "50%" });
  res.json({
    model: "demo-generator",
    tokensGenerated,
    text: "Usage-based x402 response generated successfully.",
  });
});

app.get("/stream", (_req, res) => {
  setSettlementOverrides(res as unknown as SettlementResponse, { amount: "50%" });
  res.json({
    streamId: "demo-stream",
    chunks: ["batch", "settlement", "ready"],
  });
});

app.listen(PORT, () => {
  console.log(
    `Resource server on http://localhost:${PORT}  (evm=${hasEvm()}, tron=${hasTron()}) -> facilitator ${FACILITATOR_URL}`,
  );
});

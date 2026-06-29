/**
 * x402 MCP resource server — dual-chain (BSC testnet + TRON Nile).
 *
 * Exposes a paid MCP tool (`get_weather`) and a free one (`ping`) over SSE. The
 * resource server is keyless: it advertises `accepts` for every enabled chain and
 * delegates verify/settle to a facilitator over HTTP. A 402 challenge offers BOTH
 * chains at once; the client picks whichever it can pay. Per-chain setup lives in
 * `src/chains/`, each gated on its payout address — run EVM-only, TRON-only, or both.
 *
 * Pair with `facilitator/basic` (already dual-chain) and `clients/mcp`.
 */
import crypto from "node:crypto";
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { HTTPFacilitatorClient } from "@bankofai/x402-core/server";
import type { ResourceConfig } from "@bankofai/x402-core/server";
import type { PaymentRequirements } from "@bankofai/x402-core/types";
import { x402ResourceServer, createPaymentWrapper } from "@bankofai/x402-mcp";
import { z } from "zod";

import { hasEvm, registerEvm, evmAccepts } from "./chains/evm.js";
import { hasTron, registerTron, tronAccepts } from "./chains/tron.js";

const PORT = parseInt(process.env.MCP_SERVER_PORT || "4023", 10);
const FACILITATOR_URL = process.env.FACILITATOR_URL || "http://localhost:4022";
// Optional facilitator API key. When set, it's sent as `X-API-KEY` on every
// facilitator call (verify/settle/supported). Hosted facilitators use it to pick
// a rate-limit tier; anonymous calls still work, so it's unset by default.
const FACILITATOR_API_KEY = process.env.FACILITATOR_API_KEY;
const apiKeyHeaders: Record<string, string> = FACILITATOR_API_KEY ? { "X-API-KEY": FACILITATOR_API_KEY } : {};

/**
 * Fake weather data for the demo tool.
 *
 * @param city - City name to report on.
 * @returns A weather record.
 */
function getWeatherData(city: string): { city: string; weather: string; temperature: number } {
  const conditions = ["sunny", "cloudy", "rainy", "snowy", "windy"];
  const weather = conditions[Math.floor(Math.random() * conditions.length)]!;
  return { city, weather, temperature: Math.floor(Math.random() * 40) + 40 };
}

/**
 * Wire the resource server, register enabled chains, and build the dual-chain
 * `accepts` for the paid tool.
 *
 * @returns The MCP server with tools registered.
 */
async function buildServer(): Promise<McpServer> {
  const facilitatorClient = new HTTPFacilitatorClient({
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
  const resourceServer = new x402ResourceServer(facilitatorClient);

  // Register each chain (and collect its advertised resource configs) only when
  // its payout address is set.
  const configs: ResourceConfig[] = [];
  if (hasEvm()) {
    registerEvm(resourceServer);
    configs.push(...evmAccepts());
  }
  if (hasTron()) {
    registerTron(resourceServer);
    configs.push(...tronAccepts());
  }
  if (configs.length === 0) {
    console.error("❌ No payout address configured (set EVM_ADDRESS and/or TRON_ADDRESS).");
    process.exit(1);
  }
  await resourceServer.initialize();

  // Expand each resource config into PaymentRequirements and flatten — the paid
  // tool's 402 then offers every enabled chain/token at once.
  const accepts: PaymentRequirements[] = (
    await Promise.all(configs.map(c => resourceServer.buildPaymentRequirements(c)))
  ).flat();

  const paidWeather = createPaymentWrapper(resourceServer, { accepts });

  const mcpServer = new McpServer({ name: "x402 Weather Service (dual-chain)", version: "1.0.0" });

  mcpServer.tool(
    "get_weather",
    "Get current weather for a city. Requires payment (~$0.001 on BSC testnet or TRON Nile).",
    { city: z.string().describe("The city name to get weather for") },
    paidWeather(async (args: { city: string }) => ({
      content: [{ type: "text" as const, text: JSON.stringify(getWeatherData(args.city), null, 2) }],
    })),
  );

  mcpServer.tool("ping", "A free health check tool", {}, async () => ({
    content: [{ type: "text" as const, text: "pong" }],
  }));

  return mcpServer;
}

const mcpServer = await buildServer();

const app = express();
const transports = new Map<string, SSEServerTransport>();

app.get("/sse", async (_req, res) => {
  const transport = new SSEServerTransport("/messages", res);
  const sessionId = crypto.randomUUID();
  transports.set(sessionId, transport);
  res.on("close", () => transports.delete(sessionId));
  await mcpServer.connect(transport);
});

app.post("/messages", express.json(), async (req, res) => {
  const transport = Array.from(transports.values())[0];
  if (!transport) {
    res.status(400).json({ error: "No active SSE connection" });
    return;
  }
  await transport.handlePostMessage(req, res, req.body);
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok", evm: hasEvm(), tron: hasTron() });
});

app.listen(PORT, () => {
  console.log(
    `🚀 x402 MCP server on http://localhost:${PORT}/sse  (evm=${hasEvm()}, tron=${hasTron()}) → facilitator ${FACILITATOR_URL}${FACILITATOR_API_KEY ? " [api key]" : ""}`,
  );
});

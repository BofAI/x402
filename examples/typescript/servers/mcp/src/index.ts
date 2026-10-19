/**
 * TRON mcp server example using official x402 integrations.
 * TRON registration lives in src/chains/tron.ts; wallet keys remain in agent-wallet.
 */
import crypto from "node:crypto";
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { HTTPFacilitatorClient } from "@x402/core/server";
import type { ResourceConfig } from "@x402/core/server";
import type { PaymentRequirements } from "@x402/core/types";
import { x402ResourceServer } from "@x402/core/server";
import { createPaymentWrapper } from "@x402/mcp";
import { z } from "zod";

import { hasTron, registerTron, tronAccepts } from "./chains/tron.js";

const PORT = parseInt(process.env.MCP_SERVER_PORT || "4023", 10);
const FACILITATOR_URL = process.env.FACILITATOR_URL || "http://localhost:4022";
// Optional facilitator API key. When set, it's sent as `X-API-KEY` on every
// facilitator call (verify/settle/supported). Hosted facilitators use it to pick
// a rate-limit tier; anonymous calls still work, so it's unset by default.
const FACILITATOR_API_KEY = process.env.FACILITATOR_API_KEY;
const apiKeyHeaders: Record<string, string> = FACILITATOR_API_KEY
  ? { "X-API-KEY": FACILITATOR_API_KEY }
  : {};

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
 * Wire the resource server, register enabled chains, and build the TRON
 * `accepts` for the paid tool.
 *
 * @returns The MCP server with tools registered.
 */
async function buildServer(): Promise<McpServer> {
  const facilitatorClient = new HTTPFacilitatorClient({
    timeoutMs: 120_000,
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
  // Add lifecycle hooks here if the application needs verify/settle logging.
  const resourceServer = new x402ResourceServer(facilitatorClient);

  // Register each chain (and collect its advertised resource configs) only when
  // its payout address is set.
  const configs: ResourceConfig[] = [];
  if (hasTron()) {
    registerTron(resourceServer);
    configs.push(...tronAccepts());
  }
  if (configs.length === 0) {
    console.error("❌ No payout address configured (set TRON_ADDRESS).");
    process.exit(1);
  }
  await resourceServer.initialize();

  // Expand each resource config into PaymentRequirements and flatten — the paid
  // tool's 402 then offers every enabled chain/token at once.
  const accepts: PaymentRequirements[] = (
    await Promise.all(configs.map(c => resourceServer.buildPaymentRequirements(c)))
  ).flat();

  const paidWeather = createPaymentWrapper(resourceServer, { accepts });

  const mcpServer = new McpServer({ name: "TRON x402 Weather Service", version: "1.0.0" });

  mcpServer.tool(
    "get_weather",
    "Get current weather for a city. Requires payment (~$0.001 on TRON Nile).",
    { city: z.string().describe("The city name to get weather for") },
    paidWeather(async (args: { city: string }) => ({
      content: [
        { type: "text" as const, text: JSON.stringify(getWeatherData(args.city), null, 2) },
      ],
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
  res.json({ status: "ok", tron: hasTron() });
});

app.listen(PORT, () => {
  console.log(
    `🚀 x402 MCP server on http://localhost:${PORT}/sse  (tron=${hasTron()}) → facilitator ${FACILITATOR_URL}${FACILITATOR_API_KEY ? " [api key]" : ""}`,
  );
});

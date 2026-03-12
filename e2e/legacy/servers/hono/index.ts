import { config } from "dotenv";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { paymentMiddleware, Network, Resource, FacilitatorConfig } from "@bankofai/x402-hono-legacy";

config();

const payTo = process.env.EVM_PAYEE_ADDRESS as `0x${string}`;
const network = process.env.EVM_NETWORK as Network;
const port = parseInt(process.env.PORT || '4021');
const facilitatorUrl = process.env.FACILITATOR_URL;

if (!payTo || !network) {
  console.error("Missing required environment variables");
  process.exit(1);
}

// Create facilitator config if URL is provided
const facilitatorConfig: FacilitatorConfig | undefined = facilitatorUrl
  ? { url: facilitatorUrl as Resource }
  : undefined;

if (facilitatorUrl) {
  console.log(`Using remote facilitator at: ${facilitatorUrl}`);
} else {
  console.log(`Using default facilitator`);
}

const app = new Hono();

// Apply payment middleware to protected endpoint
app.use(
  "*",
  paymentMiddleware(
    payTo,
    {
      "/protected": {
        price: {
          amount: "1000",
          asset: {
            address: "0x375cADdd2cB68cE82e3D9B075D551067a7b4B816",
            decimals: 6,
            eip712: {
              name: "DA HULU",
              version: "1",
            },
          },
        },
        network,
      },
    },
    facilitatorConfig,
  ),
);

// Protected endpoint requiring payment
app.get("/protected", c => {
  return c.json({
    message: "Protected endpoint accessed successfully",
    timestamp: new Date().toISOString()
  });
});

// Health check endpoint
app.get("/health", c => {
  return c.json({
    status: "healthy"
  });
});

// Graceful shutdown endpoint
app.post("/close", c => {
  console.log("Received shutdown request");
  setTimeout(() => {
    process.exit(0);
  }, 1000);

  return c.json({
    message: "Shutting down gracefully"
  });
});

serve({
  fetch: app.fetch,
  port,
});

console.log("Server listening on port", port);

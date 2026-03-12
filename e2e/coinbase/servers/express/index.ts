import express from "express";
import { paymentMiddleware } from "@x402/express";
import { x402ResourceServer, HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import {
  bazaarResourceServerExtension,
  declareDiscoveryExtension,
} from "@x402/extensions/bazaar";
import {
  declareEip2612GasSponsoringExtension,
  declareErc20ApprovalGasSponsoringExtension,
} from "@x402/extensions";
import dotenv from "dotenv";

dotenv.config();

/**
 * Express E2E Test Server with x402 Payment Middleware (Coinbase SDK version)
 *
 * This server demonstrates how to integrate x402 payment middleware
 * with an Express application for end-to-end testing using official SDK.
 */

const PORT = process.env.PORT || "4021";
const EVM_NETWORK = (process.env.EVM_NETWORK || "eip155:97") as `${string}:${string}`;
const EVM_PAYEE_ADDRESS = process.env.EVM_PAYEE_ADDRESS as `0x${string}`;
const facilitatorUrl = process.env.FACILITATOR_URL;

if (!EVM_PAYEE_ADDRESS) {
  console.error("❌ EVM_PAYEE_ADDRESS environment variable is required");
  process.exit(1);
}

if (!facilitatorUrl) {
  console.error("❌ FACILITATOR_URL environment variable is required");
  process.exit(1);
}

// Initialize Express app
const app = express();

// Create HTTP facilitator client
const facilitatorClient = new HTTPFacilitatorClient({ url: facilitatorUrl });

// Create x402 resource server
const server = new x402ResourceServer(facilitatorClient);

// Create ExactEvmScheme and register a MoneyParser for the DHLU token
// DHLU supports EIP-3009, EIP-2612, and standard ERC-20.
const evmScheme = new ExactEvmScheme().registerMoneyParser(async (amount, network) => {
  if (network === EVM_NETWORK) {
    // Map scalar price (e.g. $0.001) to 1000 DHLU (decimals: 6)
    return {
      amount: Math.floor(amount * 1_000_000).toString(),
      asset: "0x375cADdd2cB68cE82e3D9B075D551067a7b4B816",
      extra: { name: "DA HULU", version: "1", supportsEip2612: true }
    };
  }
  return null;
});

// Register server schemes
server.register("eip155:*", evmScheme);

// Register Bazaar discovery extension
server.registerExtension(bazaarResourceServerExtension);

console.log(
  `Facilitator account: ${process.env.EVM_PRIVATE_KEY ? process.env.EVM_PRIVATE_KEY.substring(0, 10) + "..." : "not configured"}`,
);
console.log(`Using remote facilitator at: ${facilitatorUrl}`);

/**
 * Configure x402 payment middleware using builder pattern
 */
app.use(
  paymentMiddleware(
    {
      // Route-specific payment configuration
      "GET /protected": {
        accepts: {
          payTo: EVM_PAYEE_ADDRESS,
          scheme: "exact",
          network: EVM_NETWORK,
          assets: ["DHLU"],
          price: "$0.001",
        },
        extensions: {
          ...declareDiscoveryExtension({
            output: {
              example: {
                message: "Protected endpoint accessed successfully",
                timestamp: "2024-01-01T00:00:00Z",
              },
              schema: {
                properties: {
                  message: { type: "string" },
                  timestamp: { type: "string" },
                },
                required: ["message", "timestamp"],
              },
            },
          }),
        },
      },
      // Permit2 endpoint for generic ERC-20 tokens (no EIP-2612, uses raw approve tx)
      "GET /protected-permit2-erc20": {
        accepts: {
          payTo: EVM_PAYEE_ADDRESS,
          scheme: "exact",
          network: EVM_NETWORK,
          assets: ["DHLU"],
          price: {
            amount: "1000",
            asset: "0x375cADdd2cB68cE82e3D9B075D551067a7b4B816", // DHLU (ERC-20 approval path, no name/version)
            extra: {
              assetTransferMethod: "permit2",
            },
          },
        },
        extensions: {
          ...declareErc20ApprovalGasSponsoringExtension(),
        },
      },
      // Permit2 endpoint - explicitly requires Permit2 flow instead of EIP-3009
      "GET /protected-permit2": {
        accepts: {
          payTo: EVM_PAYEE_ADDRESS,
          scheme: "exact",
          network: EVM_NETWORK,
          assets: ["DHLU"],
          price: {
            amount: "1000",
            asset: "0x375cADdd2cB68cE82e3D9B075D551067a7b4B816", // DHLU (permit2 + EIP-2612 path)
            extra: {
              name: "DA HULU",
              version: "1",
              assetTransferMethod: "permit2",
            },
          },
        },
        extensions: {
          ...declareDiscoveryExtension({
            output: {
              example: {
                message: "Permit2 endpoint accessed successfully",
                timestamp: "2024-01-01T00:00:00Z",
                method: "permit2",
              },
              schema: {
                properties: {
                  message: { type: "string" },
                  timestamp: { type: "string" },
                  method: { type: "string" },
                },
                required: ["message", "timestamp", "method"],
              },
            },
          }),
          ...declareEip2612GasSponsoringExtension(),
        },
      },
    },
    server, // Pass pre-configured server instance
  ),
);

/**
 * Protected endpoint - requires payment to access
 */
app.get("/protected", (req, res) => {
  res.json({
    message: "Protected endpoint accessed successfully",
    timestamp: new Date().toISOString(),
  });
});

/**
 * Protected Permit2 ERC-20 endpoint - requires payment via Permit2 flow with ERC-20 approval
 */
app.get("/protected-permit2-erc20", (req, res) => {
  res.json({
    message: "Permit2 ERC-20 approval endpoint accessed successfully",
    timestamp: new Date().toISOString(),
    method: "permit2-erc20-approval",
  });
});

/**
 * Protected Permit2 endpoint - requires payment via Permit2 flow
 */
app.get("/protected-permit2", (req, res) => {
  res.json({
    message: "Permit2 endpoint accessed successfully",
    timestamp: new Date().toISOString(),
    method: "permit2",
  });
});

/**
 * Health check endpoint - no payment required
 */
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    network: EVM_NETWORK,
    payee: EVM_PAYEE_ADDRESS,
    version: "2.0.0",
  });
});

/**
 * Shutdown endpoint - used by e2e tests
 */
app.post("/close", (req, res) => {
  res.json({ message: "Server shutting down gracefully" });
  console.log("Received shutdown request");

  setTimeout(() => {
    process.exit(0);
  }, 100);
});

// Start the server
app.listen(parseInt(PORT), () => {
  console.log(`
╔════════════════════════════════════════════════════════╗
║    x402 Express E2E Test Server (Coinbase SDK)         ║
╠════════════════════════════════════════════════════════╣
║  Server:       http://localhost:${PORT}                ║
║  EVM Network:  ${EVM_NETWORK}                          ║
║  EVM Payee:    ${EVM_PAYEE_ADDRESS}                    ║
║                                                        ║
║  Endpoints:                                            ║
║  • GET  /protected             (EIP-3009 payment - EVM)    ║
║  • GET  /protected-permit2     (Permit2 payment - EVM)     ║
║  • GET  /protected-permit2-erc20 (Permit2 + ERC-20 approval) ║
║  • GET  /health                (no payment required)       ║
║  • POST /close                 (shutdown server)           ║
╚════════════════════════════════════════════════════════╝
  `);
});

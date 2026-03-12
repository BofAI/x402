/**
 * TypeScript Facilitator for E2E Testing (Coinbase SDK version)
 *
 * This facilitator provides HTTP endpoints for payment verification and settlement
 * using the official x402 TypeScript SDK.
 */

import { x402Facilitator } from "@x402/core/facilitator";
import {
  Network,
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  VerifyResponse,
} from "@x402/core/types";
import { toFacilitatorEvmSigner } from "@x402/evm";
import { ExactEvmScheme } from "@x402/evm/exact/facilitator";
import { BAZAAR, extractDiscoveryInfo } from "@x402/extensions/bazaar";
import {
  EIP2612_GAS_SPONSORING,
  createErc20ApprovalGasSponsoringExtension,
} from "@x402/extensions";
import crypto from "crypto";
import dotenv from "dotenv";
import express from "express";
import { createWalletClient, http, publicActions, Chain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bscTestnet, base } from "viem/chains";
import { BazaarCatalog } from "./bazaar.js";

dotenv.config();

// Configuration
const PORT = process.env.PORT || "4022";
const EVM_NETWORK = (process.env.EVM_NETWORK || "eip155:97") as Network;
const EVM_RPC_URL = process.env.EVM_RPC_URL;

// Map CAIP-2 network IDs to viem chains
function getEvmChain(network: string): Chain {
  switch (network) {
    case "eip155:8453":
      return base;
    case "eip155:97":
    default:
      return bscTestnet;
  }
}

console.log(`🌐 EVM Network: ${EVM_NETWORK}`);
if (EVM_RPC_URL) console.log(`🌐 EVM RPC URL: ${EVM_RPC_URL}`);

// Validate required environment variables
if (!process.env.EVM_PRIVATE_KEY) {
  console.error("❌ EVM_PRIVATE_KEY environment variable is required");
  process.exit(1);
}

// Initialize the EVM account from private key
const evmAccount = privateKeyToAccount(
  process.env.EVM_PRIVATE_KEY as `0x${string}`,
);
console.info(`EVM Facilitator account: ${evmAccount.address}`);

// Create a Viem client with both wallet and public capabilities
const evmChain = getEvmChain(EVM_NETWORK);
const viemClient = createWalletClient({
  account: evmAccount,
  chain: evmChain,
  transport: http(EVM_RPC_URL),
}).extend(publicActions);

// Initialize the x402 Facilitator with EVM support
const evmSigner = toFacilitatorEvmSigner({
  address: evmAccount.address,
  readContract: (args: {
    address: `0x${string}`;
    abi: readonly unknown[];
    functionName: string;
    args?: readonly unknown[];
  }) =>
    viemClient.readContract({
      ...args,
      args: args.args || [],
    }),
  verifyTypedData: (args: {
    address: `0x${string}`;
    domain: Record<string, unknown>;
    types: Record<string, unknown>;
    primaryType: string;
    message: Record<string, unknown>;
    signature: `0x${string}`;
  }) => viemClient.verifyTypedData(args as any),
  writeContract: (args: {
    address: `0x${string}`;
    abi: readonly unknown[];
    functionName: string;
    args: readonly unknown[];
  }) =>
    viemClient.writeContract({
      ...args,
      args: args.args || [],
    }),
  sendTransaction: (args: { to: `0x${string}`; data: `0x${string}` }) =>
    viemClient.sendTransaction(args),
  waitForTransactionReceipt: (args: { hash: `0x${string}` }) =>
    viemClient.waitForTransactionReceipt(args),
  getCode: (args: { address: `0x${string}` }) => viemClient.getCode(args),
});

const verifiedPayments = new Map<string, number>();
const bazaarCatalog = new BazaarCatalog();

function createPaymentHash(paymentPayload: PaymentPayload): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(paymentPayload))
    .digest("hex");
}

const facilitator = new x402Facilitator();

// Register EVM scheme (v2 only)
facilitator.register(EVM_NETWORK, new ExactEvmScheme(evmSigner));

facilitator
  .registerExtension(BAZAAR)
  .registerExtension(EIP2612_GAS_SPONSORING)
  .registerExtension(createErc20ApprovalGasSponsoringExtension(evmSigner, viemClient))
  // Lifecycle hooks for payment tracking and discovery
  .onAfterVerify(async (context) => {
    // Hook 1: Track verified payment for verify→settle flow validation
    if (context.result.isValid) {
      const paymentHash = createPaymentHash(context.paymentPayload);
      verifiedPayments.set(paymentHash, Date.now());

      // Hook 2: Extract and catalog bazaar discovery info
      const discovered = extractDiscoveryInfo(
        context.paymentPayload,
        context.requirements,
      );
      if (discovered && "method" in discovered && discovered.method) {
        bazaarCatalog.catalogResource(
          discovered.resourceUrl,
          discovered.method,
          discovered.x402Version,
          discovered.discoveryInfo,
          context.requirements,
        );
        console.log(
          `📦 Discovered resource: ${discovered.method} ${discovered.resourceUrl}`,
        );
      }
    }
  })
  .onBeforeSettle(async (context) => {
    // Hook 3: Validate payment was previously verified
    const paymentHash = createPaymentHash(context.paymentPayload);
    const verificationTimestamp = verifiedPayments.get(paymentHash);

    if (!verificationTimestamp) {
      return {
        abort: true,
        reason: "Payment must be verified before settlement",
      };
    }

    // Check verification isn't too old (5 minute timeout)
    const age = Date.now() - verificationTimestamp;
    if (age > 5 * 60 * 1000) {
      verifiedPayments.delete(paymentHash);
      return {
        abort: true,
        reason: "Payment verification expired (must settle within 5 minutes)",
      };
    }
  })
  .onAfterSettle(async (context) => {
    // Hook 4: Clean up verified payment tracking after settlement
    const paymentHash = createPaymentHash(context.paymentPayload);
    verifiedPayments.delete(paymentHash);

    if (context.result.success) {
      console.log(`✅ Settlement completed: ${context.result.transaction}`);
    }
  })
  .onSettleFailure(async (context) => {
    // Hook 5: Clean up on settlement failure too
    const paymentHash = createPaymentHash(context.paymentPayload);
    verifiedPayments.delete(paymentHash);

    console.error(`❌ Settlement failed: ${context.error.message}`);
  });

// Initialize Express app
const app = express();
app.use(express.json());

/**
 * POST /verify
 * Verify a payment against requirements
 */
app.post("/verify", async (req, res) => {
  try {
    const { paymentPayload, paymentRequirements } = req.body as {
      paymentPayload: PaymentPayload;
      paymentRequirements: PaymentRequirements;
    };

    if (!paymentPayload || !paymentRequirements) {
      return res.status(400).json({
        error: "Missing paymentPayload or paymentRequirements",
      });
    }

    const response: VerifyResponse = await facilitator.verify(
      paymentPayload,
      paymentRequirements,
    );

    res.json(response);
  } catch (error) {
    console.error("Verify error:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * POST /settle
 * Settle a payment on-chain
 */
app.post("/settle", async (req, res) => {
  try {
    const { paymentPayload, paymentRequirements } = req.body;

    if (!paymentPayload || !paymentRequirements) {
      return res.status(400).json({
        error: "Missing paymentPayload or paymentRequirements",
      });
    }

    const response: SettleResponse = await facilitator.settle(
      paymentPayload as PaymentPayload,
      paymentRequirements as PaymentRequirements,
    );

    res.json(response);
  } catch (error) {
    console.error("Settle error:", error);

    // Check if this was an abort from hook
    if (
      error instanceof Error &&
      error.message.includes("Settlement aborted:")
    ) {
      return res.json({
        success: false,
        errorReason: error.message.replace("Settlement aborted: ", ""),
        network: req.body?.paymentPayload?.network || "unknown",
      } as SettleResponse);
    }

    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * GET /supported
 * Get supported payment kinds and extensions
 */
app.get("/supported", async (req, res) => {
  try {
    const response = facilitator.getSupported();
    res.json(response);
  } catch (error) {
    console.error("Supported error:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.get("/discovery/resources", (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 100;
    const offset = parseInt(req.query.offset as string) || 0;

    const response = bazaarCatalog.getResources(limit, offset);
    res.json(response);
  } catch (error) {
    console.error("Discovery resources error:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * GET /health
 * Health check endpoint
 */
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    evmNetwork: EVM_NETWORK,
    facilitator: "typescript",
    version: "2.0.0",
    extensions: [BAZAAR.key],
    discoveredResources: bazaarCatalog.getCount(),
  });
});

/**
 * POST /close
 * Graceful shutdown endpoint
 */
app.post("/close", (req, res) => {
  res.json({ message: "Facilitator shutting down gracefully" });
  console.log("Received shutdown request");

  setTimeout(() => {
    process.exit(0);
  }, 100);
});

// Start the server
app.listen(parseInt(PORT), () => {
  console.log(`
╔════════════════════════════════════════════════════════╗
║    x402 TypeScript Facilitator (Coinbase SDK)          ║
╠════════════════════════════════════════════════════════╣
║  Server:       http://localhost:${PORT}                ║
║  EVM Network:  ${EVM_NETWORK}                          ║
║  EVM Address:  ${evmAccount.address}                   ║
║  Extensions:   bazaar                                  ║
║                                                        ║
║  Endpoints:                                            ║
║  • POST /verify              (verify payment)          ║
║  • POST /settle              (settle payment)          ║
║  • GET  /supported           (get supported kinds)     ║
║  • GET  /discovery/resources (list discovered)         ║
║  • GET  /health              (health check)            ║
║  • POST /close               (shutdown server)         ║
╚════════════════════════════════════════════════════════╝
  `);

  console.log("Facilitator listening");
});

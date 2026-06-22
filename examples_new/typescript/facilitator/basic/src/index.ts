/**
 * Basic x402 facilitator — chain-agnostic.
 *
 * Exposes /verify, /settle, /supported over HTTP and dispatches by the payment's
 * `network` field. EVM and TRON are registered from their own modules under
 * `chains/`, each gated on whether an agent-wallet is configured — so this file
 * never imports a chain SDK or touches a key.
 */
import express from "express";
import { x402Facilitator } from "@bankofai/x402-core/facilitator";
import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  VerifyResponse,
} from "@bankofai/x402-core/types";

import { registerEvm } from "./chains/evm.js";
import { registerTron } from "./chains/tron.js";

const PORT = parseInt(process.env.PORT || "4022", 10);

const facilitator = new x402Facilitator()
  .onBeforeSettle(async ctx => console.log("[settle] before", ctx.requirements.network))
  .onAfterSettle(async ctx =>
    console.log("[settle] after", ctx.requirements.network, {
      success: ctx.result.success,
      errorReason: ctx.result.success ? undefined : ctx.result.errorReason,
      transaction: ctx.result.transaction,
    }),
  )
  .onSettleFailure(async ctx => console.log("[settle] failure", ctx));

// Register each chain only if its wallet resolves. Run EVM-only, TRON-only, or both.
const evm = await registerEvm(facilitator);
const tron = await registerTron(facilitator);
if (!evm && !tron) {
  console.error("❌ No wallet configured for EVM or TRON (see agent-wallet setup).");
  process.exit(1);
}

const app = express();
app.use(express.json());

app.post("/verify", async (req, res) => {
  try {
    const { paymentPayload, paymentRequirements } = req.body as {
      paymentPayload: PaymentPayload;
      paymentRequirements: PaymentRequirements;
    };
    if (!paymentPayload || !paymentRequirements) {
      return res.status(400).json({ error: "Missing paymentPayload or paymentRequirements" });
    }
    const response: VerifyResponse = await facilitator.verify(paymentPayload, paymentRequirements);
    res.json(response);
  } catch (error) {
    console.error("[verify] error:", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.post("/settle", async (req, res) => {
  try {
    const { paymentPayload, paymentRequirements } = req.body as {
      paymentPayload: PaymentPayload;
      paymentRequirements: PaymentRequirements;
    };
    if (!paymentPayload || !paymentRequirements) {
      return res.status(400).json({ error: "Missing paymentPayload or paymentRequirements" });
    }
    const response: SettleResponse = await facilitator.settle(paymentPayload, paymentRequirements);
    res.json(response);
  } catch (error) {
    console.error("[settle] error:", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.get("/supported", (_req, res) => {
  try {
    res.json(facilitator.getSupported());
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Facilitator on http://localhost:${PORT}  (evm=${evm}, tron=${tron})`);
});

/**
 * TRON basic facilitator example using official x402 integrations.
 * TRON registration lives in src/chains/tron.ts; wallet keys remain in agent-wallet.
 */
import express from "express";
import { x402Facilitator } from "@x402/core/facilitator";
import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  VerifyResponse,
} from "@x402/core/types";

import { registerTron } from "./chains/tron.js";

const PORT = parseInt(process.env.FACILITATOR_PORT || "4022", 10);

const facilitator = new x402Facilitator()
  .onBeforeSettle(async ctx => console.log("[settle] before", ctx.requirements.network))
  .onAfterSettle(async ctx => console.log("[settle] after", ctx.requirements.network))
  .onSettleFailure(async ctx => console.log("[settle] failure", ctx));

// Register each chain only if its wallet resolves. Only TRON networks are registered.
const tron = await registerTron(facilitator);
if (!tron) {
  console.error("❌ No wallet configured for TRON (see agent-wallet setup).");
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
  console.log(`🚀 Facilitator on http://localhost:${PORT}  (tron=${tron})`);
});

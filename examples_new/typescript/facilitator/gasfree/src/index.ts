/**
 * x402 GasFree facilitator (TRON-only, scheme `exact_gasfree`).
 *
 * Exposes /verify, /settle, /supported over HTTP. It verifies the GasFree permit
 * (terms + TIP-712 signature) and settles by forwarding it to the GasFree relayer
 * API, which pays energy on-chain. TRON is registered from `chains`-style
 * `tron.ts`, gated on whether an agent-wallet is configured.
 */
import express from "express";
import { x402Facilitator } from "@bankofai/x402-core/facilitator";
import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  VerifyResponse,
} from "@bankofai/x402-core/types";

import { registerTronGasFree } from "./chains/tron.js";

// Dedicated env var so the shared .env-local never shadows the GasFree port.
const PORT = parseInt(process.env.GASFREE_FACILITATOR_PORT || "4032", 10);

const facilitator = new x402Facilitator()
  .onBeforeSettle(async ctx => console.log("[settle] before", ctx.requirements.network))
  .onAfterSettle(async ctx => console.log("[settle] after", ctx.requirements.network))
  .onSettleFailure(async ctx => console.log("[settle] failure", ctx));

const tron = await registerTronGasFree(facilitator);
if (!tron) {
  console.error("❌ No TRON wallet configured (see agent-wallet setup).");
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
  console.log(`🚀 GasFree facilitator on http://localhost:${PORT}  (tron=${tron})`);
});

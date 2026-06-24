/**
 * x402 GasFree facilitator (TRON-only, scheme `exact_gasfree`).
 *
 * Exposes /verify, /settle, /supported over HTTP. It verifies the GasFree permit
 * (terms + TIP-712 signature) and settles by forwarding it to the GasFree relayer
 * API, which pays energy on-chain. TRON is registered from `chains`-style
 * `tron.ts`, gated on whether an agent-wallet is configured.
 */
import express from "express";
import { createFacilitator } from "@bankofai/x402-core";
import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  VerifyResponse,
} from "@bankofai/x402-core/types";

import { registerTronGasFree } from "./chains/tron.js";

// Dedicated env var (set in .env-gasfree) so the GasFree line keeps its own :4032.
const PORT = parseInt(process.env.FACILITATOR_PORT || "4032", 10);

// createFacilitator() returns an x402Facilitator with structured verify/settle
// logging pre-attached (via the hook surface, routed through the SDK's injectable
// global logger). Use new x402Facilitator() instead for a log-free instance.
const facilitator = createFacilitator();

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

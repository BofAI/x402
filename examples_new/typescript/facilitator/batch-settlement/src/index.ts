/**
 * x402 batch-settlement facilitator — chain-agnostic, EVM + TRON.
 *
 * Exposes /verify, /settle, /supported over HTTP. For the `batch-settlement`
 * scheme it verifies channel deposits and vouchers, and on settle it submits the
 * on-chain `deposit` / `claimWithSignature` / `settle` / `refund` txs. Per-chain
 * setup lives in `src/chains/`; each registers only when its wallet resolves.
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

// Dedicated port so the batch line never clashes with the exact (4022) or
// gasfree (4032) facilitators when running side by side.
const PORT = parseInt(process.env.FACILITATOR_PORT || "4042", 10);

const facilitator = new x402Facilitator()
  .onBeforeSettle(async ctx => console.log("[settle] before", ctx.requirements.network))
  .onAfterSettle(async ctx => console.log("[settle] after", ctx.requirements.network))
  .onSettleFailure(async ctx => console.log("[settle] failure", ctx));

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
    console.log(
      `[verify] ${paymentRequirements.network} valid=${response.isValid}` +
        (response.isValid ? "" : ` reason=${response.invalidReason}`),
    );
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
  console.log(
    `🚀 Batch-settlement facilitator on http://localhost:${PORT}  (evm=${evm}, tron=${tron})`,
  );
});

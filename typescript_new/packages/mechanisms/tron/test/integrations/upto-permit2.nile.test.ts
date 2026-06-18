import { beforeAll, describe, expect, it } from "vitest";
import { UptoTronScheme as UptoServer } from "../../src/upto/server/scheme";
import { UptoTronScheme as UptoFacilitator } from "../../src/upto/facilitator/scheme";
import { UptoTronScheme as UptoClient } from "../../src/upto/client/scheme";
import {
  createClientTronSigner,
  createFacilitatorTronSigner,
  type ClientTronSigner,
} from "../../src/signer";
import {
  PERMIT2_ADDRESSES,
  erc20AllowanceAbi,
  transferWithAuthorizationABI,
} from "../../src/constants";
import type { PaymentPayload, PaymentRequirements } from "@bankofai/x402-core/types";
import {
  loadNileEnv,
  nileTronWeb,
  tronAgentWallet,
  toClientAgentWallet,
  toFacilitatorAgentWallet,
  toBigInt,
  NILE,
} from "./helpers";

/**
 * Real on-chain e2e for the `upto` (Permit2) scheme on TRON Nile.
 *
 * Like the exact e2e, but exercises the upto-specific behaviour: the client
 * signs an authorized *maximum* (0.1 USDT) and the facilitator settles for a
 * smaller *actual* amount (0.04 USDT) through the x402UptoPermit2Proxy. This
 * also proves the deployed proxy's 3-field (facilitator-bound) witness and its
 * `settle(permit, amount, owner, witness, signature)` signature match the SDK.
 *
 * Reuses the same one-time Permit2 allowance as the exact suite (the allowance
 * is granted to the Permit2 contract, not the proxy). Skips without credentials
 * or when the allowance has not been granted.
 */

const env = loadNileEnv();
const ABI_ALLOWANCE = erc20AllowanceAbi as unknown as readonly Record<string, unknown>[];
const ABI_ERC20 = transferWithAuthorizationABI as unknown as readonly Record<string, unknown>[];

// Authorized maximum vs the smaller amount actually settled.
const MAX_AMOUNT = "100000"; // 0.1 USDT (6 decimals)
const SETTLE_AMOUNT = "40000"; // 0.04 USDT

describe.skipIf(!env)("Nile e2e — upto (permit2) via agent-wallet", () => {
  const e = env!;
  let server: UptoServer;
  let facilitator: UptoFacilitator;
  let client: UptoClient;
  let clientSigner: ClientTronSigner;
  let req: PaymentRequirements;

  beforeAll(async () => {
    const payerTw = nileTronWeb(e.payerPk, e.apiKey);
    const facTw = nileTronWeb(e.facilitatorPk, e.apiKey);

    clientSigner = await createClientTronSigner(
      payerTw,
      toClientAgentWallet(tronAgentWallet(e.payerPk)),
    );
    const facWallet = await toFacilitatorAgentWallet(tronAgentWallet(e.facilitatorPk));
    const facSigner = createFacilitatorTronSigner(facTw, facWallet);

    server = new UptoServer();
    facilitator = new UptoFacilitator(facSigner);
    client = new UptoClient(clientSigner);

    const amount = await server.parsePrice("0.1 USDT", NILE);
    const supported = facilitator.getExtra(NILE) ?? {};
    const base = {
      scheme: "upto",
      network: NILE,
      asset: amount.asset,
      amount: amount.amount,
      payTo: e.payTo,
      maxTimeoutSeconds: 600,
      extra: amount.extra ?? {},
    } as unknown as PaymentRequirements;
    req = await server.enhancePaymentRequirements(
      base,
      { x402Version: 2, scheme: "upto", network: NILE, extra: supported },
      [],
    );
  });

  it("negotiates an upto requirement bound to the facilitator", () => {
    expect(req.extra?.assetTransferMethod).toBe("permit2");
    expect(req.amount).toBe(MAX_AMOUNT); // 0.1 USDT, 6 decimals
    expect(req.extra?.facilitatorAddress).toBeTruthy();
  });

  it("settles 0.04 of an authorized 0.1 USDT and credits payTo the actual amount", async ctx => {
    const permit2 = PERMIT2_ADDRESSES[NILE]!;
    const allowance = toBigInt(
      await clientSigner.readContract({
        address: req.asset,
        abi: ABI_ALLOWANCE,
        functionName: "allowance",
        args: [clientSigner.address, permit2],
      }),
    );
    if (allowance < BigInt(MAX_AMOUNT)) {
      // One-time Permit2 approval not granted — see README setup.
      ctx.skip();
      return;
    }

    const before = toBigInt(
      await clientSigner.readContract({
        address: req.asset,
        abi: ABI_ERC20,
        functionName: "balanceOf",
        args: [e.payTo],
      }),
    );

    // Client signs the authorized maximum (req.amount = MAX_AMOUNT).
    const result = await client.createPaymentPayload(2, req);
    const payload = {
      x402Version: 2,
      accepted: req,
      payload: result.payload,
      extensions: result.extensions,
    } as unknown as PaymentPayload;

    // Facilitator verifies against the maximum, then settles a smaller amount.
    const verify = await facilitator.verify(payload, req);
    expect(verify.isValid).toBe(true);

    const settleReq = { ...req, amount: SETTLE_AMOUNT } as PaymentRequirements;
    const settle = await facilitator.settle(payload, settleReq);
    expect(settle.success).toBe(true);
    expect(settle.transaction).toBeTruthy();
    expect(settle.amount).toBe(SETTLE_AMOUNT);

    const after = toBigInt(
      await clientSigner.readContract({
        address: req.asset,
        abi: ABI_ERC20,
        functionName: "balanceOf",
        args: [e.payTo],
      }),
    );

    console.log("[e2e upto]", {
      payer: clientSigner.address,
      payTo: e.payTo,
      selfTransfer: clientSigner.address === e.payTo,
      max: MAX_AMOUNT,
      settled: SETTLE_AMOUNT,
      tx: settle.transaction,
      before: before.toString(),
      after: after.toString(),
    });
    if (clientSigner.address === e.payTo) {
      // Self-transfer nets zero; the on-chain success above is the assertion.
      expect(after).toBe(before);
    } else {
      expect(after - before).toBe(BigInt(SETTLE_AMOUNT));
    }
  }, 180_000);
});

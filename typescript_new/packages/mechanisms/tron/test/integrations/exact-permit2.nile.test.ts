import { beforeAll, describe, expect, it } from "vitest";
import { ExactTronScheme as ExactServer } from "../../src/exact/server/scheme";
import { ExactTronScheme as ExactFacilitator } from "../../src/exact/facilitator/scheme";
import { ExactTronScheme as ExactClient } from "../../src/exact/client/scheme";
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
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
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
 * Real on-chain e2e for the `exact` (Permit2) scheme on TRON Nile.
 *
 * Signers are driven by `@bankofai/agent-wallet` (RAW_SECRET wallet from a key
 * in `.env`). Skips entirely without credentials, and skips the settle case if
 * the payer has not granted the one-time Permit2 allowance (see README).
 */

const env = loadNileEnv();
const ABI_ALLOWANCE = erc20AllowanceAbi as unknown as readonly Record<string, unknown>[];
const ABI_ERC20 = transferWithAuthorizationABI as unknown as readonly Record<string, unknown>[];

describe.skipIf(!env)("Nile e2e — exact (permit2) via agent-wallet", () => {
  const e = env!;
  let server: ExactServer;
  let facilitator: ExactFacilitator;
  let client: ExactClient;
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

    server = new ExactServer();
    facilitator = new ExactFacilitator(facSigner);
    client = new ExactClient(clientSigner);

    const amount = await server.parsePrice("0.1 USDT", NILE);
    const supported = facilitator.getExtra(NILE) ?? {};
    const base = {
      scheme: "exact",
      network: NILE,
      asset: amount.asset,
      amount: amount.amount,
      payTo: e.payTo,
      maxTimeoutSeconds: 600,
      extra: amount.extra ?? {},
    } as unknown as PaymentRequirements;
    req = await server.enhancePaymentRequirements(
      base,
      { x402Version: 2, scheme: "exact", network: NILE, extra: supported },
      [],
    );
  });

  it("negotiates a permit2 requirement", () => {
    expect(req.extra?.assetTransferMethod).toBe("permit2");
    expect(req.amount).toBe("100000"); // 0.1 USDT, 6 decimals
  });

  it("settles 0.1 USDT on Nile and credits payTo", async ctx => {
    const permit2 = PERMIT2_ADDRESSES[NILE]!;
    const allowance = toBigInt(
      await clientSigner.readContract({
        address: req.asset,
        abi: ABI_ALLOWANCE,
        functionName: "allowance",
        args: [clientSigner.address, permit2],
      }),
    );
    if (allowance < BigInt(req.amount)) {
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

    const result = await client.createPaymentPayload(2, req);
    const payload = {
      x402Version: 2,
      accepted: req,
      payload: result.payload,
      extensions: result.extensions,
    } as unknown as PaymentPayload;

    const verify = await facilitator.verify(payload, req);
    expect(verify.isValid).toBe(true);

    const settle = await facilitator.settle(payload, req);
    expect(settle.success).toBe(true);
    expect(settle.transaction).toBeTruthy();

    const after = toBigInt(
      await clientSigner.readContract({
        address: req.asset,
        abi: ABI_ERC20,
        functionName: "balanceOf",
        args: [e.payTo],
      }),
    );

    console.log("[e2e permit2]", {
      payer: clientSigner.address,
      payTo: e.payTo,
      selfTransfer: clientSigner.address === e.payTo,
      tx: settle.transaction,
      before: before.toString(),
      after: after.toString(),
    });
    if (clientSigner.address === e.payTo) {
      // Self-transfer nets zero; the on-chain success above is the assertion.
      expect(after).toBe(before);
    } else {
      expect(after - before).toBe(BigInt(req.amount));
    }
  }, 180_000);
});

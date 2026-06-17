import { beforeAll, describe, expect, it } from "vitest";
import { x402Client } from "@x402/core/client";
import type { PaymentPayload, PaymentRequired, PaymentRequirements } from "@x402/core/types";
import { ExactTronScheme as ExactServer } from "../../src/exact/server/scheme";
import { ExactTronScheme as ExactFacilitator } from "../../src/exact/facilitator/scheme";
import { ExactTronScheme as ExactClient } from "../../src/exact/client/scheme";
import { registerExactTronScheme } from "../../src/exact/client/register";
import { createCheapestTokenSelector } from "../../src/shared/tokenSelection";
import { selectAffordableRequirement } from "../../src/shared/balance";
import { getToken } from "../../src/shared/tokens";
import {
  createClientTronSigner,
  createFacilitatorTronSigner,
  type ClientTronSigner,
} from "../../src/signer";
import { PERMIT2_ADDRESSES, erc20AllowanceAbi, transferWithAuthorizationABI } from "../../src/constants";
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
 * Real-chain integration for client policy / token selection on Nile.
 *
 * Drives the real `x402Client.createPaymentPayload` pipeline (scheme filter →
 * policies → selector) over multi-token `accepts` (USDT 6dp + USDD 18dp), and
 * exercises balance-aware selection against real Nile balances. Signing uses
 * `@bankofai/agent-wallet`.
 */

const env = loadNileEnv();
const USDT = getToken(NILE, "USDT")!;
const USDD = getToken(NILE, "USDD")!;
const ABI_ALLOWANCE = erc20AllowanceAbi as unknown as readonly Record<string, unknown>[];
const ABI_ERC20 = transferWithAuthorizationABI as unknown as readonly Record<string, unknown>[];

describe.skipIf(!env)("Nile e2e — policy & token selection", () => {
  const e = env!;
  let server: ExactServer;
  let clientSigner: ClientTronSigner;
  let facilitator: ExactFacilitator;

  /** Build an `exact` requirement for a price like "0.2 USDT". */
  async function req(price: string): Promise<PaymentRequirements> {
    const a = await server.parsePrice(price, NILE);
    return {
      scheme: "exact",
      network: NILE,
      asset: a.asset,
      amount: a.amount,
      payTo: e.payTo,
      maxTimeoutSeconds: 600,
      extra: a.extra ?? {},
    } as unknown as PaymentRequirements;
  }

  function paymentRequired(accepts: PaymentRequirements[]): PaymentRequired {
    return {
      x402Version: 2,
      resource: { url: "https://example.com/resource" },
      accepts,
    } as PaymentRequired;
  }

  beforeAll(async () => {
    const payerTw = nileTronWeb(e.payerPk, e.apiKey);
    const facTw = nileTronWeb(e.facilitatorPk, e.apiKey);
    clientSigner = await createClientTronSigner(payerTw, toClientAgentWallet(tronAgentWallet(e.payerPk)));
    server = new ExactServer();
    facilitator = new ExactFacilitator(
      createFacilitatorTronSigner(facTw, await toFacilitatorAgentWallet(tronAgentWallet(e.facilitatorPk))),
    );
  });

  it("cheapest selector picks USDD when it is cheaper (normalized by decimals)", async () => {
    const client = new x402Client(createCheapestTokenSelector());
    registerExactTronScheme(client, { signer: clientSigner });
    // 0.2 USDT vs 0.1 USDD → USDD is cheaper.
    const payload = await client.createPaymentPayload(
      paymentRequired([await req("0.2 USDT"), await req("0.1 USDD")]),
    );
    expect(payload.accepted.asset).toBe(USDD.address);
  });

  it("cheapest selector picks USDT when it is cheaper", async () => {
    const client = new x402Client(createCheapestTokenSelector());
    registerExactTronScheme(client, { signer: clientSigner });
    // 0.05 USDT vs 0.1 USDD → USDT is cheaper.
    const payload = await client.createPaymentPayload(
      paymentRequired([await req("0.05 USDT"), await req("0.1 USDD")]),
    );
    expect(payload.accepted.asset).toBe(USDT.address);
  });

  it("policy runs before the selector (allow-list overrides cheapest)", async () => {
    const client = new x402Client(createCheapestTokenSelector());
    registerExactTronScheme(client, {
      signer: clientSigner,
      // Keep only USDT, even though USDD would be cheaper.
      policies: [(_v, reqs) => reqs.filter(r => r.asset === USDT.address)],
    });
    const payload = await client.createPaymentPayload(
      paymentRequired([await req("0.2 USDT"), await req("0.1 USDD")]),
    );
    expect(payload.accepted.asset).toBe(USDT.address);
  });

  it("multiple policies apply in order", async () => {
    const client = new x402Client(createCheapestTokenSelector());
    registerExactTronScheme(client, {
      signer: clientSigner,
      policies: [
        (_v, reqs) => reqs.filter(r => r.network.startsWith("tron:")), // keep tron
        (_v, reqs) => reqs.filter(r => r.asset === USDD.address), // then only USDD
      ],
    });
    const payload = await client.createPaymentPayload(
      paymentRequired([await req("0.05 USDT"), await req("0.1 USDD")]),
    );
    expect(payload.accepted.asset).toBe(USDD.address);
  });

  it("throws when policies filter out every option", async () => {
    const client = new x402Client(createCheapestTokenSelector());
    registerExactTronScheme(client, {
      signer: clientSigner,
      policies: [(_v, reqs) => reqs.filter(r => r.asset === "TNonExistentToken")],
    });
    await expect(
      client.createPaymentPayload(paymentRequired([await req("0.1 USDT")])),
    ).rejects.toThrow();
  });

  it("balance-aware selection excludes tokens the payer cannot afford (real balances)", async () => {
    const scheme = new ExactClient(clientSigner);
    const usdtReq = await req("0.1 USDT");
    const usddReq = await req("0.1 USDD");
    const chosen = await selectAffordableRequirement(scheme, [usdtReq, usddReq]);

    if (!chosen) {
      // Payer holds neither — nothing affordable.
      const usdt = toBigInt(
        await clientSigner.readContract({
          address: USDT.address,
          abi: ABI_ERC20,
          functionName: "balanceOf",
          args: [clientSigner.address],
        }),
      );
      expect(usdt).toBeLessThan(100000n);
      return;
    }
    // Whatever was chosen must actually be affordable on-chain.
    const balance = toBigInt(
      await clientSigner.readContract({
        address: chosen.asset,
        abi: ABI_ERC20,
        functionName: "balanceOf",
        args: [clientSigner.address],
      }),
    );
    expect(balance).toBeGreaterThanOrEqual(BigInt(chosen.amount));
  });

  it("settles the selector-chosen requirement end to end", async ctx => {
    const client = new x402Client(createCheapestTokenSelector());
    registerExactTronScheme(client, { signer: clientSigner });
    // Force USDT (payer is funded + approved for USDT).
    const payload = (await client.createPaymentPayload(
      paymentRequired([await req("0.1 USDT")]),
    )) as PaymentPayload;
    expect(payload.accepted.asset).toBe(USDT.address);

    const allowance = toBigInt(
      await clientSigner.readContract({
        address: USDT.address,
        abi: ABI_ALLOWANCE,
        functionName: "allowance",
        args: [clientSigner.address, PERMIT2_ADDRESSES[NILE]!],
      }),
    );
    if (allowance < 100000n) {
      ctx.skip();
      return;
    }

    const verify = await facilitator.verify(payload, payload.accepted);
    expect(verify.isValid).toBe(true);
    const settle = await facilitator.settle(payload, payload.accepted);
    expect(settle.success).toBe(true);
    expect(settle.transaction).toBeTruthy();
  }, 180_000);
});

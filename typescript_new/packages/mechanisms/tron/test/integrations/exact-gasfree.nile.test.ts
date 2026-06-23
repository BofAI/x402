import { beforeAll, describe, expect, it } from "vitest";
import { ExactGasFreeScheme as GasFreeServer } from "../../src/gasfree/server/scheme";
import { ExactGasFreeScheme as GasFreeFacilitator } from "../../src/gasfree/facilitator/scheme";
import { ExactGasFreeScheme as GasFreeClient } from "../../src/gasfree/client/scheme";
import {
  createClientTronSigner,
  createFacilitatorTronSigner,
  type ClientTronSigner,
} from "../../src/signer";
import { createGasFreeApiClients, type GasFreeAPIClient } from "../../src/shared/gasfree/api";
import { GASFREE_API_BASE_URLS } from "../../src/shared/gasfree/config";
import { transferWithAuthorizationABI } from "../../src/constants";
import type { PaymentPayload, PaymentRequirements } from "@bankofai/x402-core/types";
import {
  loadNileEnv,
  tronAgentWallet,
  toClientAgentWallet,
  toFacilitatorAgentWallet,
  toBigInt,
  NILE,
} from "./helpers";

/**
 * Real on-chain e2e for the `exact_gasfree` scheme on TRON Nile.
 *
 * Signers are driven by `@bankofai/agent-wallet`; settlement goes through the
 * live GasFree relayer (the payer needs no TRX). Skips without credentials, and
 * skips the settle case if the payer's GasFree account is not activated/funded.
 */

const env = loadNileEnv();
const ABI_ERC20 = transferWithAuthorizationABI as unknown as readonly Record<string, unknown>[];

describe.skipIf(!env)("Nile e2e — exact_gasfree via agent-wallet", () => {
  const e = env!;
  let server: GasFreeServer;
  let facilitator: GasFreeFacilitator;
  let client: GasFreeClient;
  let clientSigner: ClientTronSigner;
  let relayer: GasFreeAPIClient;
  let req: PaymentRequirements;

  beforeAll(async () => {
    const apiClients = createGasFreeApiClients({
      [NILE]: e.gasfreeApiUrl ?? GASFREE_API_BASE_URLS[NILE]!,
    });
    relayer = apiClients[NILE]!;

    clientSigner = await createClientTronSigner(toClientAgentWallet(tronAgentWallet(e.payerPk)), {
      network: NILE,
      apiKey: e.apiKey,
    });
    const facWallet = toFacilitatorAgentWallet(tronAgentWallet(e.facilitatorPk));
    const facSigner = await createFacilitatorTronSigner(facWallet, {
      network: NILE,
      apiKey: e.apiKey,
    });

    server = new GasFreeServer();
    facilitator = new GasFreeFacilitator(facSigner, apiClients);
    client = new GasFreeClient(clientSigner, { apiClients });

    const amount = await server.parsePrice("0.1 USDT", NILE);
    const supported = facilitator.getExtra(NILE) ?? {};
    const base = {
      scheme: "exact_gasfree",
      network: NILE,
      asset: amount.asset,
      amount: amount.amount,
      payTo: e.payTo,
      maxTimeoutSeconds: 600,
      extra: amount.extra ?? {},
    } as unknown as PaymentRequirements;
    req = await server.enhancePaymentRequirements(
      base,
      { x402Version: 2, scheme: "exact_gasfree", network: NILE, extra: supported },
      [],
    );
  });

  it("settles 0.1 USDT via the GasFree relayer (no payer TRX)", async ctx => {
    let info;
    try {
      info = await relayer.getAddressInfo(clientSigner.address);
    } catch {
      // GasFree relayer not reachable/configured — set GASFREE_API_URL. Skip.
      ctx.skip();
      return;
    }
    if (!info.active && !info.allowSubmit) {
      // GasFree account not activated — see README setup.
      ctx.skip();
      return;
    }
    const gasfreeBalance = toBigInt(
      await clientSigner.readContract({
        address: req.asset,
        abi: ABI_ERC20,
        functionName: "balanceOf",
        args: [info.gasFreeAddress],
      }),
    );
    if (gasfreeBalance < BigInt(req.amount)) {
      ctx.skip();
      return;
    }

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
  }, 180_000);
});

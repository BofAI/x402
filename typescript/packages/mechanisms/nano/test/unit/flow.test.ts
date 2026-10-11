import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { x402Client } from "@bankofai/x402-core/client";
import { x402Facilitator } from "@bankofai/x402-core/facilitator";
import type { PaymentRequired } from "@bankofai/x402-core/types";
import { ExactNanoScheme as NanoClient } from "../../src/exact/client";
import { ExactNanoScheme as NanoServer } from "../../src/exact/server";
import { ExactNanoScheme as NanoFacilitator } from "../../src/exact/facilitator";
import { NANO_MAINNET } from "../../src";
import { BLOCK_HASH, BLOCK_TIME, PAYER, PAY_TO, mockRpc, stateSendBlockInfo } from "./helpers";

describe("Nano exact flow through core", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date((BLOCK_TIME + 5) * 1000));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("prices, pays, verifies and settles once", async () => {
    const server = new NanoServer();
    const price = await server.parsePrice("0.03 XNO", NANO_MAINNET);
    const accepted = await server.enhancePaymentRequirements(
      {
        scheme: "exact",
        network: NANO_MAINNET,
        asset: price.asset,
        amount: price.amount,
        payTo: PAY_TO,
        maxTimeoutSeconds: 300,
        extra: price.extra ?? {},
      },
      { x402Version: 2, scheme: "exact", network: NANO_MAINNET },
      [],
    );
    const paymentRequired: PaymentRequired = {
      x402Version: 2,
      resource: { url: "https://example.test/resource" },
      accepts: [accepted],
    };

    const send = vi.fn(async () => BLOCK_HASH);
    // XNO is not a USD default asset, so the payer opts in with an atomic cap (1 XNO).
    const client = new x402Client()
      .register(NANO_MAINNET, new NanoClient({ address: PAYER, send }))
      .setSpendControls({
        allowedAssets: [
          { network: NANO_MAINNET, asset: "XNO", maxAmountPerPayment: (10n ** 30n).toString() },
        ],
      });
    const payload = await client.createPaymentPayload(paymentRequired);
    expect(payload.payload).toEqual({ blockHash: BLOCK_HASH });
    expect(send).toHaveBeenCalledWith({
      to: PAY_TO,
      amountRaw: 30n * 10n ** 27n,
      network: NANO_MAINNET,
    });

    const { rpc } = mockRpc(stateSendBlockInfo());
    const facilitator = new x402Facilitator().register(NANO_MAINNET, new NanoFacilitator({ rpc }));
    expect(facilitator.getSupported().kinds).toContainEqual(
      expect.objectContaining({ scheme: "exact", network: NANO_MAINNET }),
    );

    await expect(facilitator.verify(payload, accepted)).resolves.toMatchObject({
      isValid: true,
      payer: PAYER,
    });
    await expect(facilitator.settle(payload, accepted)).resolves.toMatchObject({
      success: true,
      transaction: BLOCK_HASH,
      network: NANO_MAINNET,
    });
    await expect(facilitator.settle(payload, accepted)).resolves.toMatchObject({
      success: false,
    });
  });

  it("lets the payer's spend cap refuse a price above it without sending", async () => {
    const send = vi.fn(async () => BLOCK_HASH);
    const client = new x402Client()
      .register(NANO_MAINNET, new NanoClient({ address: PAYER, send }))
      .setSpendControls({
        allowedAssets: [{ network: NANO_MAINNET, asset: "XNO", maxAmountPerPayment: "1" }],
      });
    await expect(
      client.createPaymentPayload({
        x402Version: 2,
        resource: { url: "https://example.test/resource" },
        accepts: [
          {
            scheme: "exact",
            network: NANO_MAINNET,
            asset: "XNO",
            amount: "2",
            payTo: PAY_TO,
            maxTimeoutSeconds: 300,
            extra: {},
          },
        ],
      }),
    ).rejects.toThrow(/maxAmountPerPayment/);
    expect(send).not.toHaveBeenCalled();
  });
});

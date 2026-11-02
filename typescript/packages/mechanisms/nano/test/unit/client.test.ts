import { describe, expect, it, vi } from "vitest";
import { ExactNanoScheme } from "../../src/exact/client";
import type { ClientNanoWallet } from "../../src";
import { nanoOrderCommitment } from "../../src";
import { AMOUNT, BLOCK_HASH, PAYER, PAY_TO, SECRET, requirements } from "./helpers";

/**
 * Wallet stub that records sends and returns a fixed hash.
 *
 * @param hash - Hash to return.
 * @returns The wallet and its send spy.
 */
function wallet(hash: string = BLOCK_HASH.toLowerCase()) {
  const send = vi.fn(async () => hash);
  const stub: ClientNanoWallet = { address: PAYER, send };
  return { stub, send };
}

describe("ExactNanoScheme client", () => {
  it("publishes a send for the exact raw amount and returns its hash", async () => {
    const { stub, send } = wallet();
    const result = await new ExactNanoScheme(stub, {
      randomBytes: () => new Uint8Array(32).fill(0xab),
    }).createPaymentPayload(2, requirements());

    // The block commits to the payer's secret, payTo and the amount.
    expect(send).toHaveBeenCalledWith({
      to: PAY_TO,
      amountRaw: BigInt(AMOUNT),
      network: "nano:mainnet",
      representative: nanoOrderCommitment(SECRET, PAY_TO, AMOUNT),
    });
    expect(result).toEqual({ x402Version: 2, payload: { blockHash: BLOCK_HASH, secret: SECRET } });
  });

  it("draws a fresh secret for every payment", async () => {
    const { stub, send } = wallet();
    const scheme = new ExactNanoScheme(stub);
    const first = await scheme.createPaymentPayload(2, requirements());
    const second = await scheme.createPaymentPayload(2, requirements());
    const secrets = [first, second].map(r => (r.payload as { secret: string }).secret);
    expect(secrets[0]).toMatch(/^[0-9a-f]{64}$/);
    expect(secrets[0]).not.toBe(secrets[1]);
    const representatives = send.mock.calls.map(
      ([params]) => (params as { representative: string }).representative,
    );
    expect(representatives[0]).not.toBe(representatives[1]);
  });

  it.each([
    ["another scheme", requirements({ scheme: "upto" }), /scheme/],
    ["another network", requirements({ network: "nano:beta" }), /network/],
    ["another asset", requirements({ asset: "USDT" }), /asset/],
    ["a bad payTo", requirements({ payTo: PAY_TO.slice(0, -1) + "y" }), /payTo/],
    ["a decimal amount", requirements({ amount: "0.03" }), /raw amount/],
    ["a zero amount", requirements({ amount: "0" }), /greater than zero/],
  ])("refuses %s without sending", async (_, reqs, message) => {
    const { stub, send } = wallet();
    await expect(new ExactNanoScheme(stub).createPaymentPayload(2, reqs)).rejects.toThrow(message);
    expect(send).not.toHaveBeenCalled();
  });

  it("refuses a wallet result that is not a block hash", async () => {
    const { stub } = wallet("not-a-hash");
    await expect(new ExactNanoScheme(stub).createPaymentPayload(2, requirements())).rejects.toThrow(
      /block hash/,
    );
  });
});

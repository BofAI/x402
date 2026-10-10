import { describe, expect, it, vi } from "vitest";
import { ExactNanoScheme } from "../../src/exact/client";
import type { ClientNanoWallet } from "../../src";
import { AMOUNT, BLOCK_HASH, PAYER, PAY_TO, requirements } from "./helpers";

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
    const result = await new ExactNanoScheme(stub).createPaymentPayload(2, requirements());

    expect(send).toHaveBeenCalledWith({
      to: PAY_TO,
      amountRaw: BigInt(AMOUNT),
      network: "nano:mainnet",
    });
    expect(result).toEqual({ x402Version: 2, payload: { blockHash: BLOCK_HASH } });
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

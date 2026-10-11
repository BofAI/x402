import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExactNanoScheme, ExactNanoErrors } from "../../src/exact/facilitator";
import {
  AMOUNT,
  BLOCK_HASH,
  BLOCK_TIME,
  PAYER,
  PAY_TO,
  mockRpc,
  paymentPayload,
  requirements,
  stateSendBlockInfo,
} from "./helpers";

describe("ExactNanoScheme facilitator", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date((BLOCK_TIME + 10) * 1000));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("verifies a confirmed send block with one block_info call", async () => {
    const { rpc, fetchMock } = mockRpc(stateSendBlockInfo());
    const scheme = new ExactNanoScheme({ rpc });

    const result = await scheme.verify(paymentPayload(), requirements());

    expect(result).toEqual({ isValid: true, payer: PAYER });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:7076");
    expect(JSON.parse(init?.body as string)).toEqual({
      action: "block_info",
      json_block: "true",
      hash: BLOCK_HASH,
    });
  });

  it("advertises the nano family with no signers or extra", () => {
    const scheme = new ExactNanoScheme({ rpc: mockRpc({}).rpc });
    expect(scheme.scheme).toBe("exact");
    expect(scheme.caipFamily).toBe("nano:*");
    expect(scheme.getSigners("nano:mainnet")).toEqual([]);
    expect(scheme.getExtra("nano:mainnet")).toBeUndefined();
  });

  it("accepts an overpayment and a lowercase hash", async () => {
    const { rpc, fetchMock } = mockRpc(stateSendBlockInfo({ amount: AMOUNT + "0" }));
    const scheme = new ExactNanoScheme({ rpc });
    const result = await scheme.verify(paymentPayload(BLOCK_HASH.toLowerCase()), requirements());
    expect(result.isValid).toBe(true);
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string).hash).toBe(BLOCK_HASH);
  });

  it("accepts a legacy send block by its destination", async () => {
    const { rpc } = mockRpc({
      block_account: PAYER,
      amount: AMOUNT,
      balance: "5606157000000000000000000000000000000",
      height: "12",
      local_timestamp: String(BLOCK_TIME),
      confirmed: "true",
      contents: {
        type: "send",
        previous: "CE898C131AAEE25E05362F247760F8A3ACF34A9796A5AE0D9204E86B0637965E",
        destination: PAY_TO.replace("nano_", "xrb_"),
        balance: "000000046AA4B7E4A3B9C1F2E8A40000",
        work: "8a142e07a10996d5",
        signature:
          "82D41BC16F313E4B2243D14DFFA2FB04679C540C2095FEE7EAE0F2F26880AD56DD48D87A7CC5DD760C5B2D76EE2C205506AA557BF00B60D8DEE312EC7343A501",
      },
    });
    const result = await new ExactNanoScheme({ rpc }).verify(paymentPayload(), requirements());
    expect(result).toEqual({ isValid: true, payer: PAYER });
  });

  it.each([
    [
      "unconfirmed",
      stateSendBlockInfo({ confirmed: "false" }),
      ExactNanoErrors.BLOCK_NOT_CONFIRMED,
    ],
    [
      "a receive block",
      stateSendBlockInfo({ subtype: "receive" }),
      ExactNanoErrors.NOT_A_SEND_BLOCK,
    ],
    ["a change block", stateSendBlockInfo({ subtype: "change" }), ExactNanoErrors.NOT_A_SEND_BLOCK],
    [
      "a legacy open block",
      stateSendBlockInfo({ subtype: undefined }, { type: "open" }),
      ExactNanoErrors.NOT_A_SEND_BLOCK,
    ],
    [
      "short by one raw",
      stateSendBlockInfo({ amount: (BigInt(AMOUNT) - 1n).toString() }),
      ExactNanoErrors.AMOUNT_INSUFFICIENT,
    ],
    [
      "too old",
      stateSendBlockInfo({ local_timestamp: String(BLOCK_TIME - 291) }),
      ExactNanoErrors.BLOCK_EXPIRED,
    ],
    [
      "without a local timestamp",
      stateSendBlockInfo({ local_timestamp: "0" }),
      ExactNanoErrors.BLOCK_EXPIRED,
    ],
    [
      "far in the future",
      stateSendBlockInfo({ local_timestamp: String(BLOCK_TIME + 100) }),
      ExactNanoErrors.BLOCK_EXPIRED,
    ],
    ["malformed amount", stateSendBlockInfo({ amount: "3e28" }), ExactNanoErrors.INVALID_BLOCK],
  ])("rejects a block that is %s", async (_, body, reason) => {
    const { rpc } = mockRpc(body);
    const result = await new ExactNanoScheme({ rpc }).verify(paymentPayload(), requirements());
    expect(result).toMatchObject({ isValid: false, invalidReason: reason, payer: PAYER });
  });

  it("rejects a send to another account even when the payer is payTo", async () => {
    const other = "nano_1111111111111111111111111111111111111111111111111111hifc8npp";
    const { rpc } = mockRpc(
      stateSendBlockInfo(
        { block_account: PAY_TO },
        {
          account: PAY_TO,
          link: "0000000000000000000000000000000000000000000000000000000000000000",
          link_as_account: other,
        },
      ),
    );
    const result = await new ExactNanoScheme({ rpc }).verify(paymentPayload(), requirements());
    expect(result).toMatchObject({
      isValid: false,
      invalidReason: ExactNanoErrors.RECIPIENT_MISMATCH,
    });
  });

  it("rejects a block whose link and link_as_account disagree", async () => {
    const { rpc } = mockRpc(
      stateSendBlockInfo(
        {},
        { link_as_account: "nano_1111111111111111111111111111111111111111111111111111hifc8npp" },
      ),
    );
    const result = await new ExactNanoScheme({ rpc }).verify(paymentPayload(), requirements());
    expect(result).toMatchObject({ isValid: false, invalidReason: ExactNanoErrors.INVALID_BLOCK });
  });

  it("honours a configured maximum block age", async () => {
    vi.setSystemTime(new Date((BLOCK_TIME + 40) * 1000));
    const { rpc } = mockRpc(stateSendBlockInfo());
    const strict = new ExactNanoScheme({ rpc, maxBlockAgeSeconds: 30 });
    expect((await strict.verify(paymentPayload(), requirements())).invalidReason).toBe(
      ExactNanoErrors.BLOCK_EXPIRED,
    );
  });

  it("reports node errors as chain read failures", async () => {
    const { rpc } = mockRpc({ error: "Block not found" });
    const result = await new ExactNanoScheme({ rpc }).verify(paymentPayload(), requirements());
    expect(result).toMatchObject({
      isValid: false,
      invalidReason: ExactNanoErrors.CHAIN_READ_FAILED,
      invalidMessage: "Nano RPC error: Block not found",
    });
  });

  it("reports HTTP failures as chain read failures", async () => {
    const { rpc } = mockRpc({}, 503);
    const result = await new ExactNanoScheme({ rpc }).verify(paymentPayload(), requirements());
    expect(result.invalidReason).toBe(ExactNanoErrors.CHAIN_READ_FAILED);
  });

  it.each([
    ["a missing hash", paymentPayload(null), requirements(), ExactNanoErrors.INVALID_PAYLOAD],
    ["a short hash", paymentPayload("ABC"), requirements(), ExactNanoErrors.INVALID_PAYLOAD],
    [
      "another scheme",
      paymentPayload(),
      requirements({ scheme: "upto" }),
      ExactNanoErrors.INVALID_SCHEME,
    ],
    [
      "another network",
      paymentPayload(BLOCK_HASH, requirements({ network: "nano:beta" })),
      requirements(),
      ExactNanoErrors.NETWORK_MISMATCH,
    ],
    [
      "another asset",
      paymentPayload(),
      requirements({ asset: "USDT" }),
      ExactNanoErrors.INVALID_ASSET,
    ],
    [
      "a payTo with a bad checksum",
      paymentPayload(),
      requirements({ payTo: PAY_TO.slice(0, -1) + "y" }),
      ExactNanoErrors.INVALID_PAY_TO,
    ],
    [
      "a decimal required amount",
      paymentPayload(),
      requirements({ amount: "0.03" }),
      ExactNanoErrors.INVALID_REQUIRED_AMOUNT,
    ],
  ])("rejects %s before calling the node", async (_, payload, reqs, reason) => {
    const { rpc, fetchMock } = mockRpc(stateSendBlockInfo());
    const result = await new ExactNanoScheme({ rpc }).verify(payload, reqs);
    expect(result).toMatchObject({ isValid: false, invalidReason: reason });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("settles by returning the verified hash, and only once per block", async () => {
    const { rpc, fetchMock } = mockRpc(stateSendBlockInfo());
    const scheme = new ExactNanoScheme({ rpc });

    const settled = await scheme.settle(paymentPayload(), requirements());
    expect(settled).toEqual({
      success: true,
      payer: PAYER,
      transaction: BLOCK_HASH,
      network: "nano:mainnet",
      amount: AMOUNT,
    });

    const replay = await scheme.settle(paymentPayload(BLOCK_HASH.toLowerCase()), requirements());
    expect(replay).toMatchObject({
      success: false,
      errorReason: ExactNanoErrors.BLOCK_ALREADY_USED,
      transaction: "",
    });
    expect((await scheme.verify(paymentPayload(), requirements())).invalidReason).toBe(
      ExactNanoErrors.BLOCK_ALREADY_USED,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not record a block that fails verification", async () => {
    const { rpc } = mockRpc(stateSendBlockInfo({ confirmed: "false" }));
    const usedBlocks = { has: vi.fn(() => false), add: vi.fn(() => true) };
    const settled = await new ExactNanoScheme({ rpc, usedBlocks }).settle(
      paymentPayload(),
      requirements(),
    );
    expect(settled).toMatchObject({
      success: false,
      errorReason: ExactNanoErrors.BLOCK_NOT_CONFIRMED,
      network: "nano:mainnet",
    });
    expect(usedBlocks.add).not.toHaveBeenCalled();
  });

  it("fails settlement when a shared store reports a concurrent redemption", async () => {
    const { rpc } = mockRpc(stateSendBlockInfo());
    const usedBlocks = { has: vi.fn(async () => false), add: vi.fn(async () => false) };
    const settled = await new ExactNanoScheme({ rpc, usedBlocks }).settle(
      paymentPayload(),
      requirements(),
    );
    expect(settled).toMatchObject({
      success: false,
      errorReason: ExactNanoErrors.BLOCK_ALREADY_USED,
    });
    expect(usedBlocks.add).toHaveBeenCalledWith(BLOCK_HASH);
  });
});

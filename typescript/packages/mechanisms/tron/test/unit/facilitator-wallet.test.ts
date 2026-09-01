import { describe, expect, it, vi } from "vitest";
import {
  createFacilitatorTronSigner,
  DEFAULT_CONFIRMATION_TIMEOUT_MS,
  DEFAULT_RECEIPT_QUERY_TIMEOUT_MS,
  type FacilitatorTronWallet,
} from "../../src/signer";
import { buildTronWeb } from "../../src/rpc";
import { x402ExactPermit2ProxyABI } from "../../src/constants";

// The factory builds TronWeb internally from the network; mock that builder so
// tests inject a fake TronWeb (was previously passed as the first arg).
vi.mock("../../src/rpc", () => ({ buildTronWeb: vi.fn() }));

/**
 * Facilitator wallet-signing path (F5 facilitator): on-chain settlement is
 * built, signed by the wallet (key never enters the SDK), and broadcast —
 * mirroring bankofai's TronFacilitatorSigner. The contract selector is derived
 * from our ABI and pinned here to the known-correct canonical string.
 */

const NETWORK = "tron:0xcd8690dc";
const FAC_ADDR = "TJRyWwFs9wTFGZg3JbrVriFbNfCug5tDeC";
const PROXY = "TFGoaq2KjizijgjtkVxT7yjffW1A5T1j6F";
const TOKEN = "0x" + "a".repeat(40);
const TO = "0x" + "b".repeat(40);
const OWNER = "0x" + "c".repeat(40);
const TX_ID = "ab".repeat(32);

/** Expected canonical selector for x402ExactPermit2Proxy.settle. */
const SETTLE_SELECTOR =
  "settle(((address,uint256),uint256,uint256),address,(address,uint256),bytes)";

function fakeTronWeb(
  triggerSpy: ReturnType<typeof vi.fn>,
  broadcastSpy: ReturnType<typeof vi.fn>,
  txInfoSpy: ReturnType<typeof vi.fn> = vi.fn(),
  soliditySpy: ReturnType<typeof vi.fn> = vi.fn(),
) {
  return {
    setAddress: vi.fn(),
    transactionBuilder: { triggerSmartContract: triggerSpy },
    trx: {
      sendRawTransaction: broadcastSpy,
      // A transient preconfirm REVERT must not influence final confirmation.
      getTransaction: vi.fn(async () => ({ ret: [{ contractRet: "REVERT" }] })),
    },
    fullNode: { request: txInfoSpy },
    solidityNode: { request: soliditySpy },
  } as never;
}

/** Build a facilitator signer with the fake TronWeb routed through the mocked builder. */
function makeFacilitatorSigner(
  tw: unknown,
  wallet: FacilitatorTronWallet,
  options: Partial<Omit<Parameters<typeof createFacilitatorTronSigner>[1], "network">> = {},
) {
  vi.mocked(buildTronWeb).mockReturnValue(tw as never);
  return createFacilitatorTronSigner(wallet, { network: NETWORK, ...options });
}

describe("createFacilitatorTronSigner — wallet path", () => {
  const settleArgs = [
    [[TOKEN, 1_000_000n], 7n, 9_999n], // permit tuple
    OWNER,
    [TO, 0n], // witness tuple
    "0xsignaturehex",
  ];

  it("derives the canonical settle selector and broadcasts the wallet-signed tx", async () => {
    const trigger = vi.fn(async () => ({ result: { result: true }, transaction: { raw_data: 1 } }));
    const broadcast = vi.fn(async () => ({ result: true, txid: `0X${TX_ID.toUpperCase()}` }));
    const wallet: FacilitatorTronWallet = {
      getAddress: () => FAC_ADDR,
      signTransaction: vi.fn(async (tx: Record<string, unknown>) => ({
        ...tx,
        signature: ["abcd"],
      })),
    };

    const signer = await makeFacilitatorSigner(fakeTronWeb(trigger, broadcast), wallet, {
      permissionId: 2,
    });

    const tx = await signer.writeContract({
      address: PROXY,
      abi: x402ExactPermit2ProxyABI as unknown as readonly Record<string, unknown>[],
      functionName: "settle",
      args: settleArgs,
    });

    expect(tx).toBe(TX_ID);
    // Selector derived from ABI matches the known on-chain canonical signature.
    expect(trigger).toHaveBeenCalledWith(
      PROXY,
      SETTLE_SELECTOR,
      expect.objectContaining({ feeLimit: expect.any(Number), callValue: 0, permissionId: 2 }),
      expect.any(Array),
      FAC_ADDR,
    );
    // Wallet signed (key stays in the wallet); SDK never saw a private key.
    expect(wallet.signTransaction).toHaveBeenCalledWith({ raw_data: 1 });
    expect(broadcast).toHaveBeenCalledWith({ raw_data: 1, signature: ["abcd"] });
  });

  it("returns an explicitly provisional packed receipt and its call data", async () => {
    vi.useFakeTimers();
    try {
      const txInfo = vi.fn(async (endpoint: string) =>
        endpoint.endsWith("gettransactioninfobyid")
          ? {
              blockNumber: 84_101_804,
              receipt: { result: "SUCCESS" },
              log: [{ address: "41abc", topics: ["topic"], data: "data" }],
            }
          : {
              raw_data: {
                contract: [
                  {
                    type: "TriggerSmartContract",
                    parameter: {
                      value: { contract_address: "41abc", data: "deadbeef" },
                    },
                  },
                ],
              },
            },
      );
      const tw = fakeTronWeb(vi.fn(), vi.fn(), txInfo);
      const signer = await makeFacilitatorSigner(tw, {
        getAddress: () => FAC_ADDR,
        signTransaction: async tx => tx,
      });

      const receiptPromise = signer.waitForTransactionReceipt({ hash: TX_ID });
      await vi.runAllTimersAsync();

      await expect(receiptPromise).resolves.toEqual({
        status: "success",
        finality: "packed",
        call: { contractAddress: "41abc", data: "deadbeef" },
        logs: [{ address: "41abc", topics: ["topic"], data: "data" }],
      });
      expect(txInfo).toHaveBeenNthCalledWith(
        1,
        "wallet/gettransactioninfobyid",
        { value: TX_ID },
        "post",
      );
      expect(txInfo).toHaveBeenNthCalledWith(
        2,
        "wallet/gettransactionbyid",
        { value: TX_ID },
        "post",
      );
      expect(tw.trx.getTransaction).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns pending after the configured confirmation budget", async () => {
    vi.useFakeTimers();
    try {
      const txInfo = vi.fn(async () => ({}));
      const signer = await makeFacilitatorSigner(
        fakeTronWeb(vi.fn(), vi.fn(), txInfo),
        {
          getAddress: () => FAC_ADDR,
          signTransaction: async tx => tx,
        },
        { confirmationTimeoutMs: 6_000 },
      );

      const receiptPromise = signer.waitForTransactionReceipt({ hash: TX_ID });
      await vi.advanceTimersByTimeAsync(6_000);

      await expect(receiptPromise).resolves.toEqual({ status: "pending", finality: "packed" });
      expect(txInfo).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses a 90-second confirmation budget by default", async () => {
    vi.useFakeTimers();
    try {
      expect(DEFAULT_CONFIRMATION_TIMEOUT_MS).toBe(90_000);
      const signer = await makeFacilitatorSigner(
        fakeTronWeb(
          vi.fn(),
          vi.fn(),
          vi.fn(async () => ({})),
        ),
        {
          getAddress: () => FAC_ADDR,
          signTransaction: async tx => tx,
        },
      );

      const receiptPromise = signer.waitForTransactionReceipt({ hash: TX_ID });
      await vi.advanceTimersByTimeAsync(DEFAULT_CONFIRMATION_TIMEOUT_MS);

      await expect(receiptPromise).resolves.toEqual({ status: "pending", finality: "packed" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries a transient receipt RPC error within the confirmation budget", async () => {
    vi.useFakeTimers();
    try {
      const txInfo = vi
        .fn()
        .mockRejectedValueOnce(new Error("temporary RPC error"))
        .mockResolvedValueOnce({ blockNumber: 1, receipt: { result: "SUCCESS" } })
        .mockResolvedValueOnce({
          raw_data: {
            contract: [
              {
                type: "TriggerSmartContract",
                parameter: { value: { contract_address: "41abc", data: "deadbeef" } },
              },
            ],
          },
        });
      const signer = await makeFacilitatorSigner(
        fakeTronWeb(vi.fn(), vi.fn(), txInfo),
        {
          getAddress: () => FAC_ADDR,
          signTransaction: async tx => tx,
        },
        { confirmationTimeoutMs: 6_000 },
      );

      const receiptPromise = signer.waitForTransactionReceipt({ hash: TX_ID });
      await vi.advanceTimersByTimeAsync(3_000);

      await expect(receiptPromise).resolves.toEqual({
        status: "success",
        finality: "packed",
        call: { contractAddress: "41abc", data: "deadbeef" },
      });
      expect(txInfo).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("bounds a receipt RPC call that never resolves", async () => {
    vi.useFakeTimers();
    try {
      const txInfo = vi.fn(() => new Promise(() => undefined));
      const signer = await makeFacilitatorSigner(
        fakeTronWeb(vi.fn(), vi.fn(), txInfo),
        {
          getAddress: () => FAC_ADDR,
          signTransaction: async tx => tx,
        },
        { confirmationTimeoutMs: 6_000 },
      );

      const receiptPromise = signer.waitForTransactionReceipt({ hash: TX_ID });
      await vi.advanceTimersByTimeAsync(6_000);

      await expect(receiptPromise).resolves.toEqual({ status: "pending", finality: "packed" });
      expect(txInfo).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([undefined, "DEFAULT"])(
    "keeps an incomplete receipt result (%s) pending",
    async result => {
      vi.useFakeTimers();
      try {
        const txInfo = vi.fn(async () => ({
          blockNumber: 1,
          receipt: result === undefined ? {} : { result },
        }));
        const signer = await makeFacilitatorSigner(
          fakeTronWeb(vi.fn(), vi.fn(), txInfo),
          {
            getAddress: () => FAC_ADDR,
            signTransaction: async tx => tx,
          },
          { confirmationTimeoutMs: 6_000 },
        );

        const receiptPromise = signer.waitForTransactionReceipt({ hash: TX_ID });
        await vi.advanceTimersByTimeAsync(6_000);

        await expect(receiptPromise).resolves.toEqual({ status: "pending", finality: "packed" });
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it("queries SolidityNode when solidified finality is requested", async () => {
    vi.useFakeTimers();
    try {
      const fullNode = vi.fn();
      const solidityNode = vi.fn(async (endpoint: string) =>
        endpoint.endsWith("gettransactioninfobyid")
          ? { blockNumber: 84_101_804, receipt: { result: "SUCCESS" }, log: [] }
          : {
              raw_data: {
                contract: [
                  {
                    type: "TriggerSmartContract",
                    parameter: {
                      value: { contract_address: "41abc", data: "deadbeef" },
                    },
                  },
                ],
              },
            },
      );
      const signer = await makeFacilitatorSigner(
        fakeTronWeb(vi.fn(), vi.fn(), fullNode, solidityNode),
        {
          getAddress: () => FAC_ADDR,
          signTransaction: async tx => tx,
        },
      );

      const receiptPromise = signer.waitForTransactionReceipt({
        hash: TX_ID,
        finality: "solidified",
      });
      await vi.runAllTimersAsync();

      await expect(receiptPromise).resolves.toMatchObject({
        status: "success",
        finality: "solidified",
      });
      expect(fullNode).not.toHaveBeenCalled();
      expect(solidityNode).toHaveBeenNthCalledWith(
        1,
        "walletsolidity/gettransactioninfobyid",
        { value: TX_ID },
        "post",
      );
      expect(solidityNode).toHaveBeenNthCalledWith(
        2,
        "walletsolidity/gettransactionbyid",
        { value: TX_ID },
        "post",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("reads a solidified receipt once without polling", async () => {
    vi.useFakeTimers();
    try {
      expect(DEFAULT_RECEIPT_QUERY_TIMEOUT_MS).toBe(10_000);
      const fullNode = vi.fn();
      const solidityNode = vi.fn(async () => ({}));
      const signer = await makeFacilitatorSigner(
        fakeTronWeb(vi.fn(), vi.fn(), fullNode, solidityNode),
        {
          getAddress: () => FAC_ADDR,
          signTransaction: async tx => tx,
        },
      );

      const receipt = await signer.getTransactionReceipt!({
        hash: TX_ID,
        finality: "solidified",
      });

      expect(receipt).toEqual({ status: "pending", finality: "solidified" });
      expect(fullNode).not.toHaveBeenCalled();
      expect(solidityNode).toHaveBeenCalledTimes(1);
      expect(solidityNode).toHaveBeenCalledWith(
        "walletsolidity/gettransactioninfobyid",
        { value: TX_ID },
        "post",
      );
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not retry a failed one-shot receipt query", async () => {
    const solidityNode = vi.fn(async () => {
      throw new Error("rpc unavailable");
    });
    const signer = await makeFacilitatorSigner(
      fakeTronWeb(vi.fn(), vi.fn(), vi.fn(), solidityNode),
      {
        getAddress: () => FAC_ADDR,
        signTransaction: async tx => tx,
      },
    );

    await expect(
      signer.getTransactionReceipt!({ hash: TX_ID, finality: "solidified" }),
    ).rejects.toThrow("rpc unavailable");
    expect(solidityNode).toHaveBeenCalledTimes(1);
  });

  it("bounds a one-shot receipt query", async () => {
    vi.useFakeTimers();
    try {
      const solidityNode = vi.fn(() => new Promise(() => undefined));
      const signer = await makeFacilitatorSigner(
        fakeTronWeb(vi.fn(), vi.fn(), vi.fn(), solidityNode),
        {
          getAddress: () => FAC_ADDR,
          signTransaction: async tx => tx,
        },
      );

      const receiptPromise = signer.getTransactionReceipt!({
        hash: TX_ID,
        finality: "solidified",
        timeoutMs: 500,
      });
      const expectation = expect(receiptPromise).rejects.toThrow("TRON receipt RPC timed out");
      await vi.advanceTimersByTimeAsync(500);

      await expectation;
      expect(solidityNode).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels a one-shot receipt query during worker shutdown", async () => {
    vi.useFakeTimers();
    try {
      const solidityNode = vi.fn(() => new Promise(() => undefined));
      const signer = await makeFacilitatorSigner(
        fakeTronWeb(vi.fn(), vi.fn(), vi.fn(), solidityNode),
        {
          getAddress: () => FAC_ADDR,
          signTransaction: async tx => tx,
        },
      );
      const controller = new AbortController();

      const receiptPromise = signer.getTransactionReceipt!({
        hash: TX_ID,
        finality: "solidified",
        signal: controller.signal,
      });
      const expectation = expect(receiptPromise).rejects.toThrow("worker shutdown");
      controller.abort(new Error("worker shutdown"));

      await expectation;
      expect(solidityNode).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects an invalid confirmation timeout", async () => {
    await expect(
      makeFacilitatorSigner(
        fakeTronWeb(vi.fn(), vi.fn()),
        {
          getAddress: () => FAC_ADDR,
          signTransaction: async tx => tx,
        },
        { confirmationTimeoutMs: 0 },
      ),
    ).rejects.toThrow(/confirmationTimeoutMs must be a positive integer/);
  });

  it("maps tuple inputs to typed trigger parameters", async () => {
    const trigger = vi.fn(async () => ({ result: { result: true }, transaction: {} }));
    const broadcast = vi.fn(async () => ({ result: true, txid: TX_ID }));
    const wallet: FacilitatorTronWallet = {
      getAddress: () => FAC_ADDR,
      signTransaction: async () => ({ signature: ["x"] }),
    };
    const signer = await makeFacilitatorSigner(fakeTronWeb(trigger, broadcast), wallet);
    await signer.writeContract({
      address: PROXY,
      abi: x402ExactPermit2ProxyABI as unknown as readonly Record<string, unknown>[],
      functionName: "settle",
      args: settleArgs,
    });
    const params = trigger.mock.calls[0]![3] as { type: string; value: unknown }[];
    expect(params.map(p => p.type)).toEqual([
      "((address,uint256),uint256,uint256)",
      "address",
      "(address,uint256)",
      "bytes",
    ]);
    expect(params[0]!.value).toBe(settleArgs[0]);
  });

  it("throws when triggerSmartContract fails", async () => {
    const trigger = vi.fn(async () => ({ result: { result: false }, transaction: {} }));
    const broadcast = vi.fn();
    const wallet: FacilitatorTronWallet = {
      getAddress: () => FAC_ADDR,
      signTransaction: async () => ({}),
    };
    const signer = await makeFacilitatorSigner(fakeTronWeb(trigger, broadcast), wallet);
    await expect(
      signer.writeContract({
        address: PROXY,
        abi: x402ExactPermit2ProxyABI as unknown as readonly Record<string, unknown>[],
        functionName: "settle",
        args: settleArgs,
      }),
    ).rejects.toThrow(/triggerSmartContract failed/);
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("throws a clear contract error when the wallet returns malformed JSON", async () => {
    const trigger = vi.fn(async () => ({ result: { result: true }, transaction: { raw_data: 1 } }));
    const broadcast = vi.fn();
    const wallet: FacilitatorTronWallet = {
      getAddress: () => FAC_ADDR,
      // Looks like JSON (leading "{") but is not parseable — a contract violation.
      signTransaction: async () => "{not valid json",
    };
    const signer = await makeFacilitatorSigner(fakeTronWeb(trigger, broadcast), wallet);
    await expect(
      signer.writeContract({
        address: PROXY,
        abi: x402ExactPermit2ProxyABI as unknown as readonly Record<string, unknown>[],
        functionName: "settle",
        args: settleArgs,
      }),
    ).rejects.toThrow(/malformed JSON/);
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("accepts a raw signature hex from the wallet", async () => {
    const trigger = vi.fn(async () => ({ result: { result: true }, transaction: { r: 1 } }));
    const broadcast = vi.fn(async () => ({ result: true, txid: TX_ID }));
    const wallet: FacilitatorTronWallet = {
      getAddress: () => FAC_ADDR,
      signTransaction: async () => "0xrawsig",
    };
    const signer = await makeFacilitatorSigner(fakeTronWeb(trigger, broadcast), wallet);
    await signer.writeContract({
      address: PROXY,
      abi: x402ExactPermit2ProxyABI as unknown as readonly Record<string, unknown>[],
      functionName: "settle",
      args: settleArgs,
    });
    expect(broadcast).toHaveBeenCalledWith({ r: 1, signature: ["rawsig"] });
  });
});

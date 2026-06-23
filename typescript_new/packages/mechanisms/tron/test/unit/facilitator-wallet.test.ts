import { describe, expect, it, vi } from "vitest";
import { createFacilitatorTronSigner, type FacilitatorTronWallet } from "../../src/signer";
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

const NETWORK = "tron:nile";
const FAC_ADDR = "TJRyWwFs9wTFGZg3JbrVriFbNfCug5tDeC";
const PROXY = "TFGoaq2KjizijgjtkVxT7yjffW1A5T1j6F";
const TOKEN = "0x" + "a".repeat(40);
const TO = "0x" + "b".repeat(40);
const OWNER = "0x" + "c".repeat(40);

/** Expected canonical selector for x402ExactPermit2Proxy.settle. */
const SETTLE_SELECTOR =
  "settle(((address,uint256),uint256,uint256),address,(address,uint256),bytes)";

function fakeTronWeb(triggerSpy: ReturnType<typeof vi.fn>, broadcastSpy: ReturnType<typeof vi.fn>) {
  return {
    setAddress: vi.fn(),
    transactionBuilder: { triggerSmartContract: triggerSpy },
    trx: { sendRawTransaction: broadcastSpy },
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
    const broadcast = vi.fn(async () => ({ result: true, txid: "0xdeadbeef" }));
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

    expect(tx).toBe("0xdeadbeef");
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

  it("maps tuple inputs to typed trigger parameters", async () => {
    const trigger = vi.fn(async () => ({ result: { result: true }, transaction: {} }));
    const broadcast = vi.fn(async () => ({ result: true, txid: "0x1" }));
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

  it("accepts a raw signature hex from the wallet", async () => {
    const trigger = vi.fn(async () => ({ result: { result: true }, transaction: { r: 1 } }));
    const broadcast = vi.fn(async () => ({ result: true, txid: "0x2" }));
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

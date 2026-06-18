import { describe, it, expect, vi } from "vitest";
import { encodeFunctionData, type Abi } from "viem";

import {
  createFacilitatorEvmSigner,
  type FacilitatorEvmPublicClient,
  type FacilitatorEvmWallet,
} from "../../src/facilitator/agent-wallet";

const WALLET_ADDRESS = `0x${"11".repeat(20)}` as `0x${string}`;
const TOKEN = `0x${"22".repeat(20)}` as `0x${string}`;
const RECIPIENT = `0x${"33".repeat(20)}` as `0x${string}`;
const TX_HASH = `0x${"ab".repeat(32)}` as `0x${string}`;

const erc20Abi = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const satisfies Abi;

function makePublicClient(overrides: Record<string, unknown> = {}) {
  const pc = {
    getChainId: vi.fn(async () => 8453),
    getTransactionCount: vi.fn(async () => 7),
    estimateFeesPerGas: vi.fn(async () => ({ maxFeePerGas: 100n, maxPriorityFeePerGas: 2n })),
    estimateGas: vi.fn(async () => 21_000n),
    sendRawTransaction: vi.fn(async () => TX_HASH),
    readContract: vi.fn(async () => 999n),
    verifyTypedData: vi.fn(async () => true),
    getCode: vi.fn(async () => "0xdeadbeef" as `0x${string}`),
    waitForTransactionReceipt: vi.fn(async () => ({ status: "success", logs: [] })),
    ...overrides,
  };
  // `FacilitatorEvmPublicClient` is now a `Pick<viem PublicClient>` (issue #5),
  // which this loose mock does not structurally satisfy. Intersect so the mock
  // is accepted by the factory while keeping vi.fn types for assertions.
  return pc as unknown as typeof pc & FacilitatorEvmPublicClient;
}

function makeWallet(signImpl: () => Promise<string> = async () => "deadbeef") {
  // Default returns a hex WITHOUT the `0x` prefix, mirroring agent-wallet's
  // current behavior (SDK issue #2).
  return {
    address: WALLET_ADDRESS,
    signTransaction: vi.fn(signImpl),
  } satisfies FacilitatorEvmWallet;
}

describe("createFacilitatorEvmSigner", () => {
  it("exposes the wallet address via getAddresses()", () => {
    const signer = createFacilitatorEvmSigner(makePublicClient(), makeWallet());
    expect(signer.getAddresses()).toEqual([WALLET_ADDRESS]);
  });

  it("delegates read/verify/receipt ops to the public client", async () => {
    const pc = makePublicClient();
    const signer = createFacilitatorEvmSigner(pc, makeWallet());

    expect(
      await signer.readContract({ address: TOKEN, abi: erc20Abi, functionName: "balanceOf" }),
    ).toBe(999n);
    expect(await signer.getCode({ address: TOKEN })).toBe("0xdeadbeef");
    expect(
      await signer.verifyTypedData({
        address: WALLET_ADDRESS,
        domain: {},
        types: {},
        primaryType: "X",
        message: {},
        signature: "0xsig" as `0x${string}`,
      }),
    ).toBe(true);
    const receipt = await signer.waitForTransactionReceipt({ hash: TX_HASH });
    expect(receipt.status).toBe("success");
  });

  it("builds, wallet-signs, and broadcasts a writeContract call", async () => {
    const pc = makePublicClient();
    const wallet = makeWallet();
    const signer = createFacilitatorEvmSigner(pc, wallet);

    const hash = await signer.writeContract({
      address: TOKEN,
      abi: erc20Abi,
      functionName: "transfer",
      args: [RECIPIENT, 1000n],
    });

    expect(hash).toBe(TX_HASH);
    const data = encodeFunctionData({
      abi: erc20Abi,
      functionName: "transfer",
      args: [RECIPIENT, 1000n],
    });
    expect(wallet.signTransaction).toHaveBeenCalledWith({
      to: TOKEN,
      data,
      value: 0n,
      nonce: 7,
      gas: 21_000n,
      maxFeePerGas: 100n,
      maxPriorityFeePerGas: 2n,
      chainId: 8453,
    });
    expect(pc.estimateGas).toHaveBeenCalledOnce();
  });

  // SDK issue #2: agent-wallet's EvmSigner.signTransaction strips the `0x`.
  it("normalizes a signed tx hex WITHOUT a 0x prefix before broadcasting", async () => {
    const pc = makePublicClient();
    const signer = createFacilitatorEvmSigner(
      pc,
      makeWallet(async () => "abcd1234"),
    );

    await signer.sendTransaction({ to: RECIPIENT, data: "0x" });

    expect(pc.sendRawTransaction).toHaveBeenCalledWith({ serializedTransaction: "0xabcd1234" });
  });

  it("does NOT double-prefix a signed tx hex that already has 0x", async () => {
    const pc = makePublicClient();
    const signer = createFacilitatorEvmSigner(
      pc,
      makeWallet(async () => "0xabcd1234"),
    );

    await signer.sendTransaction({ to: RECIPIENT, data: "0x" });

    expect(pc.sendRawTransaction).toHaveBeenCalledWith({ serializedTransaction: "0xabcd1234" });
  });

  it("uses the per-call gas override and skips gas estimation", async () => {
    const pc = makePublicClient();
    const wallet = makeWallet();
    const signer = createFacilitatorEvmSigner(pc, wallet);

    await signer.writeContract({
      address: TOKEN,
      abi: erc20Abi,
      functionName: "transfer",
      args: [RECIPIENT, 1n],
      gas: 50_000n,
    });

    expect(pc.estimateGas).not.toHaveBeenCalled();
    expect(wallet.signTransaction).toHaveBeenCalledWith(expect.objectContaining({ gas: 50_000n }));
  });

  it("falls back to options.defaultGas when no per-call gas is given", async () => {
    const pc = makePublicClient();
    const wallet = makeWallet();
    const signer = createFacilitatorEvmSigner(pc, wallet, { defaultGas: 99_999n });

    await signer.sendTransaction({ to: RECIPIENT, data: "0x" });

    expect(pc.estimateGas).not.toHaveBeenCalled();
    expect(wallet.signTransaction).toHaveBeenCalledWith(expect.objectContaining({ gas: 99_999n }));
  });

  it("appends dataSuffix to the encoded calldata", async () => {
    const pc = makePublicClient();
    const wallet = makeWallet();
    const signer = createFacilitatorEvmSigner(pc, wallet);

    await signer.writeContract({
      address: TOKEN,
      abi: erc20Abi,
      functionName: "transfer",
      args: [RECIPIENT, 1n],
      dataSuffix: "0xc0ffee",
    });

    const base = encodeFunctionData({
      abi: erc20Abi,
      functionName: "transfer",
      args: [RECIPIENT, 1n],
    });
    expect(wallet.signTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ data: `${base}c0ffee` }),
    );
  });
});

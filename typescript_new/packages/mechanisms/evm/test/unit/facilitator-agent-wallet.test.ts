import { describe, it, expect, vi, beforeEach } from "vitest";
import { encodeFunctionData, type Abi } from "viem";

import {
  createFacilitatorEvmSigner,
  type FacilitatorEvmWallet,
} from "../../src/adapters/agent-wallet";
import { createEvmPublicClient } from "../../src/adapters/chains";

// The factory builds its viem client internally from the CAIP-2 network; mock
// that builder so tests inject a fake client without touching the network.
vi.mock("../../src/adapters/chains", () => ({ createEvmPublicClient: vi.fn() }));

const NETWORK = "eip155:8453";
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
  return pc;
}

/** Install a mock public client as the one the factory builds for `network`. */
function useClient(pc: ReturnType<typeof makePublicClient>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(createEvmPublicClient).mockReturnValue(pc as any);
  return pc;
}

function makeWallet(signImpl: () => Promise<string> = async () => "deadbeef") {
  // Default returns a hex WITHOUT the `0x` prefix, mirroring agent-wallet's
  // current behavior (SDK issue #2).
  return {
    getAddress: async () => WALLET_ADDRESS,
    signTransaction: vi.fn(signImpl),
  } satisfies FacilitatorEvmWallet;
}

beforeEach(() => {
  vi.mocked(createEvmPublicClient).mockReset();
});

describe("createFacilitatorEvmSigner", () => {
  it("exposes the wallet address via getAddresses()", async () => {
    useClient(makePublicClient());
    const signer = await createFacilitatorEvmSigner(makeWallet(), { network: NETWORK });
    expect(signer.getAddresses()).toEqual([WALLET_ADDRESS]);
  });

  it("delegates read/verify/receipt ops to the public client", async () => {
    const pc = useClient(makePublicClient());
    const signer = await createFacilitatorEvmSigner(makeWallet(), { network: NETWORK });

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

  it("reads as the facilitator EOA (sets the eth_call caller)", async () => {
    const pc = useClient(makePublicClient());
    const signer = await createFacilitatorEvmSigner(makeWallet(), { network: NETWORK });

    await signer.readContract({ address: TOKEN, abi: erc20Abi, functionName: "balanceOf" });

    expect(pc.readContract).toHaveBeenCalledWith(
      expect.objectContaining({ account: WALLET_ADDRESS }),
    );
  });

  it("builds, wallet-signs, and broadcasts a writeContract call", async () => {
    const pc = useClient(makePublicClient());
    const wallet = makeWallet();
    const signer = await createFacilitatorEvmSigner(wallet, { network: NETWORK });

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

  // "pending" block tag avoids nonce reuse across rapid sequential settlements.
  it("reads the nonce with blockTag 'pending'", async () => {
    const pc = useClient(makePublicClient());
    const signer = await createFacilitatorEvmSigner(makeWallet(), { network: NETWORK });

    await signer.sendTransaction({ to: RECIPIENT, data: "0x" });

    expect(pc.getTransactionCount).toHaveBeenCalledWith(
      expect.objectContaining({ address: WALLET_ADDRESS, blockTag: "pending" }),
    );
  });

  // SDK issue #2: agent-wallet's EvmSigner.signTransaction strips the `0x`.
  it("normalizes a signed tx hex WITHOUT a 0x prefix before broadcasting", async () => {
    const pc = useClient(makePublicClient());
    const signer = await createFacilitatorEvmSigner(
      makeWallet(async () => "abcd1234"),
      { network: NETWORK },
    );

    await signer.sendTransaction({ to: RECIPIENT, data: "0x" });

    expect(pc.sendRawTransaction).toHaveBeenCalledWith({ serializedTransaction: "0xabcd1234" });
  });

  it("does NOT double-prefix a signed tx hex that already has 0x", async () => {
    const pc = useClient(makePublicClient());
    const signer = await createFacilitatorEvmSigner(
      makeWallet(async () => "0xabcd1234"),
      { network: NETWORK },
    );

    await signer.sendTransaction({ to: RECIPIENT, data: "0x" });

    expect(pc.sendRawTransaction).toHaveBeenCalledWith({ serializedTransaction: "0xabcd1234" });
  });

  it("uses the per-call gas override and skips gas estimation", async () => {
    const pc = useClient(makePublicClient());
    const wallet = makeWallet();
    const signer = await createFacilitatorEvmSigner(wallet, { network: NETWORK });

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
    const pc = useClient(makePublicClient());
    const wallet = makeWallet();
    const signer = await createFacilitatorEvmSigner(wallet, { network: NETWORK, defaultGas: 99_999n });

    await signer.sendTransaction({ to: RECIPIENT, data: "0x" });

    expect(pc.estimateGas).not.toHaveBeenCalled();
    expect(wallet.signTransaction).toHaveBeenCalledWith(expect.objectContaining({ gas: 99_999n }));
  });

  it("appends dataSuffix to the encoded calldata", async () => {
    useClient(makePublicClient());
    const wallet = makeWallet();
    const signer = await createFacilitatorEvmSigner(wallet, { network: NETWORK });

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

  // ERC-20 approval gas-sponsoring: broadcast the client's pre-signed approve
  // as-is, then facilitator-sign + broadcast the settle call intent.
  it("sendTransactions: broadcasts a pre-signed tx as-is and signs a call intent", async () => {
    const hashes = [`0x${"a1".repeat(32)}`, `0x${"b2".repeat(32)}`] as `0x${string}`[];
    let i = 0;
    const pc = useClient(makePublicClient({ sendRawTransaction: vi.fn(async () => hashes[i++]) }));
    const wallet = makeWallet(async () => "abcd");
    const signer = await createFacilitatorEvmSigner(wallet, { network: NETWORK });

    const PRESIGNED = `0x${"ff".repeat(40)}` as `0x${string}`;
    const result = await signer.sendTransactions([
      PRESIGNED,
      { to: RECIPIENT, data: "0x1234", gas: 300_000n },
    ]);

    expect(result).toEqual(hashes);
    expect(pc.sendRawTransaction).toHaveBeenNthCalledWith(1, { serializedTransaction: PRESIGNED });
    expect(wallet.signTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ to: RECIPIENT, data: "0x1234", gas: 300_000n }),
    );
    expect(pc.sendRawTransaction).toHaveBeenNthCalledWith(2, { serializedTransaction: "0xabcd" });
    expect(pc.estimateGas).not.toHaveBeenCalled(); // gas override supplied
  });
});

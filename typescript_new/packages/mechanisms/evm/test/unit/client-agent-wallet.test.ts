import { describe, it, expect, vi } from "vitest";

import { createClientEvmSigner, type ClientEvmWallet } from "../../src/client/agent-wallet";

const ADDRESS = `0x${"11".repeat(20)}` as `0x${string}`;
const TYPED_DATA = {
  domain: { name: "USDC" },
  types: { Permit: [] },
  primaryType: "Permit",
  message: { value: "1" },
};

function makeWallet(sig: string): ClientEvmWallet & { signTypedData: ReturnType<typeof vi.fn> } {
  return {
    getAddress: vi.fn(async () => ADDRESS),
    signTypedData: vi.fn(async () => sig),
  };
}

describe("createClientEvmSigner", () => {
  it("resolves the wallet address eagerly", async () => {
    const signer = await createClientEvmSigner(makeWallet("0xabcd"));
    expect(signer.address).toBe(ADDRESS);
  });

  it("forwards the typed-data message to the wallet unchanged", async () => {
    const wallet = makeWallet("0xabcd");
    const signer = await createClientEvmSigner(wallet);
    await signer.signTypedData(TYPED_DATA);
    expect(wallet.signTypedData).toHaveBeenCalledWith(TYPED_DATA);
  });

  // Signature analog of SDK issue #2: agent-wallet strips the 0x prefix.
  it("re-adds the 0x prefix when the wallet returns a bare signature", async () => {
    const signer = await createClientEvmSigner(makeWallet("abcd1234"));
    expect(await signer.signTypedData(TYPED_DATA)).toBe("0xabcd1234");
  });

  it("does not double-prefix a signature that already has 0x", async () => {
    const signer = await createClientEvmSigner(makeWallet("0xabcd1234"));
    expect(await signer.signTypedData(TYPED_DATA)).toBe("0xabcd1234");
  });

  it("wires readContract from the public client when provided", async () => {
    const publicClient = { readContract: vi.fn(async () => 42n) };
    const signer = await createClientEvmSigner(makeWallet("0xabcd"), publicClient);
    expect(signer.readContract).toBeDefined();
    await signer.readContract?.({ address: ADDRESS, abi: [], functionName: "allowance" });
    expect(publicClient.readContract).toHaveBeenCalled();
  });

  it("omits readContract when no public client is given", async () => {
    const signer = await createClientEvmSigner(makeWallet("0xabcd"));
    expect(signer.readContract).toBeUndefined();
  });

  // Enables the ERC-20 approval gas-sponsoring extension (sign approve offline).
  it("wires signTransaction from the wallet and re-adds the 0x prefix", async () => {
    const wallet = { ...makeWallet("0xsig"), signTransaction: vi.fn(async () => "beef") };
    const signer = await createClientEvmSigner(wallet);
    expect(signer.signTransaction).toBeDefined();
    const out = await signer.signTransaction?.({
      to: ADDRESS,
      data: "0x",
      nonce: 0,
      gas: 1n,
      maxFeePerGas: 1n,
      maxPriorityFeePerGas: 1n,
      chainId: 97,
    });
    expect(out).toBe("0xbeef");
    expect(wallet.signTransaction).toHaveBeenCalled();
  });

  it("omits signTransaction when the wallet lacks it", async () => {
    const signer = await createClientEvmSigner(makeWallet("0xabcd"));
    expect(signer.signTransaction).toBeUndefined();
  });
});

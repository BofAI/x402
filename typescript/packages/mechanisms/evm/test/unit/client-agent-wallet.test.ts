import { describe, it, expect, vi, beforeEach } from "vitest";

import { createClientEvmSigner, type ClientEvmWallet } from "../../src/adapters/agent-wallet";
import { createEvmPublicClient } from "../../src/adapters/chains";

// The factory builds its viem client internally from the CAIP-2 network; mock
// that builder so tests control the read surface without touching the network.
vi.mock("../../src/adapters/chains", () => ({ createEvmPublicClient: vi.fn() }));

const NETWORK = "eip155:97";
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

beforeEach(() => {
  // Default: the internally-built client is absent (ERC-3009-only flows never read).
  vi.mocked(createEvmPublicClient).mockReset();
});

describe("createClientEvmSigner", () => {
  it("resolves the wallet address eagerly", async () => {
    const signer = await createClientEvmSigner(makeWallet("0xabcd"), { network: NETWORK });
    expect(signer.address).toBe(ADDRESS);
  });

  it("forwards the typed-data message to the wallet unchanged", async () => {
    const wallet = makeWallet("0xabcd");
    const signer = await createClientEvmSigner(wallet, { network: NETWORK });
    await signer.signTypedData(TYPED_DATA);
    expect(wallet.signTypedData).toHaveBeenCalledWith(TYPED_DATA);
  });

  // Signature analog of SDK issue #2: agent-wallet strips the 0x prefix.
  it("re-adds the 0x prefix when the wallet returns a bare signature", async () => {
    const signer = await createClientEvmSigner(makeWallet("abcd1234"), { network: NETWORK });
    expect(await signer.signTypedData(TYPED_DATA)).toBe("0xabcd1234");
  });

  it("does not double-prefix a signature that already has 0x", async () => {
    const signer = await createClientEvmSigner(makeWallet("0xabcd1234"), { network: NETWORK });
    expect(await signer.signTypedData(TYPED_DATA)).toBe("0xabcd1234");
  });

  it("wires readContract from the internally-built public client", async () => {
    const publicClient = { readContract: vi.fn(async () => 42n) };
    vi.mocked(createEvmPublicClient).mockReturnValue(publicClient as any);
    const signer = await createClientEvmSigner(makeWallet("0xabcd"), { network: NETWORK });
    expect(signer.readContract).toBeDefined();
    await signer.readContract?.({ address: ADDRESS, abi: [], functionName: "allowance" });
    expect(publicClient.readContract).toHaveBeenCalled();
  });

  // Enables the ERC-20 approval gas-sponsoring extension (sign approve offline).
  it("wires signTransaction from the wallet and re-adds the 0x prefix", async () => {
    const wallet = { ...makeWallet("0xsig"), signTransaction: vi.fn(async () => "beef") };
    const signer = await createClientEvmSigner(wallet, { network: NETWORK });
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
    const signer = await createClientEvmSigner(makeWallet("0xabcd"), { network: NETWORK });
    expect(signer.signTransaction).toBeUndefined();
  });
});

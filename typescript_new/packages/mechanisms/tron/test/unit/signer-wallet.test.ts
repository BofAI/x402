import { describe, expect, it, vi } from "vitest";
import { TronWeb } from "tronweb";
import { createClientTronSigner, type AgentWallet } from "../../src/signer";
import { privateKeyTronWallet } from "./helpers";

/**
 * Offline tests for the AgentWallet abstraction (F5).
 *
 * `createClientTronSigner` is wallet-only: the private key never enters the SDK.
 * A raw key is just one AgentWallet implementation (via privateKeyTronWallet);
 * arbitrary wallets (hosted, hardware) drive the signer via structural typing.
 */

const PK = "da146374a75310b9666e834ee4ad0866d6f4035967bfc76217c5a495fff9f0d0";
const ADDR = "TJRyWwFs9wTFGZg3JbrVriFbNfCug5tDeC";

const TYPED = {
  domain: {
    name: "Permit2",
    chainId: 3448148188,
    verifyingContract: "0x0000000000000000000000000000000000000000",
  },
  types: { Foo: [{ name: "x", type: "uint256" }] },
  primaryType: "Foo",
  message: { x: 1n },
} as const;

function tron(): TronWeb {
  return new TronWeb({ fullHost: "https://nile.trongrid.io", privateKey: PK });
}

describe("privateKeyTronWallet", () => {
  it("derives a stable Base58 address and signs typed data", async () => {
    const wallet = privateKeyTronWallet(tron(), PK);
    const address = await wallet.getAddress();
    expect(typeof address).toBe("string");
    expect((address as string).startsWith("T")).toBe(true);

    const sig = await wallet.signTypedData(TYPED);
    expect(sig.startsWith("0x")).toBe(true);
  });
});

describe("createClientTronSigner (wallet-only)", () => {
  it("builds a signer from a private-key wallet and signs consistently", async () => {
    const tw = tron();
    const wallet = privateKeyTronWallet(tw, PK);
    const signer = await createClientTronSigner(tw, wallet);

    expect(signer.address).toBe(await wallet.getAddress());
    const [viaSigner, viaWallet] = await Promise.all([
      signer.signTypedData(TYPED),
      wallet.signTypedData(TYPED),
    ]);
    expect(viaSigner).toBe(viaWallet);
  });

  it("delegates signing to an arbitrary wallet", async () => {
    const wallet: AgentWallet = {
      getAddress: () => ADDR,
      signTypedData: vi.fn(async () => "0xdeadbeef" as `0x${string}`),
    };
    const signer = await createClientTronSigner(tron(), wallet);

    expect(signer.address).toBe(ADDR);
    expect(await signer.signTypedData(TYPED)).toBe("0xdeadbeef");
    expect(wallet.signTypedData).toHaveBeenCalledWith(TYPED);
  });

  it("awaits an async getAddress", async () => {
    const wallet: AgentWallet = {
      getAddress: async () => ADDR,
      signTypedData: async () => "0x01" as `0x${string}`,
    };
    const signer = await createClientTronSigner(tron(), wallet);
    expect(signer.address).toBe(ADDR);
  });

  it("backs contract reads with the provided TronWeb instance", async () => {
    const wallet: AgentWallet = {
      getAddress: () => ADDR,
      signTypedData: async () => "0x01" as `0x${string}`,
    };
    const signer = await createClientTronSigner(tron(), wallet);
    expect(typeof signer.readContract).toBe("function");
  });
});

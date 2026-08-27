import { describe, expect, it, vi } from "vitest";
import { TronWeb } from "tronweb";
import {
  createClientTronSigner,
  normalizeSignedTronTransaction,
  type ClientTronWallet,
} from "../../src/signer";
import { buildTronWeb } from "../../src/rpc";
import { privateKeyTronWallet } from "./helpers";
import { registerExactTronScheme } from "../../src/exact/client/register";

// The factory builds TronWeb internally from the network; mock that builder so
// tests inject a real/seeded TronWeb (was previously passed as the first arg).
vi.mock("../../src/rpc", () => ({ buildTronWeb: vi.fn() }));

/**
 * Offline tests for the ClientTronWallet abstraction (F5).
 *
 * `createClientTronSigner` is wallet-only: the private key never enters the SDK.
 * A raw key is just one ClientTronWallet implementation (via privateKeyTronWallet);
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

/** Build a client signer with the given TronWeb routed through the mocked builder. */
async function makeClient(tw: TronWeb, wallet: ClientTronWallet) {
  vi.mocked(buildTronWeb).mockReturnValue(tw);
  return createClientTronSigner(wallet, { network: "tron:0xcd8690dc" });
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
    const signer = await makeClient(tw, wallet);

    expect(signer.address).toBe(await wallet.getAddress());
    expect(signer.network).toBe("tron:0xcd8690dc");
    const [viaSigner, viaWallet] = await Promise.all([
      signer.signTypedData(TYPED),
      wallet.signTypedData(TYPED),
    ]);
    expect(viaSigner).toBe(viaWallet);
  });

  it("registers a stock signer only for its exact network by default", async () => {
    const signer = await makeClient(tron(), privateKeyTronWallet(tron(), PK));
    const client = { register: vi.fn(), registerPolicy: vi.fn() };

    registerExactTronScheme(client as never, { signer });

    expect(client.register).toHaveBeenCalledWith("tron:0xcd8690dc", expect.anything());
    expect(client.register).not.toHaveBeenCalledWith("tron:*", expect.anything());
  });

  it("rejects explicit registration on a different network", async () => {
    const signer = await makeClient(tron(), privateKeyTronWallet(tron(), PK));
    const client = { register: vi.fn(), registerPolicy: vi.fn() };

    expect(() =>
      registerExactTronScheme(client as never, {
        signer,
        networks: ["tron:0x2b6653dc"],
      }),
    ).toThrow(/cannot be registered/);
    expect(client.register).not.toHaveBeenCalled();
  });

  it("delegates signing to an arbitrary wallet", async () => {
    const wallet: ClientTronWallet = {
      getAddress: () => ADDR,
      signTypedData: vi.fn(async () => "0xdeadbeef" as `0x${string}`),
    };
    const signer = await makeClient(tron(), wallet);

    expect(signer.address).toBe(ADDR);
    expect(await signer.signTypedData(TYPED)).toBe("0xdeadbeef");
    expect(wallet.signTypedData).toHaveBeenCalledWith(TYPED);
  });

  it("awaits an async getAddress", async () => {
    const wallet: ClientTronWallet = {
      getAddress: async () => ADDR,
      signTypedData: async () => "0x01" as `0x${string}`,
    };
    const signer = await makeClient(tron(), wallet);
    expect(signer.address).toBe(ADDR);
  });

  it("backs contract reads with the provided TronWeb instance", async () => {
    const wallet: ClientTronWallet = {
      getAddress: () => ADDR,
      signTypedData: async () => "0x01" as `0x${string}`,
    };
    const signer = await makeClient(tron(), wallet);
    expect(typeof signer.readContract).toBe("function");
  });
});

describe("normalizeSignedTronTransaction", () => {
  it("normalizes Ethereum-style recovery bytes for TRON transaction signatures", () => {
    const r = "11".repeat(64);
    const unsigned = { txID: "abc" };

    expect(
      normalizeSignedTronTransaction({ ...unsigned, signature: [`${r}1b`] }, unsigned),
    ).toMatchObject({ signature: [`${r}00`] });
    expect(
      normalizeSignedTronTransaction(JSON.stringify({ signature: [`${r}1c`] }), unsigned),
    ).toMatchObject({ signature: [`${r}01`] });
  });

  it("preserves already normalized TRON recovery bytes", () => {
    const signature = `${"22".repeat(64)}01`;
    expect(normalizeSignedTronTransaction(signature, { txID: "abc" })).toMatchObject({
      signature: [signature],
    });
  });
});

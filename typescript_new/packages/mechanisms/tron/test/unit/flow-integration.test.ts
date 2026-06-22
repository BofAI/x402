import { describe, expect, it } from "vitest";
import { TronWeb } from "tronweb";

import { ExactTronScheme as ExactServer } from "../../src/exact/server/scheme";
import { ExactTronScheme as ExactFacilitator } from "../../src/exact/facilitator/scheme";
import { ExactTronScheme as ExactClient } from "../../src/exact/client/scheme";
import { ExactGasFreeScheme as GasFreeServer } from "../../src/gasfree/server/scheme";
import { ExactGasFreeScheme as GasFreeFacilitator } from "../../src/gasfree/facilitator/scheme";
import { ExactGasFreeScheme as GasFreeClient } from "../../src/gasfree/client/scheme";
import {
  createClientTronSigner,
  createFacilitatorTronSigner,
  type ClientTronSigner,
  type FacilitatorTronSigner,
} from "../../src/signer";
import { privateKeyTronWallet } from "./helpers";
import type { ExactGasFreePayload, ExactPermit2Payload } from "../../src/types";
import type { PaymentPayload, PaymentRequirements } from "@bankofai/x402-core/types";

/**
 * In-process integration tests for the TRON mechanism (no HTTP).
 *
 * Wires the real server, client, and facilitator schemes together in the
 * x402 order — getExtra → enhancePaymentRequirements → createPaymentPayload →
 * verify → settle — so the cross-role data contracts are exercised end to end.
 * Signatures are produced and verified with real TronWeb (TIP-712); only chain
 * I/O (balance/allowance reads, on-chain settle) and the GasFree relayer are
 * stubbed, keeping the suite offline and deterministic.
 */

const NETWORK = "tron:nile";
const USDT = "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf";
const PAYER_PK = "da146374a75310b9666e834ee4ad0866d6f4035967bfc76217c5a495fff9f0d0";
const FAC_PK = "b71c71a67e1177ad4e901695e1b4b9ee17ae16c6668d313eac2f96dbcda3f291";
const PAY_TO = "TJRyWwFs9wTFGZg3JbrVriFbNfCug5tDeC";
const FAKE_TX = "0x" + "11".repeat(32);

const addr = (pk: string) => TronWeb.address.fromPrivateKey(pk) as string;
const PROVIDER = addr("0000000000000000000000000000000000000000000000000000000000000002");
const GASFREE_ADDR = addr("0000000000000000000000000000000000000000000000000000000000000003");

/** Mutable on-chain state shared by the stubbed signer reads. */
interface Chain {
  balance: bigint;
  allowance: bigint;
}

/** A TronWeb seeded with `pk` so its defaultAddress matches the signer's key. */
function tron(pk: string): TronWeb {
  return new TronWeb({ fullHost: "https://nile.trongrid.io", privateKey: pk });
}

/** Stub readContract: balanceOf/allowance come from the shared chain state. */
function readStub(chain: Chain) {
  return async (args: { functionName: string }) =>
    args.functionName === "allowance" ? chain.allowance : chain.balance;
}

async function clientSigner(chain: Chain): Promise<ClientTronSigner> {
  const tw = tron(PAYER_PK);
  // allowanceMode "skip": these flow tests exercise the facilitator's allowance
  // gatekeeping, so the client must not auto-approve (covered by client-allowance).
  const base = await createClientTronSigner(tw, privateKeyTronWallet(tw, PAYER_PK), {
    allowanceMode: "skip",
  });
  return { ...base, readContract: readStub(chain) };
}

function facilitatorSigner(chain: Chain): FacilitatorTronSigner {
  // Wallet shell: real verifyTypedData comes from the signer; signing is stubbed
  // here because these tests override writeContract.
  const wallet = { address: addr(FAC_PK), signTransaction: async () => ({}) };
  return {
    ...createFacilitatorTronSigner(tron(FAC_PK), wallet),
    readContract: readStub(chain),
    writeContract: async () => FAKE_TX,
    waitForTransactionReceipt: async () => ({ status: "success" }),
  };
}

/** Mock GasFree relayer; balance is read via the signer (shared chain state). */
function relayer() {
  return {
    getAddressInfo: async () => ({
      accountAddress: addr(PAYER_PK),
      gasFreeAddress: GASFREE_ADDR,
      active: true,
      allowSubmit: true,
      nonce: 4,
      assets: [
        {
          tokenAddress: USDT,
          tokenSymbol: "USDT",
          transferFee: "10000",
          activateFee: "0",
          decimal: 6,
          frozen: 0,
        },
      ],
    }),
    getProviders: async () => [{ address: PROVIDER }],
    getNonce: async () => 4,
    getStatus: async () => null,
    waitForSuccess: async () => ({ txnHash: FAKE_TX }) as never,
    submit: async () => "trace-1",
  };
}

/**
 * Simulate the server building the 402 `accepts` entry for a scheme/network.
 *
 * @param server - The server scheme.
 * @param facilitator - The facilitator scheme (supplies supported `extra`).
 * @param scheme - The payment scheme string.
 * @returns The negotiated payment requirements.
 */
async function negotiate(
  server: { parsePrice: Function; enhancePaymentRequirements: Function },
  facilitator: { getExtra: (n: string) => Record<string, unknown> | undefined },
  scheme: string,
): Promise<PaymentRequirements> {
  const amount = await server.parsePrice("1 USDT", NETWORK);
  const supportedExtra = facilitator.getExtra(NETWORK) ?? {};
  const base = {
    scheme,
    network: NETWORK,
    asset: amount.asset,
    amount: amount.amount,
    payTo: PAY_TO,
    maxTimeoutSeconds: 600,
    extra: amount.extra ?? {},
  } as unknown as PaymentRequirements;
  return server.enhancePaymentRequirements(
    base,
    { x402Version: 2, scheme, network: NETWORK, extra: supportedExtra },
    [],
  );
}

/**
 * Build a PaymentPayload from a client scheme and negotiated requirements.
 *
 * @param client - The client scheme.
 * @param req - The negotiated payment requirements.
 * @returns The assembled payment payload.
 */
async function pay(
  client: { createPaymentPayload: Function },
  req: PaymentRequirements,
): Promise<PaymentPayload> {
  const result = await client.createPaymentPayload(2, req, { extensions: {} });
  return {
    x402Version: 2,
    accepted: req,
    payload: result.payload,
    extensions: result.extensions,
  } as unknown as PaymentPayload;
}

describe("GasFree end-to-end (in-process)", () => {
  const feeConfig = { feeTo: PROVIDER, baseFee: { USDT: "10000" } };

  async function wire(chain: Chain) {
    const api = { [NETWORK]: relayer() as never };
    return {
      server: new GasFreeServer(),
      facilitator: new GasFreeFacilitator(facilitatorSigner(chain), api, feeConfig),
      client: new GasFreeClient(await clientSigner(chain), { apiClients: api }),
    };
  }

  it("negotiates fee, signs, verifies, and settles", async () => {
    const chain: Chain = { balance: 10_000_000n, allowance: 0n };
    const { server, facilitator, client } = await wire(chain);

    const req = await negotiate(server, facilitator, "exact_gasfree");
    expect((req.extra?.fee as { feeTo: string }).feeTo).toBe(PROVIDER);
    expect(req.extra?.name).toBe("Tether USD"); // server injects token metadata

    const payload = await pay(client, req);
    const gf = payload.payload as ExactGasFreePayload;
    expect(gf.gasfree.serviceProvider).toBe(PROVIDER);
    expect(gf.gasfree.value).toBe("1000000");
    expect(gf.gasfree.maxFee).toBe("10000");
    expect(gf.gasfreeAddress).toBe(GASFREE_ADDR);

    const verify = await facilitator.verify(payload, req);
    expect(verify.isValid).toBe(true);

    const settle = await facilitator.settle(payload, req);
    expect(settle.success).toBe(true);
    expect(settle.transaction).toBe(FAKE_TX);
  });

  it("rejects a tampered amount at verify (bad signature)", async () => {
    const chain: Chain = { balance: 10_000_000n, allowance: 0n };
    const { server, facilitator, client } = await wire(chain);
    const req = await negotiate(server, facilitator, "exact_gasfree");
    const payload = await pay(client, req);
    const gf = payload.payload as ExactGasFreePayload;
    gf.gasfree = { ...gf.gasfree, value: "2000000" }; // >= amount, but not what was signed

    const verify = await facilitator.verify(payload, req);
    expect(verify.isValid).toBe(false);
    expect(verify.invalidReason).toBe("invalid_gasfree_signature");
  });

  it("fails settle when the GasFree wallet balance is insufficient", async () => {
    const chain: Chain = { balance: 10_000_000n, allowance: 0n };
    const { server, facilitator, client } = await wire(chain);
    const req = await negotiate(server, facilitator, "exact_gasfree");
    const payload = await pay(client, req); // signs while funded

    // Wallet drained between signing and settle.
    chain.balance = 100n;

    // verify passes (no balance check); settle preflight fails.
    const verify = await facilitator.verify(payload, req);
    expect(verify.isValid).toBe(true);
    const settle = await facilitator.settle(payload, req);
    expect(settle.success).toBe(false);
    expect(settle.errorReason).toBe("insufficient_funds");
  });

  it("rejects an expired permit before signature checks", async () => {
    const chain: Chain = { balance: 10_000_000n, allowance: 0n };
    const { server, facilitator } = await wire(chain);
    const req = await negotiate(server, facilitator, "exact_gasfree");
    const expired: ExactGasFreePayload = {
      signature: "0xdead",
      gasfreeAddress: GASFREE_ADDR,
      gasfree: {
        token: USDT,
        serviceProvider: PROVIDER,
        user: addr(PAYER_PK),
        receiver: PAY_TO,
        value: "1000000",
        maxFee: "10000",
        deadline: String(Math.floor(Date.now() / 1000) - 10),
        version: "1",
        nonce: "4",
      },
    };
    const verify = await facilitator.verify(
      { x402Version: 2, accepted: req, payload: expired } as unknown as PaymentPayload,
      req,
    );
    expect(verify.invalidReason).toBe("gasfree_expired");
  });
});

describe("Permit2 (exact) end-to-end (in-process)", () => {
  async function wire(chain: Chain) {
    return {
      server: new ExactServer(),
      facilitator: new ExactFacilitator(facilitatorSigner(chain)),
      client: new ExactClient(await clientSigner(chain)),
    };
  }

  it("negotiates permit2, signs, verifies, and settles", async () => {
    const chain: Chain = { balance: 10_000_000n, allowance: 10_000_000n };
    const { server, facilitator, client } = await wire(chain);

    const req = await negotiate(server, facilitator, "exact");
    expect(req.extra?.assetTransferMethod).toBe("permit2");
    expect(req.extra?.permit2FacilitatorAddress).toBe(addr(FAC_PK));

    const payload = await pay(client, req);
    const p = payload.payload as ExactPermit2Payload;
    expect(p.permit2Authorization.permitted.amount).toBe("1000000");
    expect(Object.keys(p.permit2Authorization.witness).sort()).toEqual(["to", "validAfter"]);

    const verify = await facilitator.verify(payload, req);
    expect(verify.isValid).toBe(true);

    const settle = await facilitator.settle(payload, req);
    expect(settle.success).toBe(true);
    expect(settle.transaction).toBe(FAKE_TX);
  });

  it("rejects insufficient Permit2 allowance at verify", async () => {
    const chain: Chain = { balance: 10_000_000n, allowance: 0n };
    const { server, facilitator, client } = await wire(chain);
    const req = await negotiate(server, facilitator, "exact");
    const payload = await pay(client, req);

    const verify = await facilitator.verify(payload, req);
    expect(verify.isValid).toBe(false);
    expect(verify.invalidReason).toBe("permit2_allowance_required");
  });

  it("rejects a recipient mismatch at verify", async () => {
    const chain: Chain = { balance: 10_000_000n, allowance: 10_000_000n };
    const { server, facilitator, client } = await wire(chain);
    const req = await negotiate(server, facilitator, "exact");
    const payload = await pay(client, req);

    const tampered = { ...req, payTo: GASFREE_ADDR } as PaymentRequirements;
    const verify = await facilitator.verify(payload, tampered);
    expect(verify.isValid).toBe(false);
    expect(verify.invalidReason).toBe("invalid_permit2_recipient_mismatch");
  });
});

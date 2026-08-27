import { describe, expect, it, vi } from "vitest";
import { TronWeb, utils as tronUtils } from "tronweb";

import { UptoTronScheme as UptoServer } from "../../src/upto/server/scheme";
import { UptoTronScheme as UptoFacilitator } from "../../src/upto/facilitator/scheme";
import { UptoTronScheme as UptoClient } from "../../src/upto/client/scheme";
import {
  createClientTronSigner,
  createFacilitatorTronSigner,
  type ClientTronSigner,
  type FacilitatorTronSigner,
} from "../../src/signer";
import { buildTronWeb } from "../../src/rpc";
import { privateKeyTronWallet } from "./helpers";
import { uptoPermit2WitnessTypes, X402_UPTO_PERMIT2_PROXY_ADDRESSES } from "../../src/constants";
import { TRC20_APPROVAL_RESOURCE_SPONSORING_KEY } from "../../src/shared/extensions/trc20ApprovalContract";

// The signer factories build TronWeb internally; mock that builder so each signer
// gets a TronWeb seeded with its own key (set right before each create call).
vi.mock("../../src/rpc", () => ({ buildTronWeb: vi.fn() }));
import { normalizeAddressForSigning } from "../../src/utils";
import type { UptoPermit2Payload } from "../../src/types";
import type { PaymentPayload, PaymentRequirements } from "@bankofai/x402-core/types";

/**
 * In-process integration tests for the TRON `upto` scheme (no HTTP).
 *
 * Wires the real server, client, and facilitator upto schemes together in the
 * x402 order — getExtra → enhancePaymentRequirements → createPaymentPayload →
 * verify → settle — proving the 3-field (facilitator-bound) witness and the
 * variable settlement amount (≤ authorized maximum) behave end to end. Only
 * chain I/O is stubbed, keeping the suite offline and deterministic.
 */

const NETWORK = "tron:0xcd8690dc";
const PAYER_PK = "da146374a75310b9666e834ee4ad0866d6f4035967bfc76217c5a495fff9f0d0";
const FAC_PK = "b71c71a67e1177ad4e901695e1b4b9ee17ae16c6668d313eac2f96dbcda3f291";
const PAY_TO = "TJRyWwFs9wTFGZg3JbrVriFbNfCug5tDeC";
const FAKE_TX = "0x" + "11".repeat(32);

const addr = (pk: string): string => TronWeb.address.fromPrivateKey(pk) as string;
const OTHER_ADDR = addr("0000000000000000000000000000000000000000000000000000000000000003");

/** Mutable on-chain state shared by the stubbed signer reads. */
interface Chain {
  balance: bigint;
  allowance: bigint;
}

/** Captures the args of the most recent writeContract call. */
interface WriteCapture {
  args?: readonly unknown[];
}

function tron(pk: string): TronWeb {
  return new TronWeb({ fullHost: "https://nile.trongrid.io", privateKey: pk });
}

function readStub(chain: Chain) {
  return async (args: { functionName: string }) =>
    args.functionName === "allowance" ? chain.allowance : chain.balance;
}

async function clientSigner(chain: Chain): Promise<ClientTronSigner> {
  const tw = tron(PAYER_PK);
  vi.mocked(buildTronWeb).mockReturnValue(tw);
  // allowanceMode "skip": these flow tests stub chain reads and exercise the
  // facilitator path, not the client's auto-approve (covered by client-allowance).
  const base = await createClientTronSigner(privateKeyTronWallet(tw, PAYER_PK), {
    network: NETWORK,
    allowanceMode: "skip",
  });
  return { ...base, readContract: readStub(chain) };
}

async function facilitatorSigner(
  chain: Chain,
  capture?: WriteCapture,
): Promise<FacilitatorTronSigner> {
  vi.mocked(buildTronWeb).mockReturnValue(tron(FAC_PK));
  const wallet = { getAddress: () => addr(FAC_PK), signTransaction: async () => ({}) };
  return {
    ...(await createFacilitatorTronSigner(wallet, { network: NETWORK })),
    readContract: readStub(chain),
    writeContract: async (args: { args: readonly unknown[] }) => {
      if (capture) capture.args = args.args;
      return FAKE_TX;
    },
    waitForTransactionReceipt: async () => ({ status: "success" }),
  };
}

async function negotiate(
  server: UptoServer,
  facilitator: UptoFacilitator,
): Promise<PaymentRequirements> {
  const amount = await server.parsePrice("1 USDT", NETWORK);
  const supportedExtra = facilitator.getExtra(NETWORK) ?? {};
  const base = {
    scheme: "upto",
    network: NETWORK,
    asset: amount.asset,
    amount: amount.amount,
    payTo: PAY_TO,
    maxTimeoutSeconds: 600,
    extra: amount.extra ?? {},
  } as unknown as PaymentRequirements;
  return server.enhancePaymentRequirements(
    base,
    { x402Version: 2, scheme: "upto", network: NETWORK, extra: supportedExtra },
    [],
  );
}

async function pay(client: UptoClient, req: PaymentRequirements): Promise<PaymentPayload> {
  const result = await client.createPaymentPayload(2, req, { extensions: {} });
  return {
    x402Version: 2,
    accepted: req,
    payload: result.payload,
  } as unknown as PaymentPayload;
}

async function wire(chain: Chain, capture?: WriteCapture) {
  return {
    server: new UptoServer(),
    facilitator: new UptoFacilitator(await facilitatorSigner(chain, capture)),
    client: new UptoClient(await clientSigner(chain)),
  };
}

describe("upto Permit2 end-to-end (in-process)", () => {
  it("returns a sponsored Approval for the authorized maximum when allowance is zero", async () => {
    const chain: Chain = { balance: 10_000_000n, allowance: 0n };
    const { server, facilitator } = await wire(chain);
    const req = await negotiate(server, facilitator);
    const baseSigner = await clientSigner(chain);
    const signPermit2Approval = vi.fn(async () => "0a02abcd");
    const ensureAllowance = vi.fn(async () => true);
    const client = new UptoClient({
      ...baseSigner,
      signPermit2Approval,
      ensureAllowance,
    });

    const result = await client.createPaymentPayload(2, req, {
      extensions: {
        [TRC20_APPROVAL_RESOURCE_SPONSORING_KEY]: {
          info: { version: "1" },
        },
      },
    });

    expect(signPermit2Approval).toHaveBeenCalledWith({
      token: req.asset,
      network: NETWORK,
      minimumLifetimeSeconds: 300,
    });
    expect(ensureAllowance).not.toHaveBeenCalled();
    expect(result.extensions?.[TRC20_APPROVAL_RESOURCE_SPONSORING_KEY]).toMatchObject({
      info: { from: baseSigner.address, asset: req.asset, signedTransaction: "0a02abcd" },
    });
  });

  it("negotiates the facilitator address and signs a 3-field witness", async () => {
    const chain: Chain = { balance: 10_000_000n, allowance: 10_000_000n };
    const { server, facilitator, client } = await wire(chain);

    const req = await negotiate(server, facilitator);
    expect(req.extra?.assetTransferMethod).toBe("permit2");
    expect(req.extra?.permit2FacilitatorAddress).toBe(addr(FAC_PK));

    const payload = await pay(client, req);
    const p = payload.payload as UptoPermit2Payload;
    expect(p.permit2Authorization.permitted.amount).toBe("1000000");
    expect(Object.keys(p.permit2Authorization.witness).sort()).toEqual([
      "facilitator",
      "to",
      "validAfter",
    ]);
    // The witness binds the settling facilitator's address.
    expect(normalizeAddressForSigning(p.permit2Authorization.witness.facilitator)).toBe(
      normalizeAddressForSigning(addr(FAC_PK)),
    );
    // Spender is the deployed upto proxy.
    expect(normalizeAddressForSigning(p.permit2Authorization.spender)).toBe(
      normalizeAddressForSigning(X402_UPTO_PERMIT2_PROXY_ADDRESSES[NETWORK]),
    );
  });

  it("verifies and settles the full authorized amount", async () => {
    const chain: Chain = { balance: 10_000_000n, allowance: 10_000_000n };
    const capture: WriteCapture = {};
    const { server, facilitator, client } = await wire(chain, capture);

    const req = await negotiate(server, facilitator);
    const payload = await pay(client, req);

    const verify = await facilitator.verify(payload, req);
    expect(verify.isValid).toBe(true);

    const settle = await facilitator.settle(payload, req);
    expect(settle.success).toBe(true);
    expect(settle.transaction).toBe(FAKE_TX);
    expect(settle.amount).toBe("1000000");
    // settle(permit, amount, owner, witness, signature) — amount is the 2nd arg.
    expect(capture.args?.[1]).toBe(1_000_000n);
  });

  it("settles a partial amount below the authorized maximum", async () => {
    const chain: Chain = { balance: 10_000_000n, allowance: 10_000_000n };
    const capture: WriteCapture = {};
    const { server, facilitator, client } = await wire(chain, capture);

    const req = await negotiate(server, facilitator); // amount = max = 1_000_000
    const payload = await pay(client, req);

    // Resource server settles for less than the authorized maximum.
    const settleReq = { ...req, amount: "400000" } as PaymentRequirements;
    const settle = await facilitator.settle(payload, settleReq);

    expect(settle.success).toBe(true);
    expect(settle.amount).toBe("400000");
    expect(capture.args?.[1]).toBe(400_000n);
  });

  it("treats a zero settlement as a successful no-op (no on-chain tx)", async () => {
    const chain: Chain = { balance: 10_000_000n, allowance: 10_000_000n };
    const capture: WriteCapture = {};
    const { server, facilitator, client } = await wire(chain, capture);

    const req = await negotiate(server, facilitator);
    const payload = await pay(client, req);

    const settle = await facilitator.settle(payload, {
      ...req,
      amount: "0",
    } as PaymentRequirements);
    expect(settle.success).toBe(true);
    expect(settle.transaction).toBe("");
    expect(settle.amount).toBe("0");
    expect(capture.args).toBeUndefined(); // no writeContract call
  });

  it("rejects a settlement that exceeds the authorized maximum", async () => {
    const chain: Chain = { balance: 10_000_000n, allowance: 10_000_000n };
    const { server, facilitator, client } = await wire(chain);

    const req = await negotiate(server, facilitator); // max = 1_000_000
    const payload = await pay(client, req);

    const settle = await facilitator.settle(payload, {
      ...req,
      amount: "2000000",
    } as PaymentRequirements);
    expect(settle.success).toBe(false);
    expect(settle.errorReason).toBe("upto_settlement_exceeds_amount");
  });

  it("rejects a witness bound to a different facilitator", async () => {
    const chain: Chain = { balance: 10_000_000n, allowance: 10_000_000n };
    // Facilitator signs with FAC_PK but the payload's witness names OTHER_ADDR.
    const { server, facilitator, client } = await wire(chain);
    const req = await negotiate(server, facilitator);

    // Re-sign a payload whose witness facilitator is someone else.
    const tamperedReq = {
      ...req,
      extra: {
        ...req.extra,
        permit2FacilitatorAddress: OTHER_ADDR,
      },
    } as PaymentRequirements;
    const payload = await pay(client, tamperedReq);

    const verify = await facilitator.verify(payload, req);
    expect(verify.isValid).toBe(false);
    expect(verify.invalidReason).toBe("invalid_permit2_facilitator");
  });

  it("rejects insufficient Permit2 allowance at verify", async () => {
    const chain: Chain = { balance: 10_000_000n, allowance: 0n };
    const { server, facilitator, client } = await wire(chain);
    const req = await negotiate(server, facilitator);
    const payload = await pay(client, req);

    const verify = await facilitator.verify(payload, req);
    expect(verify.isValid).toBe(false);
    expect(verify.invalidReason).toBe("permit2_allowance_required");
  });

  it("fails closed on a malformed sponsored Approval after upto authorization validation", async () => {
    const chain: Chain = { balance: 10_000_000n, allowance: 10_000_000n };
    const { server, facilitator, client } = await wire(chain);
    const req = await negotiate(server, facilitator);
    const payload = await pay(client, req);
    payload.extensions = {
      [TRC20_APPROVAL_RESOURCE_SPONSORING_KEY]: { info: { version: "1" } },
    };

    const verify = await facilitator.verify(payload, req, {
      getExtension: vi.fn(() => undefined),
    });

    expect(verify).toMatchObject({
      isValid: false,
      invalidReason: "approval_extension_invalid",
    });
  });

  it("rejects a recipient mismatch at verify", async () => {
    const chain: Chain = { balance: 10_000_000n, allowance: 10_000_000n };
    const { server, facilitator, client } = await wire(chain);
    const req = await negotiate(server, facilitator);
    const payload = await pay(client, req);

    const tampered = { ...req, payTo: OTHER_ADDR } as PaymentRequirements;
    const verify = await facilitator.verify(payload, tampered);
    expect(verify.isValid).toBe(false);
    expect(verify.invalidReason).toBe("invalid_permit2_recipient_mismatch");
  });

  it("client signature recovers to the payer over the 3-field witness", async () => {
    const chain: Chain = { balance: 10_000_000n, allowance: 10_000_000n };
    const { server, facilitator, client } = await wire(chain);
    const req = await negotiate(server, facilitator);
    const payload = await pay(client, req);
    const { permit2Authorization: auth, signature } = payload.payload as UptoPermit2Payload;

    const domain = {
      name: "Permit2",
      chainId: 3448148188,
      verifyingContract: normalizeAddressForSigning("TYQuuhGbEMxF7nZxUHV3uHJxAVVAegNU9h"),
    };
    const message = {
      permitted: { token: auth.permitted.token, amount: BigInt(auth.permitted.amount) },
      spender: auth.spender,
      nonce: BigInt(auth.nonce),
      deadline: BigInt(auth.deadline),
      witness: {
        to: auth.witness.to,
        facilitator: auth.witness.facilitator,
        validAfter: BigInt(auth.witness.validAfter),
      },
    };
    const recovered = tronUtils.typedData.verifyTypedData(
      domain,
      uptoPermit2WitnessTypes,
      message,
      signature,
    );
    expect(normalizeAddressForSigning(recovered)).toBe(normalizeAddressForSigning(addr(PAYER_PK)));
  });
});

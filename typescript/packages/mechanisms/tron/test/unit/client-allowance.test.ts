import { describe, expect, it, vi } from "vitest";
import { TronWeb, utils as tronUtils } from "tronweb";
import {
  createClientTronSigner,
  type ClientTronWallet,
  type ClientTronSigner,
} from "../../src/signer";
import { buildTronWeb } from "../../src/rpc";
import { ExactTronScheme } from "../../src/exact/client/scheme";
import { PERMIT2_ADDRESSES } from "../../src/constants";
import { createTrc20ApprovalPolicy } from "../../src/approvalPolicy";

// The factory builds TronWeb internally from the network; mock that builder so
// tests inject a fake TronWeb (was previously passed as the first arg).
vi.mock("../../src/rpc", () => ({ buildTronWeb: vi.fn() }));

/**
 * Client-side auto-approve (Permit2 allowance), mirroring the Python client.
 *
 * TRON's mainstream tokens (USDT/USDD) lack ERC-3009, so they pay via permit2,
 * which needs a one-time `approve(Permit2, MAX_UINT256)`. `ensureAllowance`
 * reads the allowance and broadcasts that approve when (and only when) needed.
 */

const NETWORK = "tron:0xcd8690dc";
const OWNER = "TJRyWwFs9wTFGZg3JbrVriFbNfCug5tDeC";
const TOKEN = "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf"; // nile USDT
const PERMIT2 = PERMIT2_ADDRESSES[NETWORK]!;
const MAX_UINT256 = (1n << 256n) - 1n;
const APPROVAL_TX_ID = "cd".repeat(32);

function fakeTronWeb(opts: {
  allowance?: bigint;
  trigger?: ReturnType<typeof vi.fn>;
  broadcast?: ReturnType<typeof vi.fn>;
  txInfo?: ReturnType<typeof vi.fn>;
  allowanceSpy?: ReturnType<typeof vi.fn>;
}) {
  const allowanceMethod =
    opts.allowanceSpy ?? vi.fn(() => ({ call: async () => opts.allowance ?? 0n }));
  return {
    setAddress: vi.fn(),
    contract: vi.fn(async () => ({ methods: { allowance: allowanceMethod } })),
    transactionBuilder: { triggerSmartContract: opts.trigger ?? vi.fn() },
    trx: {
      sendRawTransaction: opts.broadcast ?? vi.fn(),
    },
    fullNode: { request: opts.txInfo ?? vi.fn() },
  } as never;
}

/** Build a client signer with the fake TronWeb routed through the mocked builder. */
async function makeClientSigner(
  tw: unknown,
  wallet: ClientTronWallet,
  options: Partial<Omit<Parameters<typeof createClientTronSigner>[1], "network">> = {},
): Promise<ClientTronSigner> {
  vi.mocked(buildTronWeb).mockReturnValue(tw as never);
  return createClientTronSigner(wallet, { network: NETWORK, ...options });
}

const typedWallet = (extra: Partial<ClientTronWallet> = {}): ClientTronWallet => ({
  getAddress: () => OWNER,
  signTypedData: async () => "0xsig" as `0x${string}`,
  ...extra,
});

describe("ClientTronSigner.ensureAllowance", () => {
  it("returns true without broadcasting when the allowance already covers the amount", async () => {
    const trigger = vi.fn();
    const wallet = typedWallet({ signTransaction: vi.fn() });
    const signer = await makeClientSigner(fakeTronWeb({ allowance: 2_000_000n, trigger }), wallet);

    const ok = await signer.ensureAllowance!({
      token: TOKEN,
      amount: 1_000_000n,
      network: NETWORK,
    });

    expect(ok).toBe(true);
    expect(trigger).not.toHaveBeenCalled();
    expect(wallet.signTransaction).not.toHaveBeenCalled();
  });

  it("broadcasts approve(Permit2, MAX_UINT256) when the allowance is insufficient", async () => {
    const trigger = vi.fn(async () => ({ result: { result: true }, transaction: { raw_data: 1 } }));
    const broadcast = vi.fn(async () => ({ result: true, txid: APPROVAL_TX_ID }));
    const txInfo = vi.fn(async () => ({ blockNumber: 1, receipt: { result: "SUCCESS" } }));
    const signTransaction = vi.fn(async (tx: Record<string, unknown>) => ({
      ...tx,
      signature: ["ab"],
    }));
    const wallet = typedWallet({ signTransaction });

    const signer = await makeClientSigner(
      fakeTronWeb({ allowance: 0n, trigger, broadcast, txInfo }),
      wallet,
    );

    const ok = await signer.ensureAllowance!({
      token: TOKEN,
      amount: 1_000_000n,
      network: NETWORK,
    });

    expect(ok).toBe(true);
    expect(trigger).toHaveBeenCalledWith(
      TOKEN,
      "approve(address,uint256)",
      expect.objectContaining({ feeLimit: 100_000_000, callValue: 0 }),
      [
        { type: "address", value: PERMIT2 },
        { type: "uint256", value: MAX_UINT256 },
      ],
      OWNER,
    );
    expect(signTransaction).toHaveBeenCalledWith({ raw_data: 1 });
    expect(broadcast).toHaveBeenCalledWith({ raw_data: 1, signature: ["ab"] });
  });

  it("fails closed for a partial allowance instead of overwriting it implicitly", async () => {
    const trigger = vi.fn();
    const signer = await makeClientSigner(
      fakeTronWeb({ allowance: 1n, trigger }),
      typedWallet({ signTransaction: vi.fn() }),
    );

    await expect(
      signer.ensureAllowance!({ token: TOKEN, amount: 1_000_000n, network: NETWORK }),
    ).rejects.toThrow("approval_reset_required");
    expect(trigger).not.toHaveBeenCalled();
  });

  it("overwrites a partial allowance only when the token policy explicitly permits it", async () => {
    const trigger = vi.fn(async () => ({ result: { result: true }, transaction: { raw_data: 1 } }));
    const broadcast = vi.fn(async () => ({ result: true, txid: APPROVAL_TX_ID }));
    const txInfo = vi.fn(async () => ({ blockNumber: 1, receipt: { result: "SUCCESS" } }));
    const signer = await makeClientSigner(
      fakeTronWeb({ allowance: 1n, trigger, broadcast, txInfo }),
      typedWallet({
        signTransaction: async tx => ({ ...tx, signature: ["ab"] }),
      }),
      {
        approvalPolicy: createTrc20ApprovalPolicy({
          strategies: { [NETWORK]: { [TOKEN]: "direct-overwrite" } },
        }),
      },
    );

    await expect(
      signer.ensureAllowance!({ token: TOKEN, amount: 1_000_000n, network: NETWORK }),
    ).resolves.toBe(true);
    expect(trigger).toHaveBeenCalledTimes(1);
  });

  it("rejects an unsupported token before asking the wallet to sign", async () => {
    const trigger = vi.fn();
    const wallet = typedWallet({ signTransaction: vi.fn() });
    const signer = await makeClientSigner(fakeTronWeb({ allowance: 0n, trigger }), wallet, {
      approvalPolicy: createTrc20ApprovalPolicy({
        strategies: { [NETWORK]: { [TOKEN]: "unsupported" } },
      }),
    });

    await expect(
      signer.ensureAllowance!({ token: TOKEN, amount: 1_000_000n, network: NETWORK }),
    ).rejects.toThrow("approval_asset_unsupported");
    expect(trigger).not.toHaveBeenCalled();
    expect(wallet.signTransaction).not.toHaveBeenCalled();
  });

  it("skips the read and broadcast entirely when mode is 'skip'", async () => {
    const allowanceSpy = vi.fn(() => ({ call: async () => 0n }));
    const trigger = vi.fn();
    const signer = await makeClientSigner(
      fakeTronWeb({ allowanceSpy, trigger }),
      typedWallet({ signTransaction: vi.fn() }),
    );

    const ok = await signer.ensureAllowance!({
      token: TOKEN,
      amount: 1_000_000n,
      network: NETWORK,
      mode: "skip",
    });

    expect(ok).toBe(true);
    expect(allowanceSpy).not.toHaveBeenCalled();
    expect(trigger).not.toHaveBeenCalled();
  });

  it("throws when an approve is needed but the wallet cannot sign transactions", async () => {
    const signer = await makeClientSigner(fakeTronWeb({ allowance: 0n }), typedWallet());

    await expect(
      signer.ensureAllowance!({ token: TOKEN, amount: 1_000_000n, network: NETWORK }),
    ).rejects.toThrow(/cannot sign transactions/);
  });

  it("lets a pre-approved sign-only wallet pass without signTransaction", async () => {
    const signer = await makeClientSigner(fakeTronWeb({ allowance: 5_000_000n }), typedWallet());

    const ok = await signer.ensureAllowance!({
      token: TOKEN,
      amount: 1_000_000n,
      network: NETWORK,
    });
    expect(ok).toBe(true);
  });

  it("throws when the approve transaction does not reach SUCCESS", async () => {
    const trigger = vi.fn(async () => ({ result: { result: true }, transaction: { raw_data: 1 } }));
    const broadcast = vi.fn(async () => ({ result: true, txid: APPROVAL_TX_ID }));
    const txInfo = vi.fn(async () => ({ blockNumber: 1, receipt: { result: "REVERT" } }));
    const wallet = typedWallet({ signTransaction: async tx => ({ ...tx, signature: ["ab"] }) });

    const signer = await makeClientSigner(
      fakeTronWeb({ allowance: 0n, trigger, broadcast, txInfo }),
      wallet,
    );

    await expect(
      signer.ensureAllowance!({ token: TOKEN, amount: 1_000_000n, network: NETWORK }),
    ).rejects.toThrow(/did not succeed/);
  });
});

describe("ClientTronSigner.signPermit2Approval", () => {
  it("extends the unsigned Approval before handing it to the wallet", async () => {
    const now = 1_800_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    let transactionToSign: Record<string, unknown> | undefined;
    const unsigned = {
      visible: false,
      raw_data: {
        contract: [
          {
            parameter: {
              value: {
                owner_address: TronWeb.address.toHex(OWNER),
                contract_address: TronWeb.address.toHex(TOKEN),
                data: "095ea7b3",
              },
              type_url: "type.googleapis.com/protocol.TriggerSmartContract",
            },
            type: "TriggerSmartContract",
          },
        ],
        ref_block_bytes: "1234",
        ref_block_hash: "0011223344556677",
        expiration: now + 60_000,
        timestamp: now,
        fee_limit: 100_000_000,
      },
    };
    const transactionPb = tronUtils.transaction.txJsonToPb(unsigned);
    const trigger = vi.fn(async () => ({
      result: { result: true },
      transaction: {
        ...unsigned,
        txID: tronUtils.transaction.txPbToTxID(transactionPb).replace(/^0x/, ""),
        raw_data_hex: tronUtils.transaction.txPbToRawDataHex(transactionPb),
      },
    }));
    const signTransaction = vi.fn(async (transaction: Record<string, unknown>) => {
      transactionToSign = transaction;
      throw new Error("wallet-stop");
    });
    const signer = await makeClientSigner(
      fakeTronWeb({ allowance: 0n, trigger }),
      typedWallet({ signTransaction }),
    );

    await expect(
      (
        signer.signPermit2Approval as unknown as (args: {
          token: string;
          network: string;
          minimumLifetimeSeconds: number;
        }) => Promise<string>
      )({ token: TOKEN, network: NETWORK, minimumLifetimeSeconds: 180 }),
    ).rejects.toThrow("wallet-stop");

    expect(
      (transactionToSign?.raw_data as { expiration: number }).expiration,
    ).toBeGreaterThanOrEqual(now + 180_000);
    vi.restoreAllMocks();
  });
});

describe("createPermit2Payload — allowance injection", () => {
  it("calls ensureAllowance with token, amount, and network before signing", async () => {
    const calls: string[] = [];
    const signer: ClientTronSigner = {
      address: OWNER,
      readContract: async () => 0n,
      signTypedData: vi.fn(async () => {
        calls.push("sign");
        return "0xsig" as `0x${string}`;
      }),
      ensureAllowance: vi.fn(async () => {
        calls.push("ensure");
        return true;
      }),
    };

    const requirements = {
      scheme: "exact",
      network: NETWORK,
      asset: TOKEN,
      amount: "1000000",
      payTo: OWNER,
      maxTimeoutSeconds: 600,
      extra: { assetTransferMethod: "permit2" },
    };

    await new ExactTronScheme(signer).createPaymentPayload(2, requirements as never);

    expect(signer.ensureAllowance).toHaveBeenCalledWith({
      token: TOKEN,
      amount: 1_000_000n, // amount only
      network: NETWORK,
    });
    // Allowance is ensured before the witness signature is produced.
    expect(calls).toEqual(["ensure", "sign"]);
  });
});

import { describe, expect, it, vi } from "vitest";
import { TronWeb } from "tronweb";
import { ExactGasFreeTronScheme as ClientScheme } from "../../src/gasfree/client/scheme";
import { ExactGasFreeTronScheme as FacilitatorScheme } from "../../src/gasfree/facilitator/scheme";
import type { ClientTronSigner, FacilitatorTronSigner } from "../../src/signer";
import type { ExactGasFreePayload } from "../../src/types";
import {
  GasFreeAPIClient,
  GasFreeTransactionStatusError,
  type GasFreeAddressInfo,
  type GasFreeProvider,
} from "../../src/shared/gasfree/api";
import { filterAffordableRequirements } from "../../src/shared/balance";

/**
 * GasFree client/facilitator behavior with mocked signers and relayer (F1).
 * Signature validity is covered by gasfree-digest; here verifyTypedData is
 * stubbed so term-validation and settle flow are isolated.
 */

const addr = (pk: string) => TronWeb.address.fromPrivateKey(pk) as string;
const NETWORK = "tron:3448148188";
const USER = addr("0000000000000000000000000000000000000000000000000000000000000001");
const PAY_TO = "TJRyWwFs9wTFGZg3JbrVriFbNfCug5tDeC";
const ASSET = "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf"; // Nile USDT (6 decimals)
const PROVIDER = addr("0000000000000000000000000000000000000000000000000000000000000002");
const GASFREE_ADDR = addr("0000000000000000000000000000000000000000000000000000000000000003");
const STRANGER = addr("0000000000000000000000000000000000000000000000000000000000000009");
const TX = "ab".repeat(32);

function account(overrides: Partial<GasFreeAddressInfo> = {}): GasFreeAddressInfo {
  return {
    accountAddress: USER,
    gasFreeAddress: GASFREE_ADDR,
    active: true,
    allowSubmit: true,
    nonce: 3,
    assets: [
      {
        tokenAddress: ASSET,
        tokenSymbol: "USDT",
        transferFee: "10000",
        activateFee: "0",
        decimal: 6,
        frozen: 0,
      },
    ],
    ...overrides,
  };
}

function clientSigner(balance = 10_000_000n): ClientTronSigner {
  return {
    address: USER,
    signTypedData: vi.fn(async () => "0xsig" as `0x${string}`),
    readContract: vi.fn(async () => balance),
  };
}

function facilitatorSigner(
  opts: { verify?: boolean; balance?: bigint } = {},
): FacilitatorTronSigner {
  return {
    getAddresses: () => [PROVIDER],
    readContract: vi.fn(async () => opts.balance ?? 10_000_000n),
    verifyTypedData: vi.fn(async () => opts.verify ?? true),
    writeContract: vi.fn(async () => "0x"),
    waitForTransactionReceipt: vi.fn(async () => ({ status: "success" })),
  };
}

function api(acct: GasFreeAddressInfo, extra: Record<string, unknown> = {}) {
  return {
    getAddressInfo: vi.fn(async () => acct),
    getProviders: vi.fn(async () => [{ address: PROVIDER }] as unknown as GasFreeProvider[]),
    getNonce: vi.fn(async () => acct.nonce),
    getStatus: vi.fn(async () => null),
    waitForSuccess: vi.fn(async () => ({ txnHash: TX }) as never),
    submit: vi.fn(async () => "trace-xyz"),
    ...extra,
  };
}

function requirements(extra: Record<string, unknown> = {}) {
  return {
    scheme: "exact_gasfree",
    network: NETWORK,
    asset: ASSET,
    amount: "1000",
    payTo: PAY_TO,
    maxTimeoutSeconds: 600,
    extra,
  } as never;
}

describe("GasFree client createPaymentPayload", () => {
  it("picks a provider from the relayer list and uses transferFee as maxFee", async () => {
    const a = api(account());
    const client = new ClientScheme(clientSigner(), { apiClients: { [NETWORK]: a as never } });
    const result = await client.createPaymentPayload(2, requirements(), {
      extensions: { skipBalanceCheck: true },
    });
    const p = result.payload as ExactGasFreePayload;
    expect(p.gasfree.serviceProvider).toBe(PROVIDER);
    // transferFee 10000
    expect(p.gasfree.maxFee).toBe("10000");
    expect(a.getProviders).toHaveBeenCalled();
  });

  it("defaults maxFee to 1 token when transferFee is unknown", async () => {
    const a = api(account({ assets: [] }));
    const client = new ClientScheme(clientSigner(), { apiClients: { [NETWORK]: a as never } });
    const result = await client.createPaymentPayload(2, requirements(), {
      extensions: { skipBalanceCheck: true },
    });
    const p = result.payload as ExactGasFreePayload;
    expect(p.gasfree.serviceProvider).toBe(PROVIDER);
    // no transferFee → default 1 token (10^6)
    expect(p.gasfree.maxFee).toBe("1000000");
    expect(a.getProviders).toHaveBeenCalled();
  });

  it("adds activateFee when the account is inactive", async () => {
    const acct = account({
      active: false,
      allowSubmit: true,
      assets: [
        {
          tokenAddress: ASSET,
          tokenSymbol: "USDT",
          transferFee: "10000",
          activateFee: "5000",
          decimal: 6,
          frozen: 0,
        },
      ],
    });
    const client = new ClientScheme(clientSigner(), {
      apiClients: { [NETWORK]: api(acct) as never },
    });
    const result = await client.createPaymentPayload(2, requirements(), {
      extensions: { skipBalanceCheck: true },
    });
    const p = result.payload as ExactGasFreePayload;
    expect(p.gasfree.maxFee).toBe("15000"); // 10000 + 5000 activate
  });

  it("throws when the account is not activated and cannot submit", async () => {
    const acct = account({ active: false, allowSubmit: false });
    const client = new ClientScheme(clientSigner(), {
      apiClients: { [NETWORK]: api(acct) as never },
    });
    await expect(client.createPaymentPayload(2, requirements())).rejects.toThrow(/not activated/);
  });

  it("throws on insufficient GasFree wallet balance", async () => {
    const client = new ClientScheme(clientSigner(500n), {
      apiClients: { [NETWORK]: api(account()) as never },
    });
    await expect(client.createPaymentPayload(2, requirements())).rejects.toThrow(
      /Insufficient balance/,
    );
  });

  it("uses the maximum window deadline when none is requested", async () => {
    const client = new ClientScheme(clientSigner(), {
      apiClients: { [NETWORK]: api(account()) as never },
    });
    const before = Math.floor(Date.now() / 1000);
    const result = await client.createPaymentPayload(2, requirements(), {
      extensions: { skipBalanceCheck: true },
    });
    const p = result.payload as ExactGasFreePayload;
    // tron:3448148188 max window = 3595s
    const deadline = Number(p.gasfree.deadline);
    expect(deadline).toBeGreaterThanOrEqual(before + 3590);
    expect(deadline).toBeLessThanOrEqual(before + 3595 + 2);
  });

  it("honors a caller-requested deadline within the allowed window", async () => {
    const client = new ClientScheme(clientSigner(), {
      apiClients: { [NETWORK]: api(account()) as never },
    });
    const requested = Math.floor(Date.now() / 1000) + 1000;
    const result = await client.createPaymentPayload(2, requirements(), {
      extensions: {
        skipBalanceCheck: true,
        paymentPermitContext: { meta: { validBefore: requested } },
      },
    });
    const p = result.payload as ExactGasFreePayload;
    expect(p.gasfree.deadline).toBe(String(requested));
  });

  it("clamps and warns when the requested deadline exceeds the window", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const client = new ClientScheme(clientSigner(), {
      apiClients: { [NETWORK]: api(account()) as never },
    });
    const before = Math.floor(Date.now() / 1000);
    const requested = before + 99999; // well past nile max (3595)
    const result = await client.createPaymentPayload(2, requirements(), {
      extensions: {
        skipBalanceCheck: true,
        paymentPermitContext: { meta: { validBefore: requested } },
      },
    });
    const p = result.payload as ExactGasFreePayload;
    expect(Number(p.gasfree.deadline)).toBeLessThanOrEqual(before + 3595 + 2);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("[x402] GasFree deadline clamped"));
    warn.mockRestore();
  });

  it("rejects a caller-requested deadline that is too soon", async () => {
    const client = new ClientScheme(clientSigner(), {
      apiClients: { [NETWORK]: api(account()) as never },
    });
    const requested = Math.floor(Date.now() / 1000) + 10; // below min (55)
    await expect(
      client.createPaymentPayload(2, requirements(), {
        extensions: {
          skipBalanceCheck: true,
          paymentPermitContext: { meta: { validBefore: requested } },
        },
      }),
    ).rejects.toThrow(/too soon/);
  });
});

describe("GasFree facilitator verify term validation", () => {
  function payload(over: Partial<ExactGasFreePayload["gasfree"]> = {}): ExactGasFreePayload {
    return {
      signature: "0xsig",
      gasfreeAddress: GASFREE_ADDR,
      gasfree: {
        token: ASSET,
        serviceProvider: PROVIDER,
        user: USER,
        receiver: PAY_TO,
        value: "1000",
        maxFee: "10000",
        deadline: String(Math.floor(Date.now() / 1000) + 300),
        version: "1",
        nonce: "3",
        ...over,
      },
    };
  }

  const fac = () =>
    new FacilitatorScheme(facilitatorSigner(), { [NETWORK]: api(account()) as never });

  it("accepts a well-formed payload", async () => {
    const p = payload();
    const r = await fac().verify({ accepted: requirements(), payload: p } as never, requirements());
    expect(r.isValid).toBe(true);
  });

  it("rejects amount below requirement", async () => {
    const p = payload({ value: "999" });
    const r = await fac().verify({ accepted: requirements(), payload: p } as never, requirements());
    expect(r.invalidReason).toBe("gasfree_amount_mismatch");
  });

  it("rejects payTo mismatch", async () => {
    const p = payload({ receiver: GASFREE_ADDR });
    const r = await fac().verify({ accepted: requirements(), payload: p } as never, requirements());
    expect(r.invalidReason).toBe("gasfree_payto_mismatch");
  });

  it("rejects an expired permit", async () => {
    const p = payload({ deadline: String(Math.floor(Date.now() / 1000) - 10) });
    const r = await fac().verify({ accepted: requirements(), payload: p } as never, requirements());
    expect(r.invalidReason).toBe("gasfree_expired");
  });

  it("rejects a provider not in the relayer list", async () => {
    const p = payload({ serviceProvider: STRANGER });
    const r = await fac().verify({ accepted: requirements(), payload: p } as never, requirements());
    expect(r.invalidReason).toBe("gasfree_fee_to_mismatch");
  });

  it("rejects when the relayer returns an empty provider list", async () => {
    const a = api(account(), { getProviders: vi.fn(async () => []) });
    const fac = new FacilitatorScheme(facilitatorSigner(), { [NETWORK]: a as never });
    const r = await fac.verify(
      { accepted: requirements(), payload: payload() } as never,
      requirements(),
    );
    expect(r.isValid).toBe(false);
    expect(r.invalidReason).toBe("gasfree_provider_list_unavailable");
  });

  it("rejects when the relayer API is unreachable", async () => {
    const a = api(account(), {
      getProviders: vi.fn(async () => {
        throw new Error("network timeout");
      }),
    });
    const fac = new FacilitatorScheme(facilitatorSigner(), { [NETWORK]: a as never });
    const r = await fac.verify(
      { accepted: requirements(), payload: payload() } as never,
      requirements(),
    );
    expect(r.isValid).toBe(false);
    expect(r.invalidReason).toBe("gasfree_provider_list_unavailable");
  });
});

describe("GasFree facilitator settle", () => {
  function goodPayload(): ExactGasFreePayload {
    return {
      signature: "0xsig",
      gasfreeAddress: GASFREE_ADDR,
      gasfree: {
        token: ASSET,
        serviceProvider: PROVIDER,
        user: USER,
        receiver: PAY_TO,
        value: "1000",
        maxFee: "10000",
        deadline: String(Math.floor(Date.now() / 1000) + 300),
        version: "1",
        nonce: "3",
      },
    };
  }

  it("submits to the relayer and returns the tx hash", async () => {
    const a = api(account());
    const fac = new FacilitatorScheme(facilitatorSigner(), { [NETWORK]: a as never });
    const r = await fac.settle(
      { accepted: requirements(), payload: goodPayload() } as never,
      requirements(),
    );
    expect(r.success).toBe(true);
    expect(r.transaction).toBe(TX);
    expect(a.submit).toHaveBeenCalledWith(goodPayload().gasfree, "0xsig");
  });

  it("rejects a malformed transaction hash returned as successful", async () => {
    const a = api(account(), {
      waitForSuccess: vi.fn(async () => ({ txnHash: "not-a-txid" }) as never),
    });
    const fac = new FacilitatorScheme(facilitatorSigner(), { [NETWORK]: a as never });

    const result = await fac.settle(
      { accepted: requirements(), payload: goodPayload() } as never,
      requirements(),
    );

    expect(result).toMatchObject({
      success: false,
      errorReason: "gasfree_invalid_transaction_hash",
      transaction: "",
    });
  });

  it("rejects a successful relayer response without a transaction hash", async () => {
    const a = api(account(), {
      waitForSuccess: vi.fn(async () => ({ state: "SUCCEED" }) as never),
    });
    const fac = new FacilitatorScheme(facilitatorSigner(), { [NETWORK]: a as never });

    const result = await fac.settle(
      { accepted: requirements(), payload: goodPayload() } as never,
      requirements(),
    );

    expect(result).toMatchObject({
      success: false,
      errorReason: "gasfree_missing_transaction_hash",
      transaction: "",
    });
  });

  it.each([false, true])(
    "rejects a malformed transaction hash carried by a polling error (terminal=%s)",
    async terminal => {
      const a = api(account(), {
        waitForSuccess: vi.fn(async () => {
          throw new GasFreeTransactionStatusError("status polling failed", "not-a-txid", terminal);
        }),
      });
      const fac = new FacilitatorScheme(facilitatorSigner(), { [NETWORK]: a as never });

      const result = await fac.settle(
        { accepted: requirements(), payload: goodPayload() } as never,
        requirements(),
      );

      expect(result).toMatchObject({
        success: false,
        errorReason: "gasfree_invalid_transaction_hash",
        transaction: "",
      });
    },
  );

  it("fails settle when verification fails", async () => {
    const fac = new FacilitatorScheme(facilitatorSigner({ verify: false }), {
      [NETWORK]: api(account()) as never,
    });
    const r = await fac.settle(
      { accepted: requirements(), payload: goodPayload() } as never,
      requirements(),
    );
    expect(r.success).toBe(false);
    expect(r.invalidReason ?? r.errorReason).toBe("invalid_gasfree_signature");
  });

  it("fails settle on insufficient GasFree wallet balance", async () => {
    const fac = new FacilitatorScheme(facilitatorSigner({ balance: 100n }), {
      [NETWORK]: api(account()) as never,
    });
    const r = await fac.settle(
      { accepted: requirements(), payload: goodPayload() } as never,
      requirements(),
    );
    expect(r.success).toBe(false);
    expect(r.errorReason).toBe("insufficient_funds");
  });

  it("returns settlement_pending with a relayer-known transaction hash", async () => {
    const a = api(account(), {
      waitForSuccess: vi.fn(async () => {
        throw new GasFreeTransactionStatusError("status polling failed", TX, false);
      }),
    });
    const fac = new FacilitatorScheme(facilitatorSigner(), { [NETWORK]: a as never });

    const result = await fac.settle(
      { accepted: requirements(), payload: goodPayload() } as never,
      requirements(),
    );

    expect(result).toMatchObject({
      success: false,
      errorReason: "settlement_pending",
      transaction: TX,
    });
  });

  it("preserves a relayer-known transaction hash for terminal failure", async () => {
    const a = api(account(), {
      waitForSuccess: vi.fn(async () => {
        throw new GasFreeTransactionStatusError("on-chain failure", TX, true);
      }),
    });
    const fac = new FacilitatorScheme(facilitatorSigner(), { [NETWORK]: a as never });

    const result = await fac.settle(
      { accepted: requirements(), payload: goodPayload() } as never,
      requirements(),
    );

    expect(result).toMatchObject({
      success: false,
      errorReason: "gasfree_transaction_failed",
      transaction: TX,
    });
  });
});

describe("GasFree status polling recovery metadata", () => {
  it("returns a successful status without waiting for a transaction hash", async () => {
    const client = new GasFreeAPIClient("https://example.invalid");
    const status = { state: "SUCCEED" };
    const getStatus = vi.spyOn(client, "getStatus").mockResolvedValue(status as never);

    await expect(client.waitForSuccess("trace-xyz", 1, 0)).resolves.toBe(status);
    expect(getStatus).toHaveBeenCalledOnce();
  });

  it("carries the last observed transaction hash through a later RPC failure", async () => {
    const client = new GasFreeAPIClient("https://example.invalid");
    vi.spyOn(client, "getStatus")
      .mockResolvedValueOnce({
        state: "CONFIRMING",
        txnState: "NOT_ON_CHAIN",
        txnHash: TX,
      } as never)
      .mockRejectedValueOnce(new Error("rpc unavailable"));

    await expect(client.waitForSuccess("trace-xyz", 10_000, 0, 1)).rejects.toMatchObject({
      name: "GasFreeTransactionStatusError",
      transaction: TX,
      terminal: false,
    });
  });
});

describe("GasFree estimateCost and affordability", () => {
  it("estimateCost returns amount + transferFee for an active account", async () => {
    const a = api(account());
    const client = new ClientScheme(clientSigner(), { apiClients: { [NETWORK]: a as never } });
    // amount 1000 + transferFee 10000 = 11000
    const cost = await client.estimateCost(requirements() as never);
    expect(cost).toBe(11000n);
  });

  it("estimateCost includes activateFee when the account is inactive", async () => {
    const acct = account({
      active: false,
      assets: [{ ...account().assets[0]!, activateFee: "5000" }],
    });
    const a = api(acct);
    const client = new ClientScheme(clientSigner(), { apiClients: { [NETWORK]: a as never } });
    // amount 1000 + transferFee 10000 + activateFee 5000 = 16000
    const cost = await client.estimateCost(requirements() as never);
    expect(cost).toBe(16000n);
  });

  it("filterAffordableRequirements excludes borderline GasFree option via estimateCost", async () => {
    // balance 10999 < amount(1000) + transferFee(10000) = 11000 → excluded
    const a = api(account());
    const client = new ClientScheme(clientSigner(10_999n), {
      apiClients: { [NETWORK]: a as never },
    });
    const out = await filterAffordableRequirements(client, [requirements() as never]);
    expect(out).toEqual([]);
  });

  it("filterAffordableRequirements keeps when balance covers amount + transferFee", async () => {
    // balance 11000 >= amount(1000) + transferFee(10000) = 11000 → kept
    const a = api(account());
    const client = new ClientScheme(clientSigner(11_000n), {
      apiClients: { [NETWORK]: a as never },
    });
    const out = await filterAffordableRequirements(client, [requirements() as never]);
    expect(out).toHaveLength(1);
  });
});

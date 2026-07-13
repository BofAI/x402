import { describe, expect, it, vi } from "vitest";
import type { PaymentRequirements } from "@bankofai/x402-core/types";
import {
  CheapestTokenSelectionStrategy,
  createCheapestTokenSelector,
} from "../../src/shared/tokenSelection";
import {
  filterAffordableRequirements,
  selectAffordableRequirement,
  type BalanceCheckable,
} from "../../src/shared/balance";

/**
 * Offline tests for TRON token selection and balance-aware filtering (F4).
 * No core changes: selection is a sync selector, affordability is async helpers.
 */

const NETWORK = "tron:0xcd8690dc";
const USDT = "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf"; // 6 decimals
const USDD = "TGjgvdTWWrybVLaVeFqSyVqJQWjxqRYbaK"; // 18 decimals

function req(
  asset: string,
  amount: string,
  extra: Record<string, unknown> = {},
): PaymentRequirements {
  return {
    scheme: "exact" as string,
    network: NETWORK,
    asset,
    amount,
    payTo: "TJRyWwFs9wTFGZg3JbrVriFbNfCug5tDeC",
    maxTimeoutSeconds: 60,
    extra,
  } as unknown as PaymentRequirements;
}

function gasfreeReq(
  asset: string,
  amount: string,
  extra: Record<string, unknown> = {},
): PaymentRequirements {
  return {
    ...req(asset, amount, extra),
    scheme: "exact_gasfree",
  } as unknown as PaymentRequirements;
}

describe("CheapestTokenSelectionStrategy", () => {
  const strat = new CheapestTokenSelectionStrategy();

  it("normalizes by decimals: 1 USDD (1e18) beats 2 USDT (2e6)", () => {
    const chosen = strat.select([req(USDT, "2000000"), req(USDD, "1000000000000000000")]);
    expect(chosen.asset).toBe(USDD); // 1.0 < 2.0
  });

  it("picks the cheaper USDT when amounts favor it", () => {
    const chosen = strat.select([req(USDT, "500000"), req(USDD, "1000000000000000000")]);
    expect(chosen.asset).toBe(USDT); // 0.5 < 1.0
  });

  it("throws on empty input", () => {
    expect(() => strat.select([])).toThrow(/No payment options/);
  });
});

describe("createCheapestTokenSelector", () => {
  it("returns a sync selector usable by x402Client", () => {
    const selector = createCheapestTokenSelector();
    const chosen = selector(2, [req(USDT, "2000000"), req(USDD, "500000000000000000")]);
    expect(chosen.asset).toBe(USDD); // 0.5 < 2.0
  });
});

describe("filterAffordableRequirements", () => {
  it("ignores stale extra.fee for exact scheme — only amount matters", async () => {
    const scheme: BalanceCheckable = {
      checkBalance: vi.fn(async (asset: string) => (asset === USDT ? 1_500_000n : 0n)),
    };
    const accepts = [
      req(USDT, "1000000", { fee: { feeTo: "T", feeAmount: "100000" } }), // stale fee ignored; need 1.0, have 1.5 → ok
      req(USDD, "1000000000000000000"), // have 0 → out
    ];
    const out = await filterAffordableRequirements(scheme, accepts);
    expect(out.map(r => r.asset)).toEqual([USDT]);
  });

  it("keeps an exact option when balance covers amount but not stale fee", async () => {
    const scheme: BalanceCheckable = { checkBalance: vi.fn(async () => 1_050_000n) };
    const out = await filterAffordableRequirements(scheme, [
      req(USDT, "1000000", { fee: { feeTo: "T", feeAmount: "100000" } }), // need 1.1, have 1.05
    ]);
    // exact ignores the stale fee: 1.05 >= 1.0 → affordable
    expect(out.map(r => r.asset)).toEqual([USDT]);
  });

  it("includes fee for exact_gasfree — enforced relayer fee", async () => {
    const scheme: BalanceCheckable = { checkBalance: vi.fn(async () => 1_050_000n) };
    // GasFree enforces fee: need 1.1, have 1.05 → excluded
    const out = await filterAffordableRequirements(scheme, [
      gasfreeReq(USDT, "1000000", { fee: { feeTo: "T", feeAmount: "100000" } }),
    ]);
    expect(out).toEqual([]);
  });

  it("keeps exact_gasfree when balance covers amount + fee", async () => {
    const scheme: BalanceCheckable = { checkBalance: vi.fn(async () => 1_200_000n) };
    // GasFree: need 1.1, have 1.2 → ok
    const out = await filterAffordableRequirements(scheme, [
      gasfreeReq(USDT, "1000000", { fee: { feeTo: "T", feeAmount: "100000" } }),
    ]);
    expect(out.map(r => r.asset)).toEqual([USDT]);
  });

  it("keeps a requirement when checkBalance throws", async () => {
    const scheme: BalanceCheckable = {
      checkBalance: vi.fn(async () => {
        throw new Error("rpc down");
      }),
    };
    const out = await filterAffordableRequirements(scheme, [req(USDT, "1000000")]);
    expect(out.map(r => r.asset)).toEqual([USDT]);
  });
});

describe("selectAffordableRequirement", () => {
  it("returns the cheapest affordable option", async () => {
    const scheme: BalanceCheckable = {
      checkBalance: vi.fn(async () => 10_000_000_000_000_000_000n), // plenty of both
    };
    const chosen = await selectAffordableRequirement(scheme, [
      req(USDT, "2000000"),
      req(USDD, "1000000000000000000"),
    ]);
    expect(chosen?.asset).toBe(USDD); // 1.0 < 2.0
  });

  it("returns undefined when nothing is affordable", async () => {
    const scheme: BalanceCheckable = { checkBalance: vi.fn(async () => 0n) };
    const chosen = await selectAffordableRequirement(scheme, [req(USDT, "2000000")]);
    expect(chosen).toBeUndefined();
  });
});

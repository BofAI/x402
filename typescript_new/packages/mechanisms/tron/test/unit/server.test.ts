import { describe, expect, it } from "vitest";
import { ExactTronScheme } from "../../src/exact/server/scheme";
import { TRON_MAINNET_USDT } from "../../src/constants";
import { ASSET } from "./helpers";

describe("Exact TRON server scheme", () => {
  it("converts mainnet dollar prices to USDT atomic units", async () => {
    const parsed = await new ExactTronScheme().parsePrice("$1.25", "tron:mainnet");
    expect(parsed).toEqual({ amount: "1250000", asset: TRON_MAINNET_USDT, extra: {} });
  });

  it("passes through explicit TRC-20 asset amounts", async () => {
    const parsed = await new ExactTronScheme().parsePrice(
      { amount: "1000", asset: ASSET },
      "tron:shasta",
    );
    expect(parsed).toEqual({ amount: "1000", asset: ASSET, extra: {} });
  });

  it("requires a configured default asset on testnets", async () => {
    await expect(new ExactTronScheme().parsePrice("$1.00", "tron:shasta")).rejects.toThrow(
      "No default TRC-20 asset configured",
    );
  });
});

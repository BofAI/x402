import { describe, expect, it } from "vitest";
import { ExactNanoScheme } from "../../src/exact/server";
import { PAY_TO, requirements } from "./helpers";

const NETWORK = "nano:mainnet" as const;

describe("ExactNanoScheme server", () => {
  it("declares the upfront payment flow", () => {
    const scheme = new ExactNanoScheme();
    expect(scheme.scheme).toBe("exact");
    expect(scheme.defaultAssetTransferMethod).toBe("default");
    expect(scheme.paymentFlows.default).toEqual({ supported: ["upfront"], default: "upfront" });
  });

  it("prices XNO amounts in raw", async () => {
    const scheme = new ExactNanoScheme();
    expect(await scheme.parsePrice("0.001 XNO", NETWORK)).toEqual({
      amount: "1000000000000000000000000000",
      asset: "XNO",
      extra: {},
    });
    expect(await scheme.parsePrice("2 xno", NETWORK)).toMatchObject({
      amount: "2000000000000000000000000000000",
    });
  });

  it("refuses an XNO price with a 31st decimal", async () => {
    await expect(
      new ExactNanoScheme().parsePrice("0.0000000000000000000000000000001 XNO", NETWORK),
    ).rejects.toThrow(/30 decimals/);
  });

  it("passes raw AssetAmounts through after validating them", async () => {
    const scheme = new ExactNanoScheme();
    expect(await scheme.parsePrice({ amount: "1", asset: "XNO" }, NETWORK)).toEqual({
      amount: "1",
      asset: "XNO",
      extra: {},
    });
    await expect(scheme.parsePrice({ amount: "0.5", asset: "XNO" }, NETWORK)).rejects.toThrow();
    await expect(scheme.parsePrice({ amount: "1", asset: "USDC" }, NETWORK)).rejects.toThrow(/XNO/);
  });

  it("needs a money parser for dollar prices", async () => {
    const scheme = new ExactNanoScheme();
    await expect(scheme.parsePrice("$0.01", NETWORK)).rejects.toThrow(/money parser/);
    await expect(scheme.parsePrice("1 USDT", NETWORK)).rejects.toThrow(/USDT/);

    scheme.registerMoneyParser(async () => null);
    scheme.registerMoneyParser(async amount => ({
      amount: (BigInt(Math.round(Number(amount) * 100)) * 10n ** 28n).toString(),
      asset: "XNO",
    }));
    expect(await scheme.parsePrice("$0.01", NETWORK)).toEqual({
      amount: "10000000000000000000000000000",
      asset: "XNO",
    });
  });

  it("reports 30 decimals for XNO only", () => {
    const scheme = new ExactNanoScheme();
    expect(scheme.getAssetDecimals("XNO", NETWORK)).toBe(30);
    expect(scheme.getAssetDecimals("USDT", NETWORK)).toBeUndefined();
  });

  it("checks payTo when building requirements", async () => {
    const scheme = new ExactNanoScheme();
    const kind = { x402Version: 2, scheme: "exact", network: NETWORK };
    await expect(scheme.enhancePaymentRequirements(requirements(), kind, [])).resolves.toEqual(
      requirements(),
    );
    await expect(
      scheme.enhancePaymentRequirements(
        requirements({ payTo: PAY_TO.slice(0, -1) + "y" }),
        kind,
        [],
      ),
    ).rejects.toThrow(/payTo/);
  });
});

import { describe, it, expect } from "vitest";
import { ExactTronScheme } from "../../src/exact/server/scheme";
import { UptoTronScheme } from "../../src/upto/server/scheme";
import { BatchSettlementTronScheme } from "../../src/batch-settlement/server/scheme";

// tron:0xcd8690dc USDT is 6 decimals
const NILE = "tron:0xcd8690dc";
const USDT_NILE = "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf";
const USDD_NILE = "TGjgvdTWWrybVLaVeFqSyVqJQWjxqRYbaK";

describe("ExactTronScheme (Server) - money conversion", () => {
  const server = new ExactTronScheme();

  it("converts a normal price to token units", async () => {
    const result = await server.parsePrice("$0.001", NILE);
    expect(result.amount).toBe("1000"); // 0.001 * 1e6
  });

  it("converts the smallest representable price (6 decimals boundary)", async () => {
    const result = await server.parsePrice("$0.000001", NILE);
    expect(result.amount).toBe("1"); // 0.000001 * 1e6 = 1
  });

  it("throws when the price is too small to represent in 6 decimals", async () => {
    await expect(server.parsePrice("$0.0000001", NILE)).rejects.toThrow("too small");
    await expect(server.parsePrice(0.0000001, NILE)).rejects.toThrow("too small");
  });

  it("throws on scientific notation that survives parsing", async () => {
    // numberToDecimalString converts 1e-7 -> "0.0000001", which is then too small
    await expect(server.parsePrice(1e-7, NILE)).rejects.toThrow();
  });
});

describe("UptoTronScheme (Server) - money conversion", () => {
  const server = new UptoTronScheme();

  it("converts a normal price to token units", async () => {
    const result = await server.parsePrice("$0.001", NILE);
    expect(result.amount).toBe("1000"); // 0.001 * 1e6
  });

  it("throws when the price is too small to represent in 6 decimals", async () => {
    await expect(server.parsePrice("$0.0000001", NILE)).rejects.toThrow("too small");
  });
});

describe.each([
  ["exact", () => new ExactTronScheme()],
  ["upto", () => new UptoTronScheme()],
  ["batch-settlement", () => new BatchSettlementTronScheme("TReceiver")],
])("%s TRON server - money conversion", (_scheme, createServer) => {
  it.each([["1 USD"], ["$1 USD"]])("uses the default asset for %s", async price => {
    const result = await createServer().parsePrice(price, NILE);

    expect(result).toMatchObject({
      amount: "1000000",
      asset: USDT_NILE,
    });
  });

  it.each([["1 USDD"], ["$1 USDD"]])("preserves the token symbol in %s", async price => {
    const result = await createServer().parsePrice(price, NILE);

    expect(result).toMatchObject({
      amount: "1000000000000000000",
      asset: USDD_NILE,
    });
  });

  it("rejects an unknown token instead of using the default asset", async () => {
    await expect(createServer().parsePrice("$1 WBTC", NILE)).rejects.toThrow(/Unknown token/);
  });

  it("rejects positive amounts below the default asset precision", async () => {
    await expect(createServer().parsePrice("$0.0000001", NILE)).rejects.toThrow("too small");
  });
});

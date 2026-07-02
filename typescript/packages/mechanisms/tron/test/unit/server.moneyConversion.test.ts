import { describe, it, expect } from "vitest";
import { ExactTronScheme } from "../../src/exact/server/scheme";
import { UptoTronScheme } from "../../src/upto/server/scheme";

// tron:nile USDT is 6 decimals
const NILE = "tron:nile";

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

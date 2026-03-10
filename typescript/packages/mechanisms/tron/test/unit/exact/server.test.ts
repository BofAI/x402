import { describe, it, expect, beforeEach } from "vitest";
import { ExactTronScheme } from "../../../src/exact/server/scheme";

describe("ExactTronScheme (Server)", () => {
  let server: ExactTronScheme;

  beforeEach(() => {
    server = new ExactTronScheme();
  });

  describe("Construction", () => {
    it("should create instance with correct scheme", () => {
      expect(server.scheme).toBe("exact");
    });
  });

  describe("parsePrice", () => {
    it("should pass through AssetAmount directly", async () => {
      const result = await server.parsePrice(
        { amount: "1000000", asset: "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf", extra: { custom: "data" } },
        "tron:nile",
      );

      expect(result.amount).toBe("1000000");
      expect(result.asset).toBe("TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf");
      expect(result.extra).toEqual({ custom: "data" });
    });

    it("should throw when AssetAmount has no asset", async () => {
      await expect(
        server.parsePrice({ amount: "1000000", asset: "", extra: {} }, "tron:nile"),
      ).rejects.toThrow("Asset address must be specified");
    });

    it("should parse numeric money to USDT on Nile", async () => {
      const result = await server.parsePrice(1.5, "tron:nile");

      expect(result.amount).toBe("1500000");
      expect(result.asset).toBe("TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf");
      expect(result.extra).toEqual({ name: "Tether USD", version: "1" });
    });

    it("should parse string money amount", async () => {
      const result = await server.parsePrice("2.00", "tron:nile");
      expect(result.amount).toBe("2000000");
    });

    it("should parse dollar string amount", async () => {
      const result = await server.parsePrice("$1.50", "tron:nile");
      expect(result.amount).toBe("1500000");
    });

    it("should throw on invalid money format", async () => {
      await expect(server.parsePrice("invalid", "tron:nile")).rejects.toThrow("Invalid money format");
    });

    it("should throw on unsupported network", async () => {
      await expect(server.parsePrice(1.0, "tron:unknown")).rejects.toThrow("No default asset configured");
    });

    it("should use Shasta USDT for tron:shasta", async () => {
      const result = await server.parsePrice(1.0, "tron:shasta");
      expect(result.asset).toBe("TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs");
    });

    it("should use mainnet USDT for tron:mainnet", async () => {
      const result = await server.parsePrice(1.0, "tron:mainnet");
      expect(result.asset).toBe("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t");
    });

    it("should use custom money parser when registered", async () => {
      server.registerMoneyParser(async (amount, _network) => ({
        amount: (amount * 100).toString(),
        asset: "CUSTOM_TOKEN",
        extra: {},
      }));

      const result = await server.parsePrice(1.5, "tron:nile");
      expect(result.amount).toBe("150");
      expect(result.asset).toBe("CUSTOM_TOKEN");
    });

    it("should fall through custom parser returning null", async () => {
      server.registerMoneyParser(async () => null);
      const result = await server.parsePrice(1.0, "tron:nile");
      expect(result.asset).toBe("TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf");
    });
  });

  describe("enhancePaymentRequirements", () => {
    const baseRequirements = {
      scheme: "exact",
      network: "tron:nile",
      amount: "1000000",
      asset: "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf",
      payTo: "TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs",
      maxTimeoutSeconds: 300,
      extra: { name: "Tether USD", version: "1" },
    };

    it("should pass through when no facilitator extra", async () => {
      const result = await server.enhancePaymentRequirements(
        baseRequirements,
        { x402Version: 2, scheme: "exact", network: "tron:nile" },
        [],
      );
      expect(result).toEqual(baseRequirements);
    });

    it("should set default assetTransferMethod from facilitator supportedMethods", async () => {
      const result = await server.enhancePaymentRequirements(
        baseRequirements,
        {
          x402Version: 2,
          scheme: "exact",
          network: "tron:nile",
          extra: { supportedAssetTransferMethods: ["tip712", "permit2"] },
        },
        [],
      );
      expect(result.extra?.assetTransferMethod).toBe("tip712");
    });

    it("should not override existing assetTransferMethod", async () => {
      const reqsWithMethod = {
        ...baseRequirements,
        extra: { ...baseRequirements.extra, assetTransferMethod: "permit2" },
      };
      const result = await server.enhancePaymentRequirements(
        reqsWithMethod,
        {
          x402Version: 2,
          scheme: "exact",
          network: "tron:nile",
          extra: { supportedAssetTransferMethods: ["tip712", "permit2"] },
        },
        [],
      );
      expect(result.extra?.assetTransferMethod).toBe("permit2");
    });

    it("should use first method if tip712 not in supported list", async () => {
      const result = await server.enhancePaymentRequirements(
        baseRequirements,
        {
          x402Version: 2,
          scheme: "exact",
          network: "tron:nile",
          extra: { supportedAssetTransferMethods: ["permit2"] },
        },
        [],
      );
      expect(result.extra?.assetTransferMethod).toBe("permit2");
    });

    it("should pass through when supportedAssetTransferMethods is empty", async () => {
      const result = await server.enhancePaymentRequirements(
        baseRequirements,
        {
          x402Version: 2,
          scheme: "exact",
          network: "tron:nile",
          extra: { supportedAssetTransferMethods: [] },
        },
        [],
      );
      expect(result).toEqual(baseRequirements);
    });
  });

  describe("registerMoneyParser chaining", () => {
    it("should return the instance for chaining", () => {
      const result = server.registerMoneyParser(async () => null);
      expect(result).toBe(server);
    });
  });
});

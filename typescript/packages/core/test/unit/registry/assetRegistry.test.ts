import { describe, it, expect } from "vitest";
import { AssetRegistry, convertMoney } from "../../../src/registry/index.js";
import type { AssetInfo } from "../../../src/registry/index.js";
import type { Network } from "../../../src/types/index.js";

describe("AssetRegistry", () => {
  describe("built-in assets", () => {
    it("should have USDC and USDT on Ethereum mainnet", () => {
      const registry = new AssetRegistry();
      const usdc = registry.resolve("eip155:1" as Network, "USDC");
      expect(usdc.address).toBe("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
      expect(usdc.decimals).toBe(6);
      expect(usdc.assetTransferMethod).toBeUndefined();

      const usdt = registry.resolve("eip155:1" as Network, "USDT");
      expect(usdt.assetTransferMethod).toBe("permit2");
    });

    it("should have BSC Mainnet tokens with permit2", () => {
      const registry = new AssetRegistry();
      const usdc = registry.resolve("eip155:56" as Network, "USDC");
      expect(usdc.address).toBe("0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d");
      expect(usdc.decimals).toBe(18);
      expect(usdc.assetTransferMethod).toBe("permit2");
      expect(usdc.supportsEip2612).toBeUndefined();

      const usdt = registry.resolve("eip155:56" as Network, "USDT");
      expect(usdt.address).toBe("0x55d398326f99059fF775485246999027B3197955");
      expect(usdt.assetTransferMethod).toBe("permit2");

      expect(registry.has("eip155:56" as Network, "EPS")).toBe(true);
    });

    it("should have BSC Testnet tokens with permit2", () => {
      const registry = new AssetRegistry();
      expect(registry.has("eip155:97" as Network, "USDT")).toBe(true);
      expect(registry.has("eip155:97" as Network, "USDC")).toBe(true);
      expect(registry.has("eip155:97" as Network, "DHLU")).toBe(true);
      const dhlu = registry.resolve("eip155:97" as Network, "DHLU");
      expect(dhlu.decimals).toBe(6);
      expect(dhlu.assetTransferMethod).toBe("permit2");
    });

    it("should have TRON mainnet tokens with correct transfer methods", () => {
      const registry = new AssetRegistry();
      const usdt = registry.resolve("tron:mainnet" as Network, "USDT");
      expect(usdt.address).toBe("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t");
      expect(usdt.decimals).toBe(6);
      expect(usdt.assetTransferMethod).toBe("permit2");

      const usdd = registry.resolve("tron:mainnet" as Network, "USDD");
      expect(usdd.decimals).toBe(18);
      expect(usdd.supportsEip2612).toBe(true);
      expect(usdd.assetTransferMethod).toBeUndefined();
    });

    it("should have TRON testnet tokens", () => {
      const registry = new AssetRegistry();
      expect(registry.has("tron:shasta" as Network, "USDT")).toBe(true);
      expect(registry.has("tron:nile" as Network, "USDT")).toBe(true);
      expect(registry.has("tron:nile" as Network, "USDD")).toBe(true);
    });

    it("should have correct defaults for BSC and TRON", () => {
      const registry = new AssetRegistry();
      expect(registry.getDefault("eip155:56" as Network).symbol).toBe("USDC");
      expect(registry.getDefault("eip155:97" as Network).symbol).toBe("USDT");
      expect(registry.getDefault("tron:mainnet" as Network).symbol).toBe("USDT");
      expect(registry.getDefault("tron:shasta" as Network).symbol).toBe("USDT");
      expect(registry.getDefault("tron:nile" as Network).symbol).toBe("USDT");
    });
  });

  describe("register", () => {
    it("should register and resolve a custom asset", () => {
      const registry = new AssetRegistry();
      const network = "eip155:1" as Network;
      const info: AssetInfo = {
        address: "0xCustomToken",
        decimals: 18,
      };
      registry.register(network, "WETH", info);
      expect(registry.resolve(network, "WETH")).toEqual(info);
    });

    it("should register on a new network", () => {
      const registry = new AssetRegistry();
      const network = "eip155:999" as Network;
      registry.register(network, "FOO", { address: "0xFoo", decimals: 8 });
      expect(registry.has(network, "FOO")).toBe(true);
    });
  });

  describe("registerAll", () => {
    it("should batch-register multiple assets", () => {
      const registry = new AssetRegistry();
      const network = "eip155:999" as Network;
      registry.registerAll(network, {
        AAA: { address: "0xAAA", decimals: 6 },
        BBB: { address: "0xBBB", decimals: 18 },
      });
      expect(registry.has(network, "AAA")).toBe(true);
      expect(registry.has(network, "BBB")).toBe(true);
    });
  });

  describe("setDefault / getDefault", () => {
    it("should set and get default asset", () => {
      const registry = new AssetRegistry();
      const result = registry.getDefault("eip155:1" as Network);
      expect(result.symbol).toBe("USDC");
      expect(result.info.address).toBe("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
    });

    it("should throw if setting default for unregistered asset", () => {
      const registry = new AssetRegistry();
      expect(() => registry.setDefault("eip155:1" as Network, "NONEXISTENT")).toThrow(
        /not registered/,
      );
    });

    it("should throw for network with no default", () => {
      const registry = new AssetRegistry();
      const network = "eip155:999" as Network;
      registry.register(network, "FOO", { address: "0xFoo", decimals: 6 });
      expect(() => registry.getDefault(network)).toThrow(/No default/);
    });
  });

  describe("resolve", () => {
    it("should throw for unregistered symbol", () => {
      const registry = new AssetRegistry();
      expect(() => registry.resolve("eip155:1" as Network, "NONEXISTENT")).toThrow(
        /not registered/,
      );
    });

    it("should throw for unregistered network", () => {
      const registry = new AssetRegistry();
      expect(() => registry.resolve("eip155:999999" as Network, "USDC")).toThrow(/not registered/);
    });
  });

  describe("getSymbols", () => {
    it("should list symbols for a network", () => {
      const registry = new AssetRegistry();
      const symbols = registry.getSymbols("eip155:1" as Network);
      expect(symbols).toContain("USDC");
      expect(symbols).toContain("USDT");
    });

    it("should return empty for unknown network", () => {
      const registry = new AssetRegistry();
      expect(registry.getSymbols("eip155:999999" as Network)).toEqual([]);
    });
  });

  describe("has", () => {
    it("should return true for registered asset", () => {
      const registry = new AssetRegistry();
      expect(registry.has("eip155:1" as Network, "USDC")).toBe(true);
    });

    it("should return false for unregistered asset", () => {
      const registry = new AssetRegistry();
      expect(registry.has("eip155:1" as Network, "WETH")).toBe(false);
    });
  });
});

describe("convertMoney", () => {
  it("should convert dollar string to 6-decimal token amount", () => {
    expect(convertMoney("$1.50", 6)).toBe("1500000");
  });

  it("should convert number to 6-decimal token amount", () => {
    expect(convertMoney(1.5, 6)).toBe("1500000");
  });

  it("should convert to 18-decimal token amount", () => {
    expect(convertMoney("$1.50", 18)).toBe("1500000000000000000");
  });

  it("should handle integer prices", () => {
    expect(convertMoney("$1", 6)).toBe("1000000");
    expect(convertMoney(1, 6)).toBe("1000000");
  });

  it("should handle small amounts", () => {
    expect(convertMoney("$0.001", 6)).toBe("1000");
  });

  it("should handle zero", () => {
    expect(convertMoney(0, 6)).toBe("0");
    expect(convertMoney("$0", 6)).toBe("0");
  });

  it("should throw for invalid format", () => {
    expect(() => convertMoney("abc", 6)).toThrow(/Invalid money format/);
  });
});

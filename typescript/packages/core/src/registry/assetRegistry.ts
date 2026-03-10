import { Network } from "../types/index.js";

/**
 * Information about a token asset on a specific network.
 */
export interface AssetInfo {
  /** Additional metadata */
  [key: string]: unknown;
  /** Token contract address */
  address: string;
  /** Number of decimal places */
  decimals: number;
  /** Human-readable token name (used in EIP-712 domain) */
  name?: string;
  /** Token version string (used in EIP-712 domain) */
  version?: string;
  /** Transfer method identifier (e.g. "permit2") */
  assetTransferMethod?: string;
  /** Whether the token supports EIP-2612 permit */
  supportsEip2612?: boolean;
}

/**
 * Registry of known token assets across networks.
 * Provides symbol-based lookup for token metadata.
 */
export class AssetRegistry {
  private assets: Map<string, Map<string, AssetInfo>> = new Map();
  private defaults: Map<string, string> = new Map();

  /** Creates a new AssetRegistry pre-populated with built-in token data. */
  constructor() {
    this.registerBuiltins();
  }

  /**
   * Register a single asset for a network.
   *
   * @param network - The network identifier (e.g. "eip155:1")
   * @param symbol - The token symbol (e.g. "USDT")
   * @param info - Asset metadata
   */
  register(network: Network, symbol: string, info: AssetInfo): void {
    if (!this.assets.has(network)) {
      this.assets.set(network, new Map());
    }
    this.assets.get(network)!.set(symbol, info);
  }

  /**
   * Batch-register multiple assets for a network.
   *
   * @param network - The network identifier
   * @param assets - Map of symbol to AssetInfo
   */
  registerAll(network: Network, assets: Record<string, AssetInfo>): void {
    for (const [symbol, info] of Object.entries(assets)) {
      this.register(network, symbol, info);
    }
  }

  /**
   * Set the default asset symbol for a network.
   *
   * @param network - The network identifier
   * @param symbol - The symbol to set as default
   */
  setDefault(network: Network, symbol: string): void {
    if (!this.has(network, symbol)) {
      throw new Error(
        `Cannot set default: asset "${symbol}" is not registered on network "${network}"`,
      );
    }
    this.defaults.set(network, symbol);
  }

  /**
   * Resolve a symbol to its AssetInfo on a network.
   *
   * @param network - The network identifier
   * @param symbol - The token symbol
   * @returns The resolved AssetInfo
   * @throws If the asset is not registered
   */
  resolve(network: Network, symbol: string): AssetInfo {
    const networkAssets = this.assets.get(network);
    if (!networkAssets || !networkAssets.has(symbol)) {
      throw new Error(
        `Asset "${symbol}" is not registered on network "${network}". ` +
          `Available: ${networkAssets ? Array.from(networkAssets.keys()).join(", ") : "none"}`,
      );
    }
    return networkAssets.get(symbol)!;
  }

  /**
   * Get the default asset for a network.
   *
   * @param network - The network identifier
   * @returns The default symbol and its AssetInfo
   * @throws If no default is configured
   */
  getDefault(network: Network): { symbol: string; info: AssetInfo } {
    const symbol = this.defaults.get(network);
    if (!symbol) {
      throw new Error(`No default asset configured for network "${network}"`);
    }
    return { symbol, info: this.resolve(network, symbol) };
  }

  /**
   * List all registered symbols for a network.
   *
   * @param network - The network identifier
   * @returns Array of registered symbols
   */
  getSymbols(network: Network): string[] {
    const networkAssets = this.assets.get(network);
    return networkAssets ? Array.from(networkAssets.keys()) : [];
  }

  /**
   * Check if an asset is registered on a network.
   *
   * @param network - The network identifier
   * @param symbol - The token symbol
   * @returns True if the asset is registered
   */
  has(network: Network, symbol: string): boolean {
    return this.assets.get(network)?.has(symbol) ?? false;
  }

  /**
   * Register built-in known assets.
   * Data sourced from EVM mechanism's getDefaultAsset() and x402-deprecated token registry.
   */
  private registerBuiltins(): void {
    // ── EVM Networks ──────────────────────────────────────────────

    // eip155:1 — Ethereum Mainnet
    this.registerAll("eip155:1" as Network, {
      USDC: {
        address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        decimals: 6,
        name: "USD Coin",
        version: "2",
      },
      USDT: {
        address: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
        decimals: 6,
        name: "Tether USD",
        version: "1",
        assetTransferMethod: "permit2",
      },
    });
    this.defaults.set("eip155:1", "USDC");

    // eip155:56 — BSC Mainnet (BEP-20, no EIP-3009/EIP-2612)
    this.registerAll("eip155:56" as Network, {
      USDC: {
        address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
        decimals: 18,
        name: "USD Coin",
        version: "1",
        assetTransferMethod: "permit2",
      },
      USDT: {
        address: "0x55d398326f99059fF775485246999027B3197955",
        decimals: 18,
        name: "Tether USD",
        version: "1",
        assetTransferMethod: "permit2",
      },
    });
    this.defaults.set("eip155:56", "USDC");

    // eip155:97 — BSC Testnet (BEP-20, no EIP-3009/EIP-2612)
    this.registerAll("eip155:97" as Network, {
      USDT: {
        address: "0x337610d27c682E347C9cD60BD4b3b107C9d34dDd",
        decimals: 18,
        name: "Tether USD",
        version: "1",
        assetTransferMethod: "permit2",
      },
      USDC: {
        address: "0x64544969ed7EBf5f083679233325356EbE738930",
        decimals: 18,
        name: "USD Coin",
        version: "1",
        assetTransferMethod: "permit2",
      },
    });
    this.defaults.set("eip155:97", "USDT");

    // ── TRON Networks ─────────────────────────────────────────────

    // tron:mainnet
    this.registerAll("tron:mainnet" as Network, {
      USDT: {
        address: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
        decimals: 6,
        name: "Tether USD",
        version: "1",
        assetTransferMethod: "permit2",
      },
      USDD: {
        address: "TXDk8mbtRbXeYuMNS83CfKPaYYT8XWv9Hz",
        decimals: 18,
        name: "Decentralized USD",
        version: "1",
        supportsEip2612: true,
      },
    });
    this.defaults.set("tron:mainnet", "USDT");

    // tron:shasta
    this.register("tron:shasta" as Network, "USDT", {
      address: "TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs",
      decimals: 6,
      name: "Tether USD",
      version: "1",
      assetTransferMethod: "permit2",
    });
    this.defaults.set("tron:shasta", "USDT");

    // tron:nile
    this.registerAll("tron:nile" as Network, {
      USDT: {
        address: "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf",
        decimals: 6,
        name: "Tether USD",
        version: "1",
        assetTransferMethod: "permit2",
      },
      USDD: {
        address: "TGjgvdTWWrybVLaVeFqSyVqJQWjxqRYbaK",
        decimals: 18,
        name: "Decentralized USD",
        version: "1",
        supportsEip2612: true,
      },
    });
    this.defaults.set("tron:nile", "USDT");
  }
}

/**
 * Convert a Money value (e.g., "$1.50", 1.5) to token smallest-unit string
 * using the given decimals.
 *
 * @param price - The price as a string or number
 * @param decimals - The number of decimal places for the token
 * @returns The amount in smallest units as a string
 */
export function convertMoney(price: string | number, decimals: number): string {
  const numericAmount =
    typeof price === "string" ? parseFloat(price.replace(/^\$/, "").trim()) : price;

  if (isNaN(numericAmount)) {
    throw new Error(`Invalid money format: ${price}`);
  }

  // Use string math to avoid floating point issues
  const [intPart, decPart = ""] = String(numericAmount).split(".");
  const paddedDec = decPart.padEnd(decimals, "0").slice(0, decimals);
  return (intPart + paddedDec).replace(/^0+/, "") || "0";
}

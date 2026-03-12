import {
  AssetAmount,
  Network,
  PaymentRequirements,
  Price,
  SchemeNetworkServer,
  MoneyParser,
} from "@bankofai/x402-core/types";

/**
 * TRON server implementation for the Exact payment scheme.
 */
export class ExactTronScheme implements SchemeNetworkServer {
  readonly scheme = "exact";
  private moneyParsers: MoneyParser[] = [];

  /**
   * Register a custom money parser in the parser chain.
   * Multiple parsers can be registered - they will be tried in registration order.
   * Each parser receives a decimal amount (e.g., 1.50 for $1.50).
   * If a parser returns null, the next parser in the chain will be tried.
   * The default parser is always the final fallback.
   *
   * @param parser - Custom function to convert amount to AssetAmount (or null to skip)
   * @returns The server instance for chaining
   *
   * @example
   * tronServer.registerMoneyParser(async (amount, network) => {
   *   // Custom conversion logic
   *   if (amount > 100) {
   *     // Use different token for large amounts
   *     return { amount: (amount * 1e6).toString(), asset: "TCustomToken" };
   *   }
   *   return null; // Use next parser
   * });
   */
  registerMoneyParser(parser: MoneyParser): ExactTronScheme {
    this.moneyParsers.push(parser);
    return this;
  }

  /**
   * Parses a price into an asset amount.
   * If price is already an AssetAmount, returns it directly.
   * If price is Money (string | number), parses to decimal and tries custom parsers.
   * Falls back to default conversion if all custom parsers return null.
   *
   * @param price - The price to parse
   * @param network - The network to use
   * @returns Promise that resolves to the parsed asset amount
   */
  async parsePrice(price: Price, network: Network): Promise<AssetAmount> {
    // If already an AssetAmount, return it directly
    if (typeof price === "object" && price !== null && "amount" in price) {
      if (!price.asset) {
        throw new Error(`Asset address must be specified for AssetAmount on network ${network}`);
      }
      return {
        amount: price.amount,
        asset: price.asset,
        extra: price.extra || {},
      };
    }

    // Parse Money to decimal number
    const amount = this.parseMoneyToDecimal(price);

    // Try each custom money parser in order
    for (const parser of this.moneyParsers) {
      const result = await parser(amount, network);
      if (result !== null) {
        return result;
      }
    }

    // All custom parsers returned null, use default conversion
    return this.defaultMoneyConversion(amount, network);
  }

  /**
   * Build payment requirements for this scheme/network combination.
   *
   * @param paymentRequirements - The base payment requirements
   * @param supportedKind - The supported kind from facilitator
   * @param supportedKind.x402Version - The x402 version
   * @param supportedKind.scheme - The logical payment scheme
   * @param supportedKind.network - The network identifier in CAIP-2 format
   * @param supportedKind.extra - Optional extra metadata regarding scheme/network implementation details
   * @param extensionKeys - Extension keys supported by the facilitator (unused)
   * @returns Payment requirements ready to be sent to clients
   */
  enhancePaymentRequirements(
    paymentRequirements: PaymentRequirements,
    supportedKind: {
      x402Version: number;
      scheme: string;
      network: Network;
      extra?: Record<string, unknown>;
    },
    extensionKeys: string[],
  ): Promise<PaymentRequirements> {
    void extensionKeys;

    const supportedMethods = supportedKind.extra?.supportedAssetTransferMethods as
      | string[]
      | undefined;
    const existingMethod = paymentRequirements.extra?.assetTransferMethod as string | undefined;
    const method =
      existingMethod ??
      (supportedMethods && supportedMethods.length > 0
        ? supportedMethods.includes("eip3009")
          ? "eip3009"
          : supportedMethods[0]
        : undefined);

    if (!method) {
      return Promise.resolve(paymentRequirements);
    }

    const permit2FacilitatorAddress =
      (paymentRequirements.extra?.permit2FacilitatorAddress as string | undefined) ??
      (supportedKind.extra?.permit2FacilitatorAddress as string | undefined);

    return Promise.resolve({
      ...paymentRequirements,
      extra: {
        ...paymentRequirements.extra,
        assetTransferMethod: method,
        ...(method === "permit2" && permit2FacilitatorAddress ? { permit2FacilitatorAddress } : {}),
      },
    });
  }

  /**
   * Parse Money (string | number) to a decimal number.
   * Handles formats like "$1.50", "1.50", 1.50, etc.
   *
   * @param money - The money value to parse
   * @returns Decimal number
   */
  private parseMoneyToDecimal(money: string | number): number {
    if (typeof money === "number") {
      return money;
    }

    // Remove $ sign and whitespace, then parse
    const cleanMoney = money.replace(/^\$/, "").trim();
    const amount = parseFloat(cleanMoney);

    if (isNaN(amount)) {
      throw new Error(`Invalid money format: ${money}`);
    }

    return amount;
  }

  /**
   * Default money conversion implementation.
   * Converts decimal amount to the default stablecoin on the specified network.
   *
   * @param amount - The decimal amount (e.g., 1.50)
   * @param network - The network to use
   * @returns The parsed asset amount in the default stablecoin
   */
  private defaultMoneyConversion(amount: number, network: Network): AssetAmount {
    const assetInfo = this.getDefaultAsset(network);
    const tokenAmount = this.convertToTokenAmount(amount.toString(), assetInfo.decimals);

    // TIP-712 tokens need name/version for TransferWithAuthorization domain.
    // Permit2-only tokens don't need them unless they also support TIP-712.
    const includeTIP712Domain = !assetInfo.assetTransferMethod;

    return {
      amount: tokenAmount,
      asset: assetInfo.address,
      extra: {
        ...(includeTIP712Domain && {
          name: assetInfo.name,
          version: assetInfo.version,
        }),
        ...(assetInfo.assetTransferMethod && {
          assetTransferMethod: assetInfo.assetTransferMethod,
        }),
      },
    };
  }

  /**
   * Convert decimal amount to token units (e.g., 0.10 -> 100000 for 6-decimal tokens)
   *
   * @param decimalAmount - The decimal amount to convert
   * @param decimals - The number of decimals for the token
   * @returns The token amount as a string
   */
  private convertToTokenAmount(decimalAmount: string, decimals: number): string {
    const amount = parseFloat(decimalAmount);
    if (isNaN(amount)) {
      throw new Error(`Invalid amount: ${decimalAmount}`);
    }
    // Convert to smallest unit (e.g., for USDT with 6 decimals: 0.10 * 10^6 = 100000)
    const [intPart, decPart = ""] = String(amount).split(".");
    const paddedDec = decPart.padEnd(decimals, "0").slice(0, decimals);
    const tokenAmount = (intPart + paddedDec).replace(/^0+/, "") || "0";
    return tokenAmount;
  }

  /**
   * Get the default asset info for a network (typically USDT)
   *
   * @param network - The network to get asset info for
   * @returns The asset information including address, name, version, and decimals
   */
  private getDefaultAsset(network: Network): {
    address: string;
    name: string;
    version: string;
    decimals: number;
    assetTransferMethod?: string;
  } {
    const stablecoins: Record<
      string,
      {
        address: string;
        name: string;
        version: string;
        decimals: number;
        assetTransferMethod?: string;
      }
    > = {
      "tron:nile": {
        address: "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf",
        name: "Tether USD",
        version: "1",
        decimals: 6,
        assetTransferMethod: "permit2",
      },
      "tron:shasta": {
        address: "TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs",
        name: "Tether USD",
        version: "1",
        decimals: 6,
      },
      "tron:mainnet": {
        address: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
        name: "Tether USD",
        version: "1",
        decimals: 6,
        assetTransferMethod: "permit2",
      },
    };

    const assetInfo = stablecoins[network];
    if (!assetInfo) {
      throw new Error(`No default asset configured for TRON network ${network}`);
    }

    return assetInfo;
  }
}

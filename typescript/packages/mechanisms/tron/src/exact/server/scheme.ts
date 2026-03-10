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
 * Handles price parsing and payment requirements for TRON TRC-20 tokens.
 */
export class ExactTronScheme implements SchemeNetworkServer {
  readonly scheme = "exact";
  private moneyParsers: MoneyParser[] = [];

  /**
   * Register a custom money parser in the parser chain.
   * Parsers are tried in registration order; return null to fall through.
   */
  registerMoneyParser(parser: MoneyParser): ExactTronScheme {
    this.moneyParsers.push(parser);
    return this;
  }

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

    // Fallback to default conversion
    return this.defaultMoneyConversion(amount, network);
  }

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
        ? supportedMethods.includes("tip712")
          ? "tip712"
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
        ...(method === "permit2" && permit2FacilitatorAddress
          ? { permit2FacilitatorAddress }
          : {}),
      },
    });
  }

  private parseMoneyToDecimal(money: string | number): number {
    if (typeof money === "number") {
      return money;
    }
    const cleanMoney = money.replace(/^\$/, "").trim();
    const amount = parseFloat(cleanMoney);
    if (isNaN(amount)) {
      throw new Error(`Invalid money format: ${money}`);
    }
    return amount;
  }

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

  private convertToTokenAmount(decimalAmount: string, decimals: number): string {
    const amount = parseFloat(decimalAmount);
    if (isNaN(amount)) {
      throw new Error(`Invalid amount: ${decimalAmount}`);
    }
    const [intPart, decPart = ""] = String(amount).split(".");
    const paddedDec = decPart.padEnd(decimals, "0").slice(0, decimals);
    const tokenAmount = (intPart + paddedDec).replace(/^0+/, "") || "0";
    return tokenAmount;
  }

  private getDefaultAsset(network: Network): {
    address: string;
    name: string;
    version: string;
    decimals: number;
    assetTransferMethod?: string;
  } {
    const stablecoins: Record<
      string,
      { address: string; name: string; version: string; decimals: number; assetTransferMethod?: string }
    > = {
      "tron:nile": {
        address: "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf",
        name: "Tether USD",
        version: "1",
        decimals: 6,
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
      },
    };

    const assetInfo = stablecoins[network];
    if (!assetInfo) {
      throw new Error(`No default asset configured for TRON network ${network}`);
    }

    return assetInfo;
  }
}

import {
  AssetAmount,
  Network,
  PaymentRequirements,
  Price,
  SchemeNetworkServer,
  MoneyParser,
} from "@bankofai/x402-core/types";
import { convertToTokenAmount, numberToDecimalString, parseMoneyString } from "@bankofai/x402-core/utils";
import { ExactDefaultAssetInfo, getDefaultAsset } from "../../shared/defaultAssets";
import { getDecimals, parsePrice as parseTokenPrice } from "../../shared/tokens";

/**
 * TRON server implementation for the Upto payment scheme.
 *
 * Price parsing mirrors the exact scheme. The key difference is
 * `enhancePaymentRequirements`, which surfaces the facilitator address the
 * client must bind into the upto witness and pins the transfer method to permit2.
 */
export class UptoTronScheme implements SchemeNetworkServer {
  readonly scheme = "upto";
  private moneyParsers: MoneyParser[] = [];

  /**
   * Register a custom money parser in the parser chain.
   * Parsers are tried in registration order; the default conversion is the fallback.
   *
   * @param parser - Custom function to convert amount to AssetAmount (or null to skip)
   * @returns The server instance for chaining
   */
  registerMoneyParser(parser: MoneyParser): UptoTronScheme {
    this.moneyParsers.push(parser);
    return this;
  }

  /**
   * Parses a price into an asset amount.
   *
   * @param price - The price to parse
   * @param network - The network to use
   * @returns Promise that resolves to the parsed asset amount
   */
  async parsePrice(price: Price, network: Network): Promise<AssetAmount> {
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

    // "<amount> <symbol>" form selects a specific registered token.
    if (typeof price === "string" && /^\s*\d+(\.\d+)?\s+\S+\s*$/.test(price)) {
      return parseTokenPrice(price.trim(), network);
    }

    const amount = this.parseMoneyToDecimal(price);

    for (const parser of this.moneyParsers) {
      const result = await parser(amount, network);
      if (result !== null) {
        return result;
      }
    }

    return this.defaultMoneyConversion(amount, network);
  }

  /**
   * Build payment requirements for the upto scheme.
   * Surfaces the facilitator address (required for the witness) and pins
   * `assetTransferMethod` to permit2.
   *
   * @param paymentRequirements - The base payment requirements
   * @param supportedKind - The supported kind from facilitator
   * @param supportedKind.x402Version - The x402 version
   * @param supportedKind.scheme - The logical payment scheme
   * @param supportedKind.network - The network identifier in CAIP-2 format
   * @param supportedKind.extra - Optional extra metadata from the facilitator
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

    const facilitatorAddress =
      (paymentRequirements.extra?.permit2FacilitatorAddress as string | undefined) ??
      (paymentRequirements.extra?.facilitatorAddress as string | undefined) ??
      (supportedKind.extra?.permit2FacilitatorAddress as string | undefined) ??
      (supportedKind.extra?.facilitatorAddress as string | undefined);

    return Promise.resolve({
      ...paymentRequirements,
      extra: {
        ...paymentRequirements.extra,
        assetTransferMethod: "permit2",
        ...(facilitatorAddress
          ? { facilitatorAddress, permit2FacilitatorAddress: facilitatorAddress }
          : {}),
      },
    });
  }

  /**
   * Return the decimal precision of an asset on a network.
   *
   * @param asset - The TRC-20 contract address.
   * @param network - The network identifier.
   * @returns Number of decimal places for the asset.
   */
  getAssetDecimals(asset: string, network: Network): number {
    return getDecimals(network, asset);
  }

  /**
   * Parse Money (string | number) to a decimal number.
   *
   * @param money - The money value to parse
   * @returns Decimal number
   */
  private parseMoneyToDecimal(money: string | number): number {
    if (typeof money === "number") {
      return money;
    }
    // Delegate to core's strict parser (rejects trailing garbage and scientific
    // notation) — mirrors the EVM exact server scheme.
    return parseMoneyString(money);
  }

  /**
   * Default money conversion: convert decimal amount to the default stablecoin.
   *
   * @param amount - The decimal amount (e.g., 1.50)
   * @param network - The network to use
   * @returns The parsed asset amount in the default stablecoin
   */
  private defaultMoneyConversion(amount: number, network: Network): AssetAmount {
    const assetInfo = this.getDefaultAsset(network);
    const tokenAmount = convertToTokenAmount(numberToDecimalString(amount), assetInfo.decimals);

    return {
      amount: tokenAmount,
      asset: assetInfo.address,
      extra: {
        assetTransferMethod: "permit2",
      },
    };
  }

  /**
   * Get the default asset info for a network (typically USDT).
   *
   * @param network - The network to get asset info for
   * @returns The asset information including address, name, version, and decimals
   */
  private getDefaultAsset(network: Network): ExactDefaultAssetInfo {
    return getDefaultAsset(network);
  }
}

import {
  AssetAmount,
  Network,
  PaymentFlowConfig,
  PaymentRequirements,
  Price,
  SchemeNetworkServer,
  MoneyParser,
} from "@bankofai/x402-core/types";
import { parseMoney } from "@bankofai/x402-core/utils";
import { ExactDefaultAssetInfo, getDefaultAsset } from "../../shared/defaultAssets";
import {
  convertToTokenAmount,
  getDecimals,
  parsePrice as parseTokenPrice,
} from "../../shared/tokens";
import type { AssetTransferMethod } from "../../types";

/**
 * TRON server implementation for the Exact payment scheme.
 */
export class ExactTronScheme implements SchemeNetworkServer {
  readonly scheme = "exact";
  readonly defaultAssetTransferMethod: AssetTransferMethod = "eip3009";
  readonly paymentFlows = {
    eip3009: { supported: ["authorization"], default: "authorization" },
    permit2: { supported: ["authorization"], default: "authorization" },
  } as const satisfies Record<AssetTransferMethod, PaymentFlowConfig>;
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

    const { amount, symbol } = parseMoney(price);
    if (symbol) {
      return parseTokenPrice(`${amount} ${symbol}`, network);
    }

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

    const extra = { ...paymentRequirements.extra };
    delete extra.fee;
    const requirementsWithoutFee = { ...paymentRequirements, extra };

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
      return Promise.resolve(requirementsWithoutFee);
    }

    const permit2FacilitatorAddress =
      (paymentRequirements.extra?.permit2FacilitatorAddress as string | undefined) ??
      (supportedKind.extra?.permit2FacilitatorAddress as string | undefined);

    return Promise.resolve({
      ...requirementsWithoutFee,
      extra: {
        ...extra,
        assetTransferMethod: method,
        ...(method === "permit2" && permit2FacilitatorAddress ? { permit2FacilitatorAddress } : {}),
      },
    });
  }

  /**
   * Return the decimal precision of an asset on a network.
   * Used by the resource server to convert dollar-format settlement overrides
   * to atomic units. Falls back to 6 when the token is not registered.
   *
   * @param asset - The TRC-20 contract address.
   * @param network - The network identifier.
   * @returns Number of decimal places for the asset.
   */
  getAssetDecimals(asset: string, network: Network): number {
    return getDecimals(network, asset);
  }

  /**
   * Default money conversion implementation.
   * Converts decimal amount to the default stablecoin on the specified network.
   *
   * @param amount - The decimal amount (e.g., 1.50)
   * @param network - The network to use
   * @returns The parsed asset amount in the default stablecoin
   */
  private defaultMoneyConversion(amount: string, network: Network): AssetAmount {
    const assetInfo = this.getDefaultAsset(network);
    const tokenAmount = convertToTokenAmount(amount, assetInfo.decimals);

    // TIP-712 (eip3009) tokens need name/version for the TransferWithAuthorization
    // domain. Permit2 tokens don't — except those that also support EIP-2612, where
    // the client needs name/version to sign a gasless permit() for the Permit2
    // approval (settleWithPermit). Mirrors the EVM exact server scheme.
    const includeTIP712Domain = !assetInfo.assetTransferMethod || !!assetInfo.supportsEip2612;

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
   * Get the default asset info for a network (typically USDT).
   * Delegates to the shared default-asset registry.
   *
   * @param network - The network to get asset info for
   * @returns The asset information including address, name, version, and decimals
   */
  private getDefaultAsset(network: Network): ExactDefaultAssetInfo {
    return getDefaultAsset(network);
  }
}

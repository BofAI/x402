import type {
  AssetAmount,
  MoneyParser,
  Network,
  PaymentRequirements,
  Price,
  SchemeNetworkServer,
} from "@x402/core/types";
import { convertToTokenAmount, numberToDecimalString, parseMoneyString } from "@x402/core/utils";
import { TRON_MAINNET_CAIP2, TRON_MAINNET_USDT, TRON_USDT_DECIMALS } from "../../constants";
import { assertSupportedTronNetwork, isValidTronAddress } from "../../utils";

/**
 * Default token configuration for money-string prices.
 */
export type TronDefaultAssetConfig = {
  asset: string;
  decimals: number;
};

/**
 * Server options for exact TRON payments.
 */
export type TronServerConfig = {
  defaultAssets?: Record<string, TronDefaultAssetConfig>;
};

/**
 * TRON server implementation for the Exact payment scheme.
 */
export class ExactTronScheme implements SchemeNetworkServer {
  readonly scheme = "exact";
  private moneyParsers: MoneyParser[] = [];

  /**
   * Creates an exact TRON server scheme.
   *
   * @param config - Server options
   */
  constructor(private readonly config: TronServerConfig = {}) {}

  /**
   * Registers a custom money parser.
   *
   * @param parser - Money parser
   * @returns This scheme
   */
  registerMoneyParser(parser: MoneyParser): ExactTronScheme {
    this.moneyParsers.push(parser);
    return this;
  }

  /**
   * Parses a price into a TRC-20 asset amount.
   *
   * @param price - Price input
   * @param network - TRON network
   * @returns Asset amount
   */
  async parsePrice(price: Price, network: Network): Promise<AssetAmount> {
    assertSupportedTronNetwork(network);

    if (typeof price === "object" && price !== null && "amount" in price) {
      if (!price.asset || !isValidTronAddress(price.asset)) {
        throw new Error(`Invalid TRC-20 contract address: ${price.asset}`);
      }
      return { amount: price.amount, asset: price.asset, extra: price.extra || {} };
    }

    const amount = typeof price === "number" ? price : parseMoneyString(price as string);
    for (const parser of this.moneyParsers) {
      const parsed = await parser(amount, network);
      if (parsed !== null) {
        return parsed;
      }
    }

    const defaultAsset = this.config.defaultAssets?.[network] ?? this.getBuiltInDefault(network);
    if (!defaultAsset) {
      throw new Error(
        `No default TRC-20 asset configured for network ${network}. Configure defaultAssets or provide explicit AssetAmount.`,
      );
    }
    if (!isValidTronAddress(defaultAsset.asset)) {
      throw new Error(`Invalid default TRC-20 contract address: ${defaultAsset.asset}`);
    }

    return {
      amount: convertToTokenAmount(numberToDecimalString(amount), defaultAsset.decimals),
      asset: defaultAsset.asset,
      extra: {},
    };
  }

  /**
   * Returns asset decimals when the asset is a configured default.
   *
   * @param asset - TRC-20 contract address
   * @param network - TRON network
   * @returns Asset decimal precision
   */
  getAssetDecimals(asset: string, network: Network): number {
    const configured = this.config.defaultAssets?.[network] ?? this.getBuiltInDefault(network);
    return configured?.asset === asset ? configured.decimals : 6;
  }

  /**
   * Returns payment requirements unchanged.
   *
   * @param paymentRequirements - Base payment requirements
   * @param supportedKind - Facilitator-supported kind
   * @param supportedKind.x402Version - x402 protocol version
   * @param supportedKind.scheme - Payment scheme
   * @param supportedKind.network - Network identifier
   * @param supportedKind.extra - Facilitator metadata
   * @param facilitatorExtensions - Facilitator extension keys
   * @returns Payment requirements
   */
  enhancePaymentRequirements(
    paymentRequirements: PaymentRequirements,
    supportedKind: {
      x402Version: number;
      scheme: string;
      network: Network;
      extra?: Record<string, unknown>;
    },
    facilitatorExtensions: string[],
  ): Promise<PaymentRequirements> {
    void supportedKind;
    void facilitatorExtensions;
    return Promise.resolve(paymentRequirements);
  }

  /**
   * Returns the built-in mainnet default.
   *
   * @param network - TRON network
   * @returns Default asset configuration
   */
  private getBuiltInDefault(network: Network): TronDefaultAssetConfig | undefined {
    if (network === TRON_MAINNET_CAIP2) {
      return { asset: TRON_MAINNET_USDT, decimals: TRON_USDT_DECIMALS };
    }
    return undefined;
  }
}

import {
  AssetAmount,
  Network,
  PaymentRequirements,
  Price,
  SchemeNetworkServer,
} from "@bankofai/x402-core/types";
import { parseMoneyString } from "@bankofai/x402-core/utils";
import {
  getDecimals,
  getDefaultAssetSymbol,
  findByAddress,
  parsePrice as parseTokenPrice,
} from "../../shared/tokens";
import { buildFeeInfo, type ExactTronFeeConfig } from "../../shared/fee";

/**
 * TRON server implementation for the `exact_gasfree` scheme.
 *
 * GasFree is TRON-only (no EVM counterpart). Price parsing and decimals come
 * from the token registry; fee terms come from the facilitator's advertised
 * fee config.
 */
export class ExactGasFreeTronScheme implements SchemeNetworkServer {
  readonly scheme = "exact_gasfree";

  /**
   * Parse a price into an asset amount.
   *
   * @param price - The price (AssetAmount, "<amount> <symbol>", or money).
   * @param network - The network identifier.
   * @returns The parsed asset amount.
   */
  async parsePrice(price: Price, network: Network): Promise<AssetAmount> {
    if (typeof price === "object" && price !== null && "amount" in price) {
      if (!price.asset) {
        throw new Error(`Asset address must be specified for AssetAmount on network ${network}`);
      }
      return { amount: price.amount, asset: price.asset, extra: price.extra || {} };
    }

    // "<amount> <symbol>" selects a specific token; otherwise use the default.
    const str =
      typeof price === "string" && /^\s*\d+(\.\d+)?\s+\S+\s*$/.test(price)
        ? price.trim()
        : `${this.parseMoneyToDecimal(price)} ${getDefaultAssetSymbol()}`;
    return parseTokenPrice(str, network);
  }

  /**
   * Return the decimal precision of an asset on a network.
   *
   * @param asset - The TRC-20 contract address.
   * @param network - The network identifier.
   * @returns Number of decimal places (defaults to 6 when unknown).
   */
  getAssetDecimals(asset: string, network: Network): number {
    return getDecimals(network, asset);
  }

  /**
   * Build payment requirements for `exact_gasfree`.
   *
   * @param paymentRequirements - The base payment requirements.
   * @param supportedKind - The supported kind from the facilitator.
   * @param supportedKind.x402Version - The x402 version.
   * @param supportedKind.scheme - The payment scheme.
   * @param supportedKind.network - The network identifier.
   * @param supportedKind.extra - Optional facilitator extra (feeConfig).
   * @param extensionKeys - Facilitator extension keys (unused).
   * @returns The enhanced payment requirements.
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

    const token = findByAddress(supportedKind.network, paymentRequirements.asset);
    const feeConfig = supportedKind.extra?.feeConfig as ExactTronFeeConfig | undefined;
    const existingFee = paymentRequirements.extra?.fee;
    const fee =
      existingFee ??
      (feeConfig
        ? buildFeeInfo(
            feeConfig,
            supportedKind.network,
            paymentRequirements.asset,
            feeConfig.feeTo ?? "",
          )
        : undefined);

    return Promise.resolve({
      ...paymentRequirements,
      extra: {
        ...paymentRequirements.extra,
        ...(token
          ? { name: token.name, ...(token.version ? { version: token.version } : {}) }
          : {}),
        ...(fee ? { fee } : {}),
      },
    });
  }

  /**
   * Parse Money (string | number) to a decimal number string.
   *
   * @param money - The money value (e.g. "$1.50", "1.50", 1.5).
   * @returns The decimal amount as a string.
   */
  private parseMoneyToDecimal(money: string | number): string {
    if (typeof money === "number") {
      return String(money);
    }
    // Delegate to core's strict parser (rejects trailing garbage and scientific
    // notation); return the canonical decimal for the "<amount> <symbol>" form.
    return String(parseMoneyString(money));
  }
}

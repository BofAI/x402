import {
  AssetAmount,
  MoneyParser,
  Network,
  PaymentFlowConfig,
  PaymentRequirements,
  Price,
  SchemeNetworkServer,
} from "@bankofai/x402-core/types";
import { parseMoney } from "@bankofai/x402-core/utils";
import { isNanoAddress } from "../../address";
import { parseRaw, xnoToRaw } from "../../amount";
import { XNO_ASSET, XNO_DECIMALS } from "../../network";

/**
 * Nano server implementation for the Exact payment scheme.
 *
 * Prices are XNO amounts (`"0.001 XNO"`) or raw `AssetAmount`s with asset
 * `XNO`. Plain dollar prices need a money parser that supplies an exchange
 * rate; none is built in.
 *
 * The payment is already on the ledger when the client retries, so the flow
 * is `upfront`: settle (which re-verifies and records the block) runs before
 * the handler, and a block can only pay once.
 */
export class ExactNanoScheme implements SchemeNetworkServer {
  readonly scheme = "exact";
  readonly defaultAssetTransferMethod = "default";
  readonly paymentFlows = {
    default: { supported: ["upfront"], default: "upfront" },
  } as const satisfies Record<string, PaymentFlowConfig>;
  private moneyParsers: MoneyParser[] = [];

  /**
   * Register a custom money parser, e.g. one converting dollars to raw at a
   * rate you choose. Parsers are tried in registration order.
   *
   * @param parser - Function returning an AssetAmount, or null to skip
   * @returns The server instance for chaining
   */
  registerMoneyParser(parser: MoneyParser): ExactNanoScheme {
    this.moneyParsers.push(parser);
    return this;
  }

  /**
   * Parses a price into a raw XNO asset amount.
   *
   * @param price - The price to parse
   * @param network - The network to use
   * @returns Promise that resolves to the parsed asset amount
   */
  async parsePrice(price: Price, network: Network): Promise<AssetAmount> {
    if (typeof price === "object" && price !== null && "amount" in price) {
      if (price.asset !== XNO_ASSET) {
        throw new Error(`Nano AssetAmount must use asset ${XNO_ASSET} on network ${network}`);
      }
      return {
        amount: parseRaw(price.amount).toString(),
        asset: XNO_ASSET,
        extra: price.extra || {},
      };
    }

    const { amount, symbol } = parseMoney(price);
    if (symbol === XNO_ASSET) {
      return { amount: xnoToRaw(amount).toString(), asset: XNO_ASSET, extra: {} };
    }
    if (symbol) {
      throw new Error(`Unsupported price symbol for Nano: ${symbol}`);
    }

    for (const parser of this.moneyParsers) {
      const result = await parser(amount, network);
      if (result !== null) {
        return result;
      }
    }

    throw new Error(
      `No money parser converts "${String(price)}" to XNO on ${network}; ` +
        `price in XNO (e.g. "0.001 XNO") or register a money parser`,
    );
  }

  /**
   * Build payment requirements for this scheme/network combination.
   *
   * @param paymentRequirements - The base payment requirements
   * @param supportedKind - The supported kind from facilitator (unused)
   * @param supportedKind.x402Version - The x402 version
   * @param supportedKind.scheme - The logical payment scheme
   * @param supportedKind.network - The network identifier
   * @param supportedKind.extra - Optional extra metadata
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
    void supportedKind;
    void extensionKeys;
    if (!isNanoAddress(paymentRequirements.payTo)) {
      return Promise.reject(new Error(`Invalid Nano payTo address: ${paymentRequirements.payTo}`));
    }
    return Promise.resolve(paymentRequirements);
  }

  /**
   * Return the decimal precision of XNO.
   *
   * @param asset - The asset identifier.
   * @param network - The network identifier (unused).
   * @returns 30 for XNO, undefined otherwise.
   */
  getAssetDecimals(asset: string, network: Network): number | undefined {
    void network;
    return asset === XNO_ASSET ? XNO_DECIMALS : undefined;
  }
}

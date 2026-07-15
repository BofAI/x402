import {
  PaymentRequirements,
  PaymentPayloadResult,
  PaymentPayloadContext,
  SchemeNetworkClient,
} from "@bankofai/x402-core/types";
import { ClientTronSigner } from "../../signer";
import { ExactGasFreePayload, GasFreeMessage } from "../../types";
import { getDecimals } from "../../shared/tokens";
import { log } from "@bankofai/x402-core";
import { transferWithAuthorizationABI } from "../../constants";
import {
  GasFreeAPIClient,
  type GasFreeAddressInfo,
  type GasFreeAsset,
} from "../../shared/gasfree/api";
import { assembleGasFreeTransaction } from "../../shared/gasfree/assemble";

/**
 * Options for the GasFree client scheme.
 *
 * Mirrors the `(signer, options?)` shape used by the EVM schemes — required
 * dependencies travel in the options object rather than as bare positional args.
 */
export interface ExactGasFreeSchemeOptions {
  /** GasFree relayer clients keyed by CAIP-2 network. */
  apiClients: Record<string, GasFreeAPIClient>;
}

/**
 * Deadline bounds (seconds from now) accepted by GasFree relayers.
 * Min/max are padded 5s inside the protocol bounds to avoid edge rejections.
 *
 * @param network - CAIP-2 network identifier.
 * @returns The min/max deltas in seconds.
 */
function getDeadlineBounds(network: string): { minDelta: number; maxDelta: number } {
  if (network === "tron:0x2b6653dc") {
    return { minDelta: 55, maxDelta: 595 };
  }
  return { minDelta: 55, maxDelta: 3595 };
}

/**
 * Read a caller-supplied deadline (Unix seconds) from the payment context.
 *
 * Mirrors the Python client's `paymentPermitContext.meta.validBefore` source so
 * an upstream that wants a shorter-lived permit can request one; when absent the
 * scheme falls back to the maximum allowed window.
 *
 * @param context - Optional payment payload context.
 * @returns The requested deadline in Unix seconds, or undefined when absent/invalid.
 */
function readRequestedDeadline(context?: PaymentPayloadContext): number | undefined {
  const permitContext = context?.extensions?.paymentPermitContext as
    | { meta?: { validBefore?: unknown } }
    | undefined;
  const raw = permitContext?.meta?.validBefore;
  if (raw === undefined || raw === null) {
    return undefined;
  }
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : undefined;
}

/**
 * TRON client implementation for the `exact_gasfree` scheme.
 *
 * Builds and signs a GasFreeController `PermitTransfer` so a service provider
 * can relay the transfer and pay energy — the payer needs no TRX.
 */
export class ExactGasFreeTronScheme implements SchemeNetworkClient {
  readonly scheme = "exact_gasfree";

  /**
   * Create the GasFree client scheme.
   *
   * @param signer - The TRON client signer.
   * @param options - Scheme options carrying the GasFree relayer clients.
   */
  constructor(
    private readonly signer: ClientTronSigner,
    private readonly options: ExactGasFreeSchemeOptions,
  ) {}

  /**
   * Resolve the user's GasFree wallet balance for a token.
   *
   * @param asset - The TRC-20 contract address.
   * @param network - CAIP-2 network identifier.
   * @returns The balance in smallest units.
   */
  async checkBalance(asset: string, network: string): Promise<bigint> {
    const api = this.getApiClient(network);
    const accountInfo = await api.getAddressInfo(this.signer.address);
    return this.readGasFreeBalance(asset, accountInfo.gasFreeAddress);
  }

  /**
   * Create the `exact_gasfree` payment payload.
   *
   * @param x402Version - The x402 protocol version.
   * @param requirements - The payment requirements.
   * @param context - Optional context (server extensions, skipBalanceCheck).
   * @returns The payment payload result.
   */
  async createPaymentPayload(
    x402Version: number,
    requirements: PaymentRequirements,
    context?: PaymentPayloadContext,
  ): Promise<PaymentPayloadResult> {
    const network = requirements.network;
    const api = this.getApiClient(network);
    const user = this.signer.address;

    const accountInfo = await api.getAddressInfo(user);
    const gasfreeAddress = accountInfo.gasFreeAddress;
    if (!gasfreeAddress) {
      throw new Error(`Could not retrieve GasFree address for ${user}`);
    }

    if (!accountInfo.active && !accountInfo.allowSubmit) {
      throw new Error(`GasFree account for ${user} (${gasfreeAddress}) is not activated.`);
    }

    const serviceProvider = await this.resolveProvider(api);

    const asset = accountInfo.assets.find(a => a.tokenAddress === requirements.asset);
    const maxFee = this.computeMaxFee(requirements, accountInfo, asset);

    const skipBalanceCheck = (context?.extensions?.skipBalanceCheck as boolean) ?? false;
    if (!skipBalanceCheck) {
      if (!asset) {
        throw new Error(
          `Asset ${requirements.asset} not found in GasFree account ${gasfreeAddress}.`,
        );
      }
      const balance = await this.readGasFreeBalance(requirements.asset, gasfreeAddress);
      const required = BigInt(requirements.amount) + maxFee;
      if (balance < required) {
        throw new Error(`Insufficient balance in GasFree wallet ${gasfreeAddress}.`);
      }
    }

    const deadline = this.resolveDeadline(network, context);

    const message: GasFreeMessage = {
      token: requirements.asset,
      serviceProvider,
      user,
      receiver: requirements.payTo,
      value: requirements.amount,
      maxFee: maxFee.toString(),
      deadline: deadline.toString(),
      version: "1",
      nonce: accountInfo.nonce.toString(),
    };

    const assembled = assembleGasFreeTransaction(message, network);
    const signature = await this.signer.signTypedData({
      domain: assembled.domain,
      types: assembled.types as unknown as Record<string, Array<{ name: string; type: string }>>,
      primaryType: assembled.primaryType,
      message: assembled.message,
    });

    const payload: ExactGasFreePayload = { signature, gasfree: message, gasfreeAddress };

    return {
      x402Version,
      payload,
      extensions: { scheme: "exact_gasfree", gasfreeAddress },
    };
  }

  /**
   * Resolve the GasFree relayer client for a network.
   *
   * @param network - CAIP-2 network identifier.
   * @returns The relayer API client.
   */
  private getApiClient(network: string): GasFreeAPIClient {
    const client = this.options.apiClients[network];
    if (!client) {
      throw new Error(`GasFree is not configured for network: ${network}`);
    }
    return client;
  }

  /**
   * Read a TRC-20 balance for the GasFree wallet address.
   *
   * @param asset - The TRC-20 contract address.
   * @param gasfreeAddress - The GasFree wallet address to read.
   * @returns The balance in smallest units.
   */
  private async readGasFreeBalance(asset: string, gasfreeAddress: string): Promise<bigint> {
    const balance = (await this.signer.readContract({
      address: asset,
      abi: transferWithAuthorizationABI as unknown as readonly Record<string, unknown>[],
      functionName: "balanceOf",
      args: [gasfreeAddress],
    })) as bigint;
    return BigInt(balance);
  }

  /**
   * Resolve the service provider by picking from the relayer's provider list.
   *
   * @param api - The GasFree relayer client.
   * @returns The selected service provider address.
   */
  private async resolveProvider(api: GasFreeAPIClient): Promise<string> {
    const providers = await api.getProviders();
    if (!providers || providers.length === 0) {
      throw new Error("No GasFree service providers available");
    }
    return providers[Math.floor(Math.random() * providers.length)]!.address;
  }

  /**
   * Compute the maxFee: account transferFee, plus activateFee when inactive,
   * falling back to one token when nothing is known.
   *
   * @param requirements - The payment requirements.
   * @param accountInfo - The GasFree account info.
   * @param asset - The GasFree per-token fee entry, if present.
   * @returns The computed maxFee in smallest units.
   */
  private computeMaxFee(
    requirements: PaymentRequirements,
    accountInfo: GasFreeAddressInfo,
    asset: GasFreeAsset | undefined,
  ): bigint {
    const transferFee = BigInt(asset?.transferFee ?? "0");
    const activateFee = BigInt(asset?.activateFee ?? "0");

    let maxFee = transferFee;

    // Fallback: nothing known → default to 1 token.
    if (maxFee === 0n) {
      const decimals = getDecimals(requirements.network, requirements.asset);
      maxFee = BigInt(10) ** BigInt(decimals);
    }

    // Cover account activation on first use.
    if (!accountInfo.active && activateFee > 0n) {
      maxFee += activateFee;
    }

    return maxFee;
  }

  /**
   * Resolve the permit deadline, clamping to the network's allowed window.
   *
   * Mirrors the Python client: a caller-supplied deadline (via
   * `extensions.paymentPermitContext.meta.validBefore`) is honored when present,
   * otherwise the maximum allowed window is used. A value past the max is clamped
   * down (with a warning); a value before the min is rejected.
   *
   * @param network - CAIP-2 network identifier.
   * @param context - Optional payment payload context that may carry a
   *   caller-requested `validBefore` deadline.
   * @returns The deadline as Unix seconds.
   */
  private resolveDeadline(network: string, context?: PaymentPayloadContext): number {
    const now = Math.floor(Date.now() / 1000);
    const { minDelta, maxDelta } = getDeadlineBounds(network);
    const minDeadline = now + minDelta;
    const maxDeadline = now + maxDelta;

    const requested = readRequestedDeadline(context);
    const deadline = requested ?? maxDeadline;

    if (deadline < minDeadline) {
      throw new Error(`GasFree deadline too soon for ${network}: ${deadline} < ${minDeadline}`);
    }
    if (deadline > maxDeadline) {
      log.warn(
        `[x402] GasFree deadline clamped: network=${network} from=${deadline} to=${maxDeadline}`,
      );
      return maxDeadline;
    }
    return deadline;
  }
}

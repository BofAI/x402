import {
  PaymentRequirements,
  PaymentPayloadResult,
  PaymentPayloadContext,
  SchemeNetworkClient,
} from "@x402/core/types";
import { ClientTronSigner } from "../../signer";
import { ExactGasFreePayload, GasFreeMessage } from "../../types";
import { getDecimals } from "../../shared/tokens";
import { readFeeFromExtra, type FeeInfo } from "../../shared/fee";
import { transferWithAuthorizationABI } from "../../constants";
import {
  GasFreeAPIClient,
  type GasFreeAddressInfo,
  type GasFreeAsset,
} from "../../shared/gasfree/api";
import { assembleGasFreeTransaction } from "../../shared/gasfree/assemble";

/**
 * Deadline bounds (seconds from now) accepted by GasFree relayers.
 * Min/max are padded 5s inside the protocol bounds to avoid edge rejections.
 *
 * @param network - CAIP-2 network identifier.
 * @returns The min/max deltas in seconds.
 */
function getDeadlineBounds(network: string): { minDelta: number; maxDelta: number } {
  if (network === "tron:mainnet") {
    return { minDelta: 55, maxDelta: 595 };
  }
  return { minDelta: 55, maxDelta: 3595 };
}

/**
 * TRON client implementation for the `exact_gasfree` scheme.
 *
 * Builds and signs a GasFreeController `PermitTransfer` so a service provider
 * can relay the transfer and pay energy — the payer needs no TRX.
 */
export class ExactGasFreeScheme implements SchemeNetworkClient {
  readonly scheme = "exact_gasfree";

  /**
   * Create the GasFree client scheme.
   *
   * @param signer - The TRON client signer.
   * @param apiClients - GasFree relayer clients keyed by CAIP-2 network.
   */
  constructor(
    private readonly signer: ClientTronSigner,
    private readonly apiClients: Record<string, GasFreeAPIClient>,
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

    const fee = readFeeFromExtra(requirements.extra);
    const serviceProvider = await this.resolveProvider(api, fee);

    const asset = accountInfo.assets.find(a => a.tokenAddress === requirements.asset);
    const maxFee = this.computeMaxFee(requirements, accountInfo, asset, fee);

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

    const deadline = this.resolveDeadline(network);

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
    const client = this.apiClients[network];
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
   * Resolve the service provider: the requirement's fee.feeTo, or a relayer pick.
   *
   * @param api - The GasFree relayer client.
   * @param fee - The fee terms from the requirement, if any.
   * @returns The selected service provider address.
   */
  private async resolveProvider(api: GasFreeAPIClient, fee: FeeInfo | undefined): Promise<string> {
    if (fee?.feeTo) {
      return fee.feeTo;
    }
    const providers = await api.getProviders();
    if (!providers || providers.length === 0) {
      throw new Error("No GasFree service providers available");
    }
    return providers[Math.floor(Math.random() * providers.length)]!.address;
  }

  /**
   * Compute the maxFee: max(account transferFee, facilitator fee), plus
   * activateFee when inactive, falling back to one token when nothing is known.
   *
   * @param requirements - The payment requirements.
   * @param accountInfo - The GasFree account info.
   * @param asset - The GasFree per-token fee entry, if present.
   * @param fee - The fee terms from the requirement, if any.
   * @returns The computed maxFee in smallest units.
   */
  private computeMaxFee(
    requirements: PaymentRequirements,
    accountInfo: GasFreeAddressInfo,
    asset: GasFreeAsset | undefined,
    fee: FeeInfo | undefined,
  ): bigint {
    const transferFee = BigInt(asset?.transferFee ?? "0");
    const activateFee = BigInt(asset?.activateFee ?? "0");
    const facilitatorFee = BigInt(fee?.feeAmount ?? "0");

    let maxFee = transferFee > facilitatorFee ? transferFee : facilitatorFee;

    // Fallback: nothing known and no facilitator fee → default to 1 token.
    if (maxFee === 0n && !fee) {
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
   * Resolve the permit deadline at the maximum allowed window for the network.
   *
   * @param network - CAIP-2 network identifier.
   * @returns The deadline as Unix seconds.
   */
  private resolveDeadline(network: string): number {
    const now = Math.floor(Date.now() / 1000);
    const { minDelta, maxDelta } = getDeadlineBounds(network);
    const minDeadline = now + minDelta;
    const maxDeadline = now + maxDelta;
    // Use the maximum allowed window by default.
    const deadline = maxDeadline;
    if (deadline < minDeadline) {
      throw new Error(`GasFree deadline window invalid for ${network}`);
    }
    return deadline;
  }
}

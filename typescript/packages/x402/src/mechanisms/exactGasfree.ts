import gasFreeSDK from '@gasfree/gasfree-sdk';
const { TronGasFree } = gasFreeSDK;
import {
  PaymentPayload,
  PaymentRequirements,
  PaymentPermit,
  DeliveryKind,
  ClientMechanism,
  ClientSigner,
  GASFREE_PRIMARY_TYPE,
  getChainId,
  getGasFreeApiBaseUrl,
} from '../index.js';
import { GASFREE_TYPES, GasFreeAPIClient } from '../utils/gasfree.js';
import { findByAddress } from '../tokens.js';
import { TronAddressConverter } from '../address.js';

export class ExactGasFreeClientMechanism implements ClientMechanism {
  private signer: ClientSigner;
  private clients: Record<string, GasFreeAPIClient>;

  constructor(signer: ClientSigner, clients: Record<string, GasFreeAPIClient> = {}) {
    this.signer = signer;
    this.clients = clients;
  }

  private getApiClient(network: string): GasFreeAPIClient {
    const client = this.clients[network];
    if (client) {
      return client;
    }
    throw new Error(`GasFree is not configured for network: ${network}`);
  }

  scheme(): string {
    return 'exact_gasfree';
  }

  async createPaymentPayload(
    requirements: PaymentRequirements,
    resource: string,
    extensions?: Record<string, unknown>
  ): Promise<PaymentPayload> {
    const chainId = getChainId(requirements.network);
    const apiClient = this.getApiClient(requirements.network);
    const userAddress = await this.signer.getAddress();

    // 1. Fetch account info
    console.debug(`Fetching account info for ${userAddress} from GasFree API...`);
    const accountInfo = await apiClient.getAddressInfo(userAddress);
    const gasfreeAddress = accountInfo.gasFreeAddress;
    
    if (!gasfreeAddress) {
      throw new Error(`Could not retrieve GasFree address for ${userAddress}`);
    }

    // 2. Check activation status
    const allowSubmit = (accountInfo as any).allowSubmit || false;
    if (!accountInfo.active && !allowSubmit) {
      throw new Error(`GasFree account for ${userAddress} (${gasfreeAddress}) is not activated.`);
    }

    // 3. Get provider and fee
    const feeInfo = requirements.extra?.fee;
    let serviceProviderAddr: string;
    if (feeInfo?.feeTo) {
      // Use provider from facilitator's fee quote
      serviceProviderAddr = feeInfo.feeTo;
      console.debug(`Using GasFree provider from requirements: ${serviceProviderAddr}`);
    } else {
      // Fallback: fetch providers from GasFree API directly
      console.debug('No provider in requirements, fetching from GasFree API...');
      const providers = await apiClient.getProviders();
      if (!providers || providers.length === 0) {
        throw new Error('No GasFree service providers available');
      }
      serviceProviderAddr = providers[Math.floor(Math.random() * providers.length)].address;
      console.debug(`Selected GasFree provider: ${serviceProviderAddr}`);
    }

    // Look up per-user transferFee from account info
    const asset = accountInfo.assets.find((a: any) => a.tokenAddress === requirements.asset);
    const transferFee = BigInt(asset?.transferFee || '0');
    const activateFee = BigInt(asset?.activateFee || '0');

    // Determine maxFee
    const facilitatorFee = BigInt(feeInfo?.feeAmount || '0');
    let maxFeeBig = transferFee > facilitatorFee ? transferFee : facilitatorFee;

    // Fallback: if both are 0 and no facilitator fee, default to 1 token
    if (maxFeeBig === 0n && !feeInfo) {
      const tokenInfo = findByAddress(requirements.network, requirements.asset);
      const decimals = tokenInfo?.decimals ?? 6;
      maxFeeBig = BigInt(10 ** decimals);
    }

    // If the account is not yet activated, add activateFee to maxFee
    if (!accountInfo.active && activateFee > 0n) {
      maxFeeBig = maxFeeBig + activateFee;
      console.debug(`GasFree account not activated, adding activateFee ${activateFee} to maxFee`);
    }
    let maxFee = maxFeeBig.toString();

    // 4. Balance verification
    const skipBalanceCheck = (extensions as any)?.skipBalanceCheck || false;
    if (!skipBalanceCheck) {
      if (asset) {
          // Fetch balance directly from the contract for the gasfreeAddress
          const assetBalance = await this.signer.checkBalance(requirements.asset, requirements.network, gasfreeAddress);
          const requiredTotal = BigInt(requirements.amount) + maxFeeBig;
          if (assetBalance < requiredTotal) {
            throw new Error(`Insufficient balance in GasFree wallet ${gasfreeAddress}.`);
          }
      } else {
        throw new Error(`Asset ${requirements.asset} not found in GasFree account ${gasfreeAddress}.`);
      }
    }

    const deadline = (extensions as any)?.paymentPermitContext?.meta?.validBefore || Math.floor(Date.now() / 1000) + 3600;
    
    const gasFree = new TronGasFree({ chainId });
    const addressConverter = new TronAddressConverter();

    // 5. Sign TIP-712 typed data
    const { domain, types, message } = gasFree.assembleGasFreeTransactionJson({
      token: requirements.asset,
      serviceProvider: serviceProviderAddr,
      user: userAddress,
      receiver: requirements.payTo,
      value: requirements.amount,
      maxFee: maxFee,
      deadline: deadline.toString(),
      version: '1',
      nonce: accountInfo.nonce.toString(),
    });

    const signingDomain = {
      ...domain,
      verifyingContract: addressConverter.toEvmFormat(String(domain.verifyingContract)),
    };
    const signingMessage = {
      ...message,
      token: addressConverter.toEvmFormat(String(message.token)),
      serviceProvider: addressConverter.toEvmFormat(String(message.serviceProvider)),
      user: addressConverter.toEvmFormat(String(message.user)),
      receiver: addressConverter.toEvmFormat(String(message.receiver)),
    };

    const signature = await this.signer.signTypedData(
      signingDomain,
      types,
      signingMessage,
      GASFREE_PRIMARY_TYPE
    );

    // 6. Build PaymentPermit structure
    const paymentPermit: PaymentPermit = {
      meta: {
        kind: 'PAYMENT_ONLY' as DeliveryKind,
        paymentId: (extensions as any)?.paymentPermitContext?.meta?.paymentId || '',
        nonce: accountInfo.nonce.toString(),
        validAfter: (extensions as any)?.paymentPermitContext?.meta?.validAfter || 0,
        validBefore: Number(deadline),
      },
      buyer: userAddress,
      caller: serviceProviderAddr, 
      payment: {
        payToken: requirements.asset,
        payAmount: requirements.amount,
        payTo: requirements.payTo,
      },
      fee: {
        feeTo: serviceProviderAddr,
        feeAmount: maxFee,
      },
    };

    return {
      x402Version: 2,
      resource: { url: resource },
      accepted: requirements,
      payload: {
        signature,
        paymentPermit,
      },
      extensions: {
        ...extensions,
        gasfreeAddress,
        scheme: 'exact_gasfree',
      },
    };
  }
}

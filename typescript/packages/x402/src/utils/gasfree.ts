import {
  GASFREE_PRIMARY_TYPE,
} from '../abi.js';
import { getGasFreeApiKey, getGasFreeApiSecret } from '../config.js';

/**
 * GasFree utility functions for API interaction and domain helpers.
 */

export interface GasFreeResponse<T> {
  code: number;
  reason: string | null;
  message: string | null;
  data: T | null;
}

export interface GasFreeAsset {
  tokenAddress: string;
  tokenSymbol: string;
  activateFee: number;
  transferFee: number;
  decimal: number;
  frozen: number;
  balance?: string | number;
}

export interface GasFreeAddressInfo {
  accountAddress: string;
  gasFreeAddress: string;
  active: boolean;
  nonce: number;
  allowSubmit: boolean;
  assets: GasFreeAsset[];
}

export interface GasFreeSubmitResponseData {
  id: string;
  state: 'WAITING' | 'INPROGRESS' | 'CONFIRMING' | 'SUCCEED' | 'FAILED';
  createdAt: string;
  accountAddress: string;
  gasFreeAddress: string;
  providerAddress: string;
  targetAddress: string;
  nonce: number;
  tokenAddress: string;
  amount: string;
  expiredAt: string;
  reason?: string;
  txnHash?: string;
  txnState?: 'INIT' | 'NOT_ON_CHAIN' | 'ON_CHAIN' | 'SOLIDITY' | 'ON_CHAIN_FAILED';
}

export interface GasFreeProvider {
  address: string;
  name: string;
  icon: string;
  website: string;
  config: {
    maxPendingTransfer: number;
    minDeadlineDuration: number;
    maxDeadlineDuration: number;
    defaultDeadlineDuration: number;
  };
}

// GasFree TIP-712 Types
export const GASFREE_TYPES = {
  [GASFREE_PRIMARY_TYPE]: [
    { name: 'token', type: 'address' },
    { name: 'serviceProvider', type: 'address' },
    { name: 'user', type: 'address' },
    { name: 'receiver', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'maxFee', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
    { name: 'version', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
  ],
} as const;

const DEFAULT_TIMEOUT_MS = 30000;

export class GasFreeAPIClient {
  private baseUrl: string;
  private apiKey?: string;
  private apiSecret?: string;

  constructor(baseUrl: string, apiKey?: string, apiSecret?: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');

    // Fallback to environment variables if keys are missing
    if (!apiKey || !apiSecret) {
      let network = 'tron:mainnet';
      if (this.baseUrl.includes('open-test')) {
        if (this.baseUrl.includes('nile')) network = 'tron:nile';
        else if (this.baseUrl.includes('shasta')) network = 'tron:shasta';
      }
      this.apiKey = apiKey || getGasFreeApiKey(network);
      this.apiSecret = apiSecret || getGasFreeApiSecret(network);
    } else {
      this.apiKey = apiKey;
      this.apiSecret = apiSecret;
    }
  }

  /**
   * Generate HMAC signature for authentication
   */
  private async generateSignature(method: string, path: string, timestamp: number): Promise<string> {
    if (!this.apiSecret) return '';

    const message = `${method.toUpperCase()}${path}${timestamp}`;
    console.debug(`GasFree HMAC base string: ${message}`);
    
    // Check if we are in Node.js environment
    if (typeof process !== 'undefined' && process.versions && process.versions.node) {
      const crypto = await import('node:crypto');
      return crypto
        .createHmac('sha256', this.apiSecret)
        .update(message)
        .digest('base64');
    } else {
      // Browser implementation using Web Crypto API
      const encoder = new TextEncoder();
      const keyData = encoder.encode(this.apiSecret);
      const msgData = encoder.encode(message);
      
      const cryptoKey = await globalThis.crypto.subtle.importKey(
        'raw',
        keyData,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      );
      
      const signature = await globalThis.crypto.subtle.sign('HMAC', cryptoKey, msgData);
      return btoa(String.fromCharCode(...new Uint8Array(signature)));
    }
  }

  /**
   * Get headers with authentication if keys are provided
   */
  private async getHeaders(method: string, path: string): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.apiKey && this.apiSecret) {
      const timestamp = Math.floor(Date.now() / 1000);
      
      // The Provider expects the FULL path including /nile or /tron for signature
      let fullPath = path;
      const urlParts = this.baseUrl.split('/');
      if (urlParts.length > 3) {
        const prefix = '/' + urlParts.slice(3).join('/');
        if (!fullPath.startsWith(prefix)) {
          fullPath = prefix + path;
        }
      }

      const signature = await this.generateSignature(method, fullPath, timestamp);
      headers['Timestamp'] = timestamp.toString();
      headers['Authorization'] = `ApiKey ${this.apiKey}:${signature}`;
    }

    return headers;
  }

  /**
   * Get all supported service providers
   */
  async getProviders(): Promise<GasFreeProvider[]> {
    const path = '/api/v1/config/provider/all';
    const url = `${this.baseUrl}${path}`;
    const headers = await this.getHeaders('GET', path);
    
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS) });
    const bodyText = await response.text();

    if (!response.ok) {
      console.error(`GasFree config API HTTP error ${response.status} at ${url}: ${bodyText}`);
      throw new Error(`GasFree config API error: ${response.status}`);
    }
    const result = JSON.parse(bodyText) as GasFreeResponse<{ providers: GasFreeProvider[] }>;
    if (result.code !== 200) {
      console.error(`GasFree config API business error at ${url}: ${result.message || result.reason}`);
      throw new Error(`GasFree config API error: ${result.message || result.reason}`);
    }
    if (result.data == null) {
      throw new Error('GasFree config API returned null data');
    }
    return result.data.providers;
  }

  /**
   * Get the current recommended nonce for a user
   */
  async getNonce(user: string): Promise<number> {
    try {
      const data = await this.getAddressInfo(user);
      return data.nonce ?? 0;
    } catch (error) {
      console.warn(`Failed to get nonce from GasFree API: ${error}. Defaulting to 0.`);
      return 0;
    }
  }

  /**
   * Get full account info (activation, balance, nonce) for a user
   */
  async getAddressInfo(user: string): Promise<GasFreeAddressInfo> {
    const path = `/api/v1/address/${user}`;
    const url = `${this.baseUrl}${path}`;
    const headers = await this.getHeaders('GET', path);

    const response = await fetch(url, { headers, signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS) });
    const bodyText = await response.text();

    if (!response.ok) {
      console.error(`GasFree API HTTP error ${response.status} at ${url}: ${bodyText}`);
      throw new Error(`GasFree API HTTP error: ${response.status} - Body: ${bodyText}`);
    }
    const result = JSON.parse(bodyText) as GasFreeResponse<GasFreeAddressInfo>;
    if (result.code !== 200) {
      console.error(`GasFree API business error at ${url}: ${result.message || result.reason} - Body: ${bodyText}`);
      throw new Error(`GasFree API error: ${result.message || result.reason} - Body: ${bodyText}`);
    }
    if (result.data == null) {
      throw new Error(`GasFree API returned null data for address ${user}`);
    }
    return result.data;
  }

  /**
   * Get status of a submitted GasFree transaction
   */
  async getStatus(traceId: string): Promise<GasFreeSubmitResponseData | null> {
    const path = `/api/v1/gasfree/${traceId}`;
    const url = `${this.baseUrl}${path}`;
    const headers = await this.getHeaders('GET', path);
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS) });
    const bodyText = await response.text();

    if (!response.ok) {
      console.error(`GasFree status API HTTP error ${response.status} at ${url}: ${bodyText}`);
      throw new Error(`GasFree status API error: ${response.status}`);
    }
    const result = JSON.parse(bodyText) as GasFreeResponse<GasFreeSubmitResponseData>;
    if (result.code !== 200) {
      console.error(`GasFree status API business error at ${url}: ${result.message || result.reason}`);
      throw new Error(`GasFree status API error: ${result.message || result.reason}`);
    }
    return result.data;
  }

  /**
   * Wait for a GasFree transaction to reach a terminal state or ON_CHAIN state
   */
  async waitForSuccess(
    traceId: string,
    timeout: number = 120000,
    pollInterval: number = 5000,
    maxErrors: number = 3
  ): Promise<GasFreeSubmitResponseData> {
    const startTime = Date.now();
    let errorCount = 0;

    while (Date.now() - startTime < timeout) {
      let statusData: GasFreeSubmitResponseData | null;
      try {
        statusData = await this.getStatus(traceId);
        errorCount = 0; // reset on successful poll
      } catch (err) {
        errorCount++;
        console.warn(`GasFree status poll failed for ${traceId} (error #${errorCount}): ${err}, retrying...`);
        if (errorCount >= maxErrors) {
          throw new Error(`GasFree status polling aborted after ${errorCount} consecutive errors: ${err}`);
        }
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
        continue;
      }
      if (statusData == null) {
        console.debug(`GasFree transaction ${traceId} status not yet available, waiting...`);
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
        continue;
      }
      const state = (statusData.state ?? '').toUpperCase();
      const txnState = (statusData.txnState || '').toUpperCase();

      // 1. Immediate return for successful or "good enough" states
      if (state === 'SUCCEED' || (statusData.txnHash && ['ON_CHAIN', 'SOLIDITY'].includes(txnState))) {
        return statusData;
      }

      if (state === 'FAILED' || txnState === 'ON_CHAIN_FAILED') {
        throw new Error(`GasFree transaction failed. Reason: ${statusData.reason || 'Unknown'}`);
      }

      console.debug(`GasFree transaction ${traceId} is ${state} (${txnState}), waiting...`);
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    throw new Error(`GasFree transaction ${traceId} timed out after ${timeout / 1000}s (${errorCount} errors encountered)`);
  }

  /**
   * Submit a signed GasFree transaction to the official relayer
   */
  async submit(domain: any, message: any, signature: string): Promise<string> {
    const path = '/api/v1/gasfree/submit';
    const url = `${this.baseUrl}${path}`;
    
    const payload = {
      token: message.token,
      serviceProvider: message.serviceProvider,
      user: message.user,
      receiver: message.receiver,
      value: message.value.toString(),
      maxFee: message.maxFee.toString(),
      deadline: Number(message.deadline),
      version: 1,
      nonce: Number(message.nonce),
      sig: signature.startsWith('0x') ? signature.slice(2) : signature,
      requestId: `x402-${Date.now()}-${signature.slice(2, 10)}`,
    };

    try {
      const headers = await this.getHeaders('POST', path);
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });

      const bodyText = await response.text();

      if (!response.ok) {
        console.error(`GasFree submit HTTP error ${response.status} at ${url}: ${bodyText}`);
        throw new Error(`GasFree submit HTTP error: ${response.status} - Body: ${bodyText}`);
      }

      const result = JSON.parse(bodyText) as GasFreeResponse<GasFreeSubmitResponseData>;
      if (result.code !== 200) {
        console.error(`GasFree submit API business error at ${url}: ${result.message || result.reason} - Body: ${bodyText}`);
        throw new Error(`GasFree submit API error: ${result.message || result.reason} - Body: ${bodyText}`);
      }
      if (result.data == null) {
        throw new Error('GasFree submit API returned null data');
      }
      if (result.data.id == null) {
        throw new Error('GasFree submit API returned data without id field');
      }
      return result.data.id;
    } catch (error) {
      console.error(`Failed to submit GasFree transaction: ${error}`);
      throw error;
    }
  }
}

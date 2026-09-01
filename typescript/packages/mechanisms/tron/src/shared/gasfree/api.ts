/**
 * GasFree relayer API client.
 *
 * Wraps the GasFree open API: account info (GasFree address, nonce, per-token
 * fees, activation), provider listing, transaction submission, and status
 * polling. Ported from the reference implementation.
 */
import { log } from "@bankofai/x402-core";

export interface GasFreeResponse<T> {
  code: number;
  reason: string | null;
  message: string | null;
  data: T | null;
}

export interface GasFreeAsset {
  tokenAddress: string;
  tokenSymbol: string;
  activateFee: number | string;
  transferFee: number | string;
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

export interface GasFreeSubmitResponseData {
  id: string;
  state: "WAITING" | "INPROGRESS" | "CONFIRMING" | "SUCCEED" | "FAILED";
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
  txnState?: "INIT" | "NOT_ON_CHAIN" | "ON_CHAIN" | "SOLIDITY" | "ON_CHAIN_FAILED";
}

/**
 * GasFree polling error that preserves relayer recovery metadata.
 *
 * `terminal` distinguishes an explicit relayer/on-chain failure from an
 * indeterminate timeout or RPC failure. `transaction` is present whenever the
 * relayer exposed an on-chain hash before polling stopped.
 */
export class GasFreeTransactionStatusError extends Error {
  readonly name = "GasFreeTransactionStatusError";

  /**
   * Create a recoverable GasFree polling error.
   *
   * @param message - Failure description.
   * @param traceId - Relayer trace id being polled.
   * @param transaction - Last transaction hash exposed by the relayer.
   * @param terminal - Whether the relayer reported an explicit terminal failure.
   */
  constructor(
    message: string,
    readonly traceId: string,
    readonly transaction: string | undefined,
    readonly terminal: boolean,
  ) {
    super(message);
  }
}

const DEFAULT_TIMEOUT_MS = 30000;

/** Minimal GasFree submit message shape (Base58Check addresses). */
export interface GasFreeSubmitMessage {
  token: string;
  serviceProvider: string;
  user: string;
  receiver: string;
  value: string | bigint;
  maxFee: string | bigint;
  deadline: string | number;
  version: string | number;
  nonce: string | number;
}

/**
 * HTTP client for a GasFree relayer endpoint.
 */
export class GasFreeAPIClient {
  private readonly baseUrl: string;

  /**
   * Create a GasFree API client.
   *
   * @param baseUrl - The relayer API base URL (trailing slash trimmed).
   */
  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  /**
   * List all supported service providers.
   *
   * @returns The available GasFree providers.
   */
  async getProviders(): Promise<GasFreeProvider[]> {
    const url = `${this.baseUrl}/api/v1/config/provider/all`;
    const response = await fetch(url, {
      headers: this.headers(),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
    if (response.status === 404) {
      // Network not served by GasFree — return an empty provider list so fee/quote
      // degrades gracefully instead of crashing with HTTP 500. Mirrors Python's
      // get_providers (commit ed1e6ef).
      log.warn(`[x402] GasFree service not available for this network (404): ${url}`);
      return [];
    }
    const bodyText = await response.text();
    if (!response.ok) {
      throw new Error(`GasFree config API error: ${response.status} - ${bodyText}`);
    }
    const result = JSON.parse(bodyText) as GasFreeResponse<{ providers: GasFreeProvider[] }>;
    if (result.code !== 200 || result.data == null) {
      throw new Error(`GasFree config API error: ${result.message || result.reason}`);
    }
    return result.data.providers;
  }

  /**
   * Get the current recommended nonce for a user (defaults to 0 on failure).
   *
   * @param user - The user's TRON address.
   * @returns The recommended nonce.
   */
  async getNonce(user: string): Promise<number> {
    try {
      const data = await this.getAddressInfo(user);
      return data.nonce ?? 0;
    } catch {
      return 0;
    }
  }

  /**
   * Get full account info (GasFree address, activation, nonce, per-token fees).
   *
   * @param user - The user's TRON address.
   * @returns The account info.
   */
  async getAddressInfo(user: string): Promise<GasFreeAddressInfo> {
    const url = `${this.baseUrl}/api/v1/address/${user}`;
    const response = await fetch(url, {
      headers: this.headers(),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
    const bodyText = await response.text();
    if (!response.ok) {
      throw new Error(`GasFree API HTTP error: ${response.status} - ${bodyText}`);
    }
    const result = JSON.parse(bodyText) as GasFreeResponse<GasFreeAddressInfo>;
    if (result.code !== 200 || result.data == null) {
      throw new Error(`GasFree API error: ${result.message || result.reason} - ${bodyText}`);
    }
    return result.data;
  }

  /**
   * Get the status of a submitted GasFree transaction.
   *
   * @param traceId - The transaction trace id returned by submit().
   * @returns The status data, or null if not yet available.
   */
  async getStatus(traceId: string): Promise<GasFreeSubmitResponseData | null> {
    const url = `${this.baseUrl}/api/v1/gasfree/${traceId}`;
    const response = await fetch(url, {
      headers: this.headers(),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
    const bodyText = await response.text();
    if (!response.ok) {
      throw new Error(`GasFree status API error: ${response.status} - ${bodyText}`);
    }
    const result = JSON.parse(bodyText) as GasFreeResponse<GasFreeSubmitResponseData>;
    if (result.code !== 200) {
      throw new Error(`GasFree status API error: ${result.message || result.reason}`);
    }
    return result.data;
  }

  /**
   * Poll a submitted transaction until it succeeds, lands on-chain, or fails.
   *
   * @param traceId - The transaction trace id.
   * @param timeout - Overall timeout in ms (default 120000).
   * @param pollInterval - Delay between polls in ms (default 5000).
   * @param maxErrors - Consecutive poll errors tolerated before aborting (default 3).
   * @returns The terminal/on-chain status data.
   * @throws Error on failure, timeout, or repeated poll errors.
   */
  async waitForSuccess(
    traceId: string,
    timeout = 120000,
    pollInterval = 5000,
    maxErrors = 3,
  ): Promise<GasFreeSubmitResponseData> {
    const startTime = Date.now();
    let errorCount = 0;
    let lastTransactionHash: string | undefined;

    while (Date.now() - startTime < timeout) {
      let statusData: GasFreeSubmitResponseData | null;
      try {
        statusData = await this.getStatus(traceId);
        errorCount = 0;
      } catch (err) {
        errorCount++;
        if (errorCount >= maxErrors) {
          throw new GasFreeTransactionStatusError(
            `GasFree status polling aborted after ${errorCount} consecutive errors: ${err}`,
            traceId,
            lastTransactionHash,
            false,
          );
        }
        await new Promise(resolve => setTimeout(resolve, pollInterval));
        continue;
      }

      if (statusData == null) {
        await new Promise(resolve => setTimeout(resolve, pollInterval));
        continue;
      }

      const state = (statusData.state ?? "").toUpperCase();
      const txnState = (statusData.txnState ?? "").toUpperCase();
      if (statusData.txnHash) lastTransactionHash = statusData.txnHash;

      if (
        (state === "SUCCEED" && statusData.txnHash) ||
        (statusData.txnHash && ["ON_CHAIN", "SOLIDITY"].includes(txnState))
      ) {
        return statusData;
      }
      if (state === "FAILED" || txnState === "ON_CHAIN_FAILED") {
        throw new GasFreeTransactionStatusError(
          `GasFree transaction failed. Reason: ${statusData.reason || "Unknown"}`,
          traceId,
          lastTransactionHash,
          true,
        );
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    throw new GasFreeTransactionStatusError(
      `GasFree transaction ${traceId} timed out after ${timeout / 1000}s`,
      traceId,
      lastTransactionHash,
      false,
    );
  }

  /**
   * Submit a signed GasFree transaction to the relayer.
   *
   * @param message - The GasFree message (Base58Check addresses).
   * @param signature - The TIP-712 signature (0x-prefixed or raw hex).
   * @returns The transaction trace id.
   */
  async submit(message: GasFreeSubmitMessage, signature: string): Promise<string> {
    const url = `${this.baseUrl}/api/v1/gasfree/submit`;
    const sig = signature.startsWith("0x") ? signature.slice(2) : signature;
    const payload = {
      token: message.token,
      serviceProvider: message.serviceProvider,
      user: message.user,
      receiver: message.receiver,
      value: message.value.toString(),
      maxFee: message.maxFee.toString(),
      deadline: Number(message.deadline),
      version: Number(message.version),
      nonce: Number(message.nonce),
      sig,
      requestId: `x402-${Date.now()}-${sig.slice(0, 8)}`,
    };

    const response = await fetch(url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
    const bodyText = await response.text();
    if (!response.ok) {
      throw new Error(`GasFree submit HTTP error: ${response.status} - ${bodyText}`);
    }
    const result = JSON.parse(bodyText) as GasFreeResponse<GasFreeSubmitResponseData>;
    if (result.code !== 200 || result.data == null || result.data.id == null) {
      throw new Error(`GasFree submit API error: ${result.message || result.reason} - ${bodyText}`);
    }
    return result.data.id;
  }

  /**
   * Build the default request headers.
   *
   * @returns The HTTP headers for relayer requests.
   */
  private headers(): Record<string, string> {
    return { "Content-Type": "application/json" };
  }
}

/**
 * Build a map of network → GasFreeAPIClient from base URLs.
 *
 * @param baseUrls - Map of network to relayer base URL.
 * @returns A map of network to API client.
 */
export function createGasFreeApiClients(
  baseUrls: Record<string, string>,
): Record<string, GasFreeAPIClient> {
  const clients: Record<string, GasFreeAPIClient> = {};
  for (const [network, url] of Object.entries(baseUrls)) {
    clients[network] = new GasFreeAPIClient(url);
  }
  return clients;
}

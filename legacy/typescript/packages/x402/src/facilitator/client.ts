/**
 * FacilitatorClient — TypeScript port of `bankofai.x402.facilitator.FacilitatorClient`.
 *
 * Talks to a remote x402 facilitator via HTTP. Handles `/supported`, `/fee/quote`,
 * `/verify`, `/settle`. Used by server middleware (Hono / Express / etc.) to verify
 * payments off-chain and trigger on-chain settlement.
 */

import { FacilitatorError } from '../errors.js';
import type {
  FeeQuoteResponse,
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  SupportedResponse,
  VerifyResponse,
} from '../types/index.js';

/** Configuration for {@link FacilitatorClient}. */
export interface FacilitatorClientConfig {
  /** Facilitator service base URL (trailing slash optional, will be normalized). */
  baseUrl: string;
  /** Optional custom HTTP headers (e.g. `Authorization`). */
  headers?: Record<string, string>;
  /** Stable identifier for this facilitator. Defaults to `baseUrl`. */
  facilitatorId?: string;
  /** Per-request timeout in milliseconds. Defaults to 120 000 (120 s). */
  timeoutMs?: number;
  /** Custom fetch implementation (defaults to global `fetch`). Useful for tests. */
  fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Optional payment context forwarded to `/fee/quote`.
 *
 * Wire field is `paymentPermitContext` to match the facilitator API; the client
 * accepts a plain JSON-shaped object and forwards it as-is.
 */
export type FeeQuoteContext = Record<string, unknown>;

/**
 * HTTP client for an x402 facilitator service.
 *
 * Mirrors the Python `FacilitatorClient` interface 1:1 so server middleware on
 * either runtime sees the same shape.
 */
export class FacilitatorClient {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  /** Stable identifier for this facilitator (defaults to `baseUrl`). */
  readonly facilitatorId: string;

  constructor(config: FacilitatorClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.headers = { ...(config.headers ?? {}) };
    this.facilitatorId = config.facilitatorId ?? this.baseUrl;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  /**
   * Query facilitator's supported (`x402Version`, `scheme`, `network`) tuples.
   */
  async supported(): Promise<SupportedResponse> {
    return this.requestJson<SupportedResponse>('GET', '/supported');
  }

  /**
   * Request fee quotes for a list of payment requirements.
   *
   * @param accepts - The same `accepts[]` you would put in `PaymentRequired`.
   * @param context - Optional `paymentPermitContext`.
   */
  async feeQuote(
    accepts: PaymentRequirements[],
    context?: FeeQuoteContext,
  ): Promise<FeeQuoteResponse[]> {
    const body: Record<string, unknown> = { accepts };
    if (context !== undefined) {
      body.paymentPermitContext = context;
    }
    return this.requestJson<FeeQuoteResponse[]>('POST', '/fee/quote', body);
  }

  /**
   * Verify a payment payload off-chain (no on-chain transaction).
   *
   * Server middleware should call this **before** routing the actual request
   * handler — only proceed to settlement if {@link VerifyResponse.isValid} is true.
   */
  async verify(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<VerifyResponse> {
    return this.requestJson<VerifyResponse>('POST', '/verify', {
      paymentPayload: payload,
      paymentRequirements: requirements,
    });
  }

  /**
   * Execute on-chain settlement for a verified payment.
   *
   * Returns a {@link SettleResponse} carrying the transaction hash on success
   * or an `errorReason` on failure.
   */
  async settle(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<SettleResponse> {
    return this.requestJson<SettleResponse>('POST', '/settle', {
      paymentPayload: payload,
      paymentRequirements: requirements,
    });
  }

  /**
   * Symmetry with the Python client. The TS implementation uses the global
   * `fetch` (no persistent connection pool to close); this is a no-op kept for
   * API parity so callers can write the same teardown logic on both runtimes.
   */
  async close(): Promise<void> {
    // no-op — `fetch` does not require explicit cleanup
  }

  private async requestJson<TResponse>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<TResponse> {
    const url = `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    const init: RequestInit = {
      method,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...this.headers,
      },
      signal: controller.signal,
    };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }

    let response: Response;
    try {
      response = await this.fetchImpl(url, init);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new FacilitatorError(
          `Facilitator request to ${path} timed out after ${this.timeoutMs}ms`,
          0,
        );
      }
      throw new FacilitatorError(
        `Facilitator request to ${path} failed: ${(err as Error).message}`,
        0,
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const text = await this.safeReadText(response);
      throw new FacilitatorError(
        `Facilitator returned HTTP ${response.status} for ${path}`,
        response.status,
        text,
      );
    }

    try {
      return (await response.json()) as TResponse;
    } catch (err) {
      throw new FacilitatorError(
        `Facilitator response from ${path} was not valid JSON: ${(err as Error).message}`,
        response.status,
      );
    }
  }

  private async safeReadText(response: Response): Promise<string | null> {
    try {
      return await response.text();
    } catch {
      return null;
    }
  }
}

/**
 * Lightweight HTTP client for the BankofAI facilitator.
 *
 * The TS SDK exposes the protocol shapes (PaymentRequirements, PaymentPayload,
 * VerifyResponse, SettleResponse, FeeQuoteResponse) but not an HTTP wrapper
 * that calls /fee/quote, /verify, /settle. The CLI needs those for the
 * `transfer` command (where it acts as both requirements-issuer and payer)
 * and for `server` later.
 *
 * Single endpoint surface; no retries; no auth headers (the BankofAI proxy is
 * unauthenticated). Errors normalize to X402CliError with the standard codes.
 */

import type {
  PaymentPayload,
  PaymentRequirements,
  VerifyResponse,
  SettleResponse,
  FeeQuoteResponse,
} from '@bankofai/x402';
import { X402CliError } from './error.js';

const DEFAULT_TIMEOUT_MS = 30_000;

export class FacilitatorHttpClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(baseUrl: string, opts: { timeoutMs?: number } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async feeQuote(
    accepts: PaymentRequirements[],
    paymentPermitContext?: unknown,
  ): Promise<FeeQuoteResponse[]> {
    const body: Record<string, unknown> = { accepts };
    if (paymentPermitContext) body.paymentPermitContext = paymentPermitContext;
    const data = await this.post<FeeQuoteResponse[] | { quotes: FeeQuoteResponse[] }>(
      '/fee/quote',
      body,
      'FEE_QUOTE_NOT_FOUND',
    );
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.quotes)) return data.quotes;
    return [];
  }

  async verify(
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements,
  ): Promise<VerifyResponse> {
    return this.post<VerifyResponse>(
      '/verify',
      { paymentPayload, paymentRequirements },
      'VERIFY_FAILED',
    );
  }

  async settle(
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements,
  ): Promise<SettleResponse> {
    return this.post<SettleResponse>(
      '/settle',
      { paymentPayload, paymentRequirements },
      'SETTLE_FAILED',
    );
  }

  private async post<T>(
    pathname: string,
    body: unknown,
    failureCode: 'FEE_QUOTE_NOT_FOUND' | 'VERIFY_FAILED' | 'SETTLE_FAILED',
  ): Promise<T> {
    const url = `${this.baseUrl}${pathname}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new X402CliError(
        'FACILITATOR_UNAVAILABLE',
        `Facilitator request to ${url} failed: ${(err as Error).message}`,
        'Check network connectivity, X402_FACILITATOR_URL_OVERRIDE if set, or BankofAI status.',
      );
    }
    const text = await res.text();
    if (!res.ok) {
      throw new X402CliError(
        failureCode,
        `Facilitator ${pathname} returned HTTP ${res.status}: ${text.slice(0, 240)}`,
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new X402CliError(
        failureCode,
        `Facilitator ${pathname} returned non-JSON body: ${(err as Error).message}`,
      );
    }
    return parsed as T;
  }
}

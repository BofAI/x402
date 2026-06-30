/**
 * X402FetchClient — Fetch-based HTTP client with automatic 402 payment handling.
 *
 * Mirrors `bankofai.x402.clients.X402HttpClient` on the Python side. Wraps the
 * global `fetch` (configurable for tests) so agent code can call any URL and
 * have 402 challenges silently handled — challenge → sign → retry → return
 * the final 200 response, with the settled payment receipt parseable via
 * {@link parsePaymentResponseHeader}.
 */

import {
  type PaymentPayload,
  type PaymentRequired,
  type PaymentRequirementsSelector,
  type SettleResponse,
  X402Client,
  decodePaymentPayload,
  encodePaymentPayload,
} from '../index.js';

/** Wire-format header names. */
export const PAYMENT_SIGNATURE_HEADER = 'PAYMENT-SIGNATURE';
export const PAYMENT_REQUIRED_HEADER = 'PAYMENT-REQUIRED';
export const PAYMENT_RESPONSE_HEADER = 'PAYMENT-RESPONSE';

/** Constructor options for {@link X402FetchClient}. */
export interface X402FetchClientOptions {
  /** Custom payment requirements selector (defaults to library default). */
  selector?: PaymentRequirementsSelector;
  /** Custom fetch implementation (defaults to global `fetch`). Useful for tests. */
  fetchImpl?: typeof fetch;
}

/**
 * Fetch-based HTTP client with automatic 402 payment handling.
 *
 * @example
 * ```ts
 * const x402Client = new X402Client(...).register(mechanism);
 * const httpClient = new X402FetchClient(x402Client);
 *
 * const res = await httpClient.get('https://api.example.com/llm');
 * if (res.ok) {
 *   const settled = parsePaymentResponseHeader(res);
 *   console.log('paid via tx', settled?.transaction);
 * }
 * ```
 */
export class X402FetchClient {
  private readonly x402Client: X402Client;
  private readonly selector?: PaymentRequirementsSelector;
  private readonly fetchImpl: typeof fetch;

  constructor(
    x402Client: X402Client,
    selectorOrOptions?: PaymentRequirementsSelector | X402FetchClientOptions,
  ) {
    this.x402Client = x402Client;
    if (typeof selectorOrOptions === 'function') {
      this.selector = selectorOrOptions;
      this.fetchImpl = fetch;
    } else {
      this.selector = selectorOrOptions?.selector;
      this.fetchImpl = selectorOrOptions?.fetchImpl ?? fetch;
    }
  }

  /**
   * Issue a request with automatic 402 → pay → retry handling.
   *
   * If the server returns a non-402 status, the response is passed through.
   * If the 402 cannot be parsed (no PAYMENT-REQUIRED header and no parseable
   * body), the original 402 is returned to the caller for inspection.
   */
  async request(url: string, init?: RequestInit): Promise<Response> {
    const response = await this.fetchImpl(url, init);
    if (response.status !== 402) {
      return response;
    }

    const paymentRequired = await this.parsePaymentRequired(response);
    if (!paymentRequired) {
      return response;
    }

    const paymentPayload = await this.x402Client.handlePayment(
      paymentRequired.accepts,
      url,
      paymentRequired.extensions,
      this.selector,
    );

    return this.retryWithPayment(url, init, paymentPayload);
  }

  /** GET shorthand. */
  async get(url: string, init?: RequestInit): Promise<Response> {
    return this.request(url, { ...init, method: 'GET' });
  }

  /** POST shorthand. */
  async post(
    url: string,
    body?: RequestInit['body'],
    init?: RequestInit,
  ): Promise<Response> {
    return this.request(url, { ...init, method: 'POST', body });
  }

  /** PUT shorthand. */
  async put(
    url: string,
    body?: RequestInit['body'],
    init?: RequestInit,
  ): Promise<Response> {
    return this.request(url, { ...init, method: 'PUT', body });
  }

  /** PATCH shorthand. */
  async patch(
    url: string,
    body?: RequestInit['body'],
    init?: RequestInit,
  ): Promise<Response> {
    return this.request(url, { ...init, method: 'PATCH', body });
  }

  /** DELETE shorthand. */
  async delete(url: string, init?: RequestInit): Promise<Response> {
    return this.request(url, { ...init, method: 'DELETE' });
  }

  /**
   * Try to parse a `PaymentRequired` from the 402 response.
   *
   * Order:
   * 1. `PAYMENT-REQUIRED` header (base64 JSON).
   * 2. JSON body fallback when header is missing or undecodable.
   *
   * Returns `null` if neither path yields a recognizable shape.
   */
  private async parsePaymentRequired(response: Response): Promise<PaymentRequired | null> {
    const headerValue = response.headers.get(PAYMENT_REQUIRED_HEADER);
    if (headerValue) {
      try {
        return decodePaymentPayload<PaymentRequired>(headerValue);
      } catch {
        // Header malformed — fall through to body.
      }
    }

    try {
      const body = (await response.clone().json()) as Record<string, unknown>;
      if (Array.isArray(body.accepts)) {
        return body as unknown as PaymentRequired;
      }
    } catch {
      // Body not parseable — give up.
    }

    return null;
  }

  /** Re-issue the original request with the encoded payment payload header. */
  private async retryWithPayment(
    url: string,
    init: RequestInit | undefined,
    paymentPayload: PaymentPayload,
  ): Promise<Response> {
    const encoded = encodePaymentPayload(paymentPayload);
    const headers = new Headers(init?.headers);
    headers.set(PAYMENT_SIGNATURE_HEADER, encoded);
    return this.fetchImpl(url, { ...init, headers });
  }
}

/**
 * Pull the {@link SettleResponse} out of a 200 response's PAYMENT-RESPONSE header.
 *
 * Servers attach this on success so the client can record the settlement tx
 * hash / network without making a separate facilitator call.
 *
 * @returns The decoded settle response, or `null` if the header is absent or malformed.
 */
export function parsePaymentResponseHeader(response: Response): SettleResponse | null {
  const headerValue = response.headers.get(PAYMENT_RESPONSE_HEADER);
  if (!headerValue) {
    return null;
  }
  try {
    return decodePaymentPayload<SettleResponse>(headerValue);
  } catch {
    return null;
  }
}

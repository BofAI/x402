/**
 * X402FetchClient - Fetch-based HTTP client with automatic 402 payment handling
 */

import {
  X402Client,
  PaymentRequired,
  PaymentPayload,
  PaymentRequirementsSelector,
  encodePaymentPayload,
  decodePaymentPayload,
} from '../index.js';

/** HTTP headers for x402 protocol */
const PAYMENT_SIGNATURE_HEADER = 'PAYMENT-SIGNATURE';
const PAYMENT_REQUIRED_HEADER = 'PAYMENT-REQUIRED';
const PAYMENT_RESPONSE_HEADER = 'PAYMENT-RESPONSE';

/**
 * Fetch-based HTTP client with automatic 402 payment handling
 */
export class X402FetchClient {
  private x402Client: X402Client;
  private selector?: PaymentRequirementsSelector;

  constructor(
    x402Client: X402Client,
    selector?: PaymentRequirementsSelector
  ) {
    this.x402Client = x402Client;
    this.selector = selector;
  }

  /**
   * Make request with automatic 402 payment handling
   */
  async request(
    url: string,
    init?: RequestInit
  ): Promise<Response> {
    const response = await fetch(url, init);

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
      this.selector
    );

    return this.retryWithPayment(url, init, paymentPayload);
  }

  /**
   * GET request with payment handling
   */
  async get(url: string, init?: RequestInit): Promise<Response> {
    return this.request(url, { ...init, method: 'GET' });
  }

  /**
   * POST request with payment handling
   */
  async post(url: string, body?: RequestInit['body'], init?: RequestInit): Promise<Response> {
    return this.request(url, { ...init, method: 'POST', body });
  }

  /**
   * Parse PaymentRequired from 402 response
   */
  private async parsePaymentRequired(response: Response): Promise<PaymentRequired | null> {
    const headerValue = response.headers.get(PAYMENT_REQUIRED_HEADER);
    if (headerValue) {
      try {
        return decodePaymentPayload<PaymentRequired>(headerValue);
      } catch {
        // Continue to parse body
      }
    }

    try {
      const body = await response.json() as Record<string, unknown>;
      if (body.accepts && Array.isArray(body.accepts)) {
        return body as unknown as PaymentRequired;
      }
    } catch {
      // Unable to parse
    }

    return null;
  }

  /**
   * Retry request with payment payload
   */
  private async retryWithPayment(
    url: string,
    init: RequestInit | undefined,
    paymentPayload: PaymentPayload
  ): Promise<Response> {
    const encodedPayload = encodePaymentPayload(paymentPayload);
    
    const headers = new Headers(init?.headers);
    headers.set(PAYMENT_SIGNATURE_HEADER, encodedPayload);

    return fetch(url, {
      ...init,
      headers,
    });
  }
}

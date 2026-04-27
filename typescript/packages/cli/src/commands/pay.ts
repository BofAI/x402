/**
 * `x402 pay` — fetch a 402-protected URL with automatic payment.
 *
 * Wraps the SDK's X402FetchClient. The CLI's job is to:
 *  - resolve the active profile + register a TRON GasFree mechanism
 *  - call client.request(url, ...) so the SDK handles the 402 challenge
 *  - extract the PAYMENT-RESPONSE header from the final response
 *  - append a receipt and print a stable envelope
 *
 * MVP scope: TRON exact_gasfree (the only client mechanism the CLI registers
 * by default). Adding `exact` / `exact_permit` is straightforward but lands
 * with EVM wallet support, post-MVP.
 */

import {
  X402Client,
  X402FetchClient,
  TronClientSigner,
  GasFreeAPIClient,
  decodePaymentPayload,
  type SettleResponse,
} from '@bankofai/x402';
import { runCommand, type OutputMode } from '../output.js';
import { loadConfig, getProfile, applyEnvOverrides } from '../config.js';
import { getFacilitatorBaseUrl } from '../facilitator.js';
import { X402CliError } from '../error.js';
import { newPaymentId } from '../amount.js';
import { appendReceipt, type Receipt } from '../receipts.js';

export interface PayOpts {
  url: string;
  method?: string;
  headers?: string[];
  body?: string;
  profile?: string;
  network?: string;
  scheme?: string;
  maxAmount?: string;
  dryRun?: boolean;
  output: OutputMode;
}

const PAYMENT_RESPONSE_HEADER = 'PAYMENT-RESPONSE';

export async function cmdPay(opts: PayOpts): Promise<number> {
  return runCommand({ command: 'pay' }, opts.output, async () => {
    if (!opts.url) {
      throw new X402CliError('INVALID_INPUT', `URL is required.`);
    }
    const cfg = await loadConfig();
    const { name: profileName, profile } = getProfile(cfg, opts.profile);
    const effective = applyEnvOverrides(profile);
    const network = opts.network || effective.network;
    const scheme = opts.scheme || effective.scheme;

    if (!network.startsWith('tron:')) {
      throw new X402CliError(
        'UNSUPPORTED_NETWORK',
        `pay currently registers TRON GasFree only; got ${network}.`,
        `EVM payment support lands with the next iteration.`,
      );
    }
    if (scheme && scheme !== 'exact_gasfree') {
      // Fallthrough — server may offer a different scheme; we register only
      // gasfree and let the SDK skip mismatched options. Surface a warning.
      // (We don't fail outright since the server's `accepts[]` is authoritative.)
      process.stderr.write(
        `[x402] profile scheme=${scheme}; CLI registers exact_gasfree only. ` +
          `Server-side scheme mismatch will surface as 'no supported payment requirements'.\n`,
      );
    }

    const facilitatorUrl = getFacilitatorBaseUrl(network);
    const gasFreeClient = new GasFreeAPIClient(facilitatorUrl);

    const init = buildRequestInit(opts);

    if (opts.dryRun) {
      // Probe the URL to see what payment options the server lists, but never
      // sign. We use a one-shot fetch + parse-header path.
      const probeRes = await fetch(opts.url, init);
      if (probeRes.status !== 402) {
        return {
          dryRun: true,
          url: opts.url,
          status: probeRes.status,
          note: 'server did not return 402; nothing to pay for',
        };
      }
      const headerValue = probeRes.headers.get('PAYMENT-REQUIRED');
      const headerJson = headerValue ? safeDecodeBase64Json(headerValue) : null;
      let bodyJson: unknown = null;
      try {
        const text = await probeRes.text();
        bodyJson = text ? JSON.parse(text) : null;
      } catch {
        /* swallow */
      }
      return {
        dryRun: true,
        url: opts.url,
        status: 402,
        accepts: pickAccepts(headerJson) ?? pickAccepts(bodyJson),
      };
    }

    const signer = await TronClientSigner.create();
    const x402 = new X402Client();
    x402.registerGasFree(signer, { [network]: gasFreeClient });
    const client = new X402FetchClient(x402);

    let response: Response;
    try {
      response = await client.request(opts.url, init);
    } catch (err) {
      throw new X402CliError(
        'SETTLE_FAILED',
        `pay flow failed: ${(err as Error).message}`,
      );
    }

    const responseText = await response.text();
    let bodyJson: unknown = null;
    try {
      bodyJson = responseText ? JSON.parse(responseText) : null;
    } catch {
      bodyJson = responseText;
    }

    const paymentResponseHeader = response.headers.get(PAYMENT_RESPONSE_HEADER);
    const paymentResponse: SettleResponse | null = paymentResponseHeader
      ? safeDecodePaymentResponse(paymentResponseHeader)
      : null;

    if (paymentResponse?.success) {
      const payer = signer.getAddress();
      const receipt: Receipt = {
        paymentId: newPaymentId(),
        command: 'pay',
        createdAt: new Date().toISOString(),
        profile: profileName,
        network,
        scheme: scheme || 'exact_gasfree',
        payer,
        payTo: '',
        token: '',
        asset: '',
        amount: '',
        amountDisplay: '',
        settlement: {
          success: true,
          transaction: paymentResponse.transaction,
        },
        extra: {
          url: opts.url,
          status: response.status,
          paymentResponse,
        },
      };
      await appendReceipt(receipt);
    }

    if (response.status >= 400) {
      throw new X402CliError(
        'SETTLE_FAILED',
        `Server returned HTTP ${response.status} after payment retry.`,
        bodyJson ? `Body: ${JSON.stringify(bodyJson).slice(0, 240)}` : undefined,
      );
    }

    return {
      url: opts.url,
      status: response.status,
      paymentResponse: paymentResponse ?? null,
      body: bodyJson,
    };
  });
}

function buildRequestInit(opts: PayOpts): RequestInit {
  const init: RequestInit = { method: opts.method?.toUpperCase() || 'GET' };
  const headers = new Headers();
  for (const h of opts.headers ?? []) {
    const idx = h.indexOf(':');
    if (idx <= 0) {
      throw new X402CliError('INVALID_INPUT', `Bad --header value (expect 'Key: value'): ${h}`);
    }
    headers.set(h.slice(0, idx).trim(), h.slice(idx + 1).trim());
  }
  init.headers = headers;
  if (opts.body) {
    init.body = opts.body;
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  }
  return init;
}

function safeDecodeBase64Json(headerValue: string): unknown {
  try {
    const decoded = Buffer.from(headerValue, 'base64').toString('utf8');
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

function safeDecodePaymentResponse(headerValue: string): SettleResponse | null {
  try {
    return decodePaymentPayload<SettleResponse>(headerValue);
  } catch {
    return null;
  }
}

function pickAccepts(parsed: unknown): unknown {
  if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { accepts?: unknown }).accepts)) {
    return (parsed as { accepts: unknown[] }).accepts;
  }
  return null;
}

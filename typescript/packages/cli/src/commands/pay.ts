/**
 * `x402 pay` — fetch a 402-protected URL with automatic payment.
 *
 * Wraps the SDK's X402FetchClient. The CLI's job is to:
 *  - resolve the active profile + register the matching client mechanisms
 *  - call client.request(url, ...) so the SDK handles the 402 challenge
 *  - extract the PAYMENT-RESPONSE header from the final response
 *  - append a receipt and print a stable envelope
 *
 * TRON defaults to exact_permit. EVM/BSC registers exact_permit and exact so
 * facilitator/merchant settlement pays chain gas while the user signs only.
 */

import {
  X402Client,
  X402FetchClient,
  GasFreeAPIClient,
  ExactEvmClientMechanism,
  ExactPermitEvmClientMechanism,
  ExactPermitTronClientMechanism,
  decodePaymentPayload,
  isEvmNetwork,
  isTronNetwork,
  type SettleResponse,
  type ClientSigner,
  type PaymentRequirements,
} from '@bankofai/x402';
import { runCommand, type OutputMode } from '../output.js';
import { loadConfig, getProfile, applyEnvOverrides } from '../config.js';
import { getFacilitatorBaseUrl } from '../facilitator.js';
import { X402CliError } from '../error.js';
import { newPaymentId } from '../amount.js';
import { appendReceipt, type Receipt } from '../receipts.js';
import { createEvmClientSignerFromEnv, createTronClientSignerFromEnv } from '../wallet.js';

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

    if (!isTronNetwork(network) && !isEvmNetwork(network)) {
      throw new X402CliError('UNSUPPORTED_NETWORK', `Unsupported network ${network}.`);
    }

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

    const x402 = new X402Client();
    const signer = registerPayMechanisms(x402, network);
    const client = new X402FetchClient(x402, buildSelector({ network, scheme, maxAmount: opts.maxAmount }));

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
        scheme: scheme || (isEvmNetwork(network) ? 'exact_permit/exact' : 'exact_permit/exact_gasfree'),
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

function registerPayMechanisms(x402: X402Client, network: string): ClientSigner {
  if (isEvmNetwork(network)) {
    const signer = createEvmClientSignerFromEnv();
    x402.register('eip155:*', new ExactPermitEvmClientMechanism(signer));
    x402.register('eip155:*', new ExactEvmClientMechanism(signer));
    return signer;
  }
  const signer = createTronClientSignerFromEnv();
  const facilitatorUrl = getFacilitatorBaseUrl(network);
  x402.register('tron:*', new ExactPermitTronClientMechanism(signer));
  x402.registerGasFree(signer, { [network]: new GasFreeAPIClient(facilitatorUrl) });
  return signer;
}

function buildSelector(filters: {
  network: string;
  scheme?: string;
  maxAmount?: string;
}): ((requirements: PaymentRequirements[]) => PaymentRequirements) {
  return (requirements) => {
    let candidates = requirements.filter((r) => r.network === filters.network);
    const supportedSchemes = isEvmNetwork(filters.network)
      ? new Set(['exact_permit', 'exact'])
      : new Set(['exact_permit', 'exact_gasfree']);
    candidates = candidates.filter((r) => supportedSchemes.has(r.scheme));
    if (filters.scheme) candidates = candidates.filter((r) => r.scheme === filters.scheme);
    if (filters.maxAmount) {
      const max = BigInt(filters.maxAmount);
      candidates = candidates.filter((r) => BigInt(r.amount) <= max);
    }
    if (!candidates.length) {
      throw new X402CliError(
        'UNSUPPORTED_SCHEME',
        `Server did not offer a supported payment requirement for ${filters.network}.`,
      );
    }
    return candidates[0]!;
  };
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

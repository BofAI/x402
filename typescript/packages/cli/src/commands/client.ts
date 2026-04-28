/**
 * `x402-tools client <url>` — pay an x402-protected URL.
 *
 * Flow:
 *   1. fetch the URL once.
 *   2. if not 402: print response summary and exit.
 *   3. if 402: parse PaymentRequirements, validate against caller-supplied
 *      guards (--max-decimal | --max-amount, --network, --token,
 *      --scheme), sign + retry, and print the settlement.
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
  type PaymentRequired,
  type PaymentRequirements,
} from '@bankofai/x402';
import { runCommand, type OutputMode } from '../output.js';
import { getFacilitatorBaseUrl } from '../facilitator.js';
import { X402CliError } from '../error.js';
import { resolveToken, formatSmallestUnit, parseHumanAmount } from '../amount.js';
import { resolveTronClientSigner, resolveEvmClientSigner, type WalletSource } from '../wallet.js';

const PAYMENT_RESPONSE_HEADER = 'PAYMENT-RESPONSE';
const PAYMENT_REQUIRED_HEADER = 'PAYMENT-REQUIRED';

export interface ClientOpts {
  url: string;
  method?: string;
  headers?: string[];
  body?: string;
  /** Caps in human form (parsed against the chosen requirement's token). */
  maxDecimal?: string;
  /** Caps in smallest-unit BigInt-able string. */
  maxAmount?: string;
  network?: string;
  token?: string;
  scheme?: string;
  wallet?: WalletSource;
  dryRun?: boolean;
  yes?: boolean;
  output: OutputMode;
}

export async function cmdClient(opts: ClientOpts): Promise<number> {
  return runCommand({ command: 'client' }, opts.output, async () => {
    if (!opts.url) {
      throw new X402CliError('INVALID_INPUT', `URL is required.`);
    }
    if (opts.maxDecimal && opts.maxAmount) {
      throw new X402CliError(
        'INVALID_AMOUNT',
        `--max-decimal and --max-amount are mutually exclusive.`,
      );
    }

    const init = buildRequestInit(opts);
    const probeRes = await fetch(opts.url, init);

    // Not a 402 — print summary and finish.
    if (probeRes.status !== 402) {
      const text = await probeRes.text();
      let bodyJson: unknown = null;
      try {
        bodyJson = text ? JSON.parse(text) : null;
      } catch {
        bodyJson = text;
      }
      return {
        url: opts.url,
        status: probeRes.status,
        note: '402 not returned; nothing to pay for',
        body: bodyJson,
      };
    }

    const required = await decode402Body(probeRes);
    if (!required || !required.accepts.length) {
      throw new X402CliError(
        'INVALID_INPUT',
        `Server returned 402 but PAYMENT-REQUIRED could not be parsed.`,
      );
    }

    // Apply caller guards before signing. Reject early on policy mismatch.
    const candidates = filterAccepts(required.accepts, opts);
    if (!candidates.length) {
      throw new X402CliError(
        'PAYMENT_CANCELLED',
        `No payment requirement passed the caller-supplied guards (--max-* / --network / --token / --scheme).`,
      );
    }
    const chosen = candidates[0]!;

    if (opts.dryRun) {
      return {
        url: opts.url,
        status: 402,
        accepts: required.accepts,
        chosen: summarizeRequirement(chosen),
      };
    }

    // Sign + retry.
    const x402 = new X402Client();
    const signer = await registerMechanisms(x402, chosen.network, opts.wallet ?? 'agent-wallet');
    const fetchClient = new X402FetchClient(x402, () => chosen);

    let response: Response;
    try {
      response = await fetchClient.request(opts.url, init);
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
      payer: signer.getAddress(),
      chosen: summarizeRequirement(chosen),
      paymentResponse,
      body: bodyJson,
    };
  });
}

function filterAccepts(accepts: PaymentRequirements[], opts: ClientOpts): PaymentRequirements[] {
  let out = accepts.slice();
  if (opts.network) out = out.filter((r) => r.network === opts.network);
  if (opts.scheme) out = out.filter((r) => r.scheme === opts.scheme);
  if (opts.token) {
    const wanted = opts.token.toUpperCase();
    out = out.filter((r) => {
      try {
        const token = resolveToken({ network: r.network, asset: r.asset });
        return token.symbol.toUpperCase() === wanted;
      } catch {
        return false;
      }
    });
  }
  if (opts.maxAmount) {
    if (!/^[0-9]+$/.test(opts.maxAmount)) {
      throw new X402CliError('INVALID_AMOUNT', `--max-amount must be a non-negative integer.`);
    }
    const cap = BigInt(opts.maxAmount);
    out = out.filter((r) => BigInt(r.amount) <= cap);
  }
  if (opts.maxDecimal) {
    out = out.filter((r) => {
      try {
        const token = resolveToken({ network: r.network, asset: r.asset });
        const cap = parseHumanAmount(opts.maxDecimal!, token.decimals);
        return BigInt(r.amount) <= cap;
      } catch {
        return false;
      }
    });
  }
  return out;
}

async function registerMechanisms(
  x402: X402Client,
  network: string,
  walletSource: WalletSource,
): Promise<ClientSigner> {
  if (isEvmNetwork(network)) {
    const signer = await resolveEvmClientSigner(walletSource);
    x402.register('eip155:*', new ExactPermitEvmClientMechanism(signer));
    x402.register('eip155:*', new ExactEvmClientMechanism(signer));
    return signer;
  }
  if (isTronNetwork(network)) {
    const signer = await resolveTronClientSigner(walletSource);
    const facilitatorUrl = getFacilitatorBaseUrl(network);
    x402.register('tron:*', new ExactPermitTronClientMechanism(signer));
    x402.registerGasFree(signer, { [network]: new GasFreeAPIClient(facilitatorUrl) });
    return signer;
  }
  throw new X402CliError('UNSUPPORTED_NETWORK', `Unsupported network ${network}.`);
}

function buildRequestInit(opts: ClientOpts): RequestInit {
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

async function decode402Body(res: Response): Promise<PaymentRequired | null> {
  const headerValue = res.headers.get(PAYMENT_REQUIRED_HEADER);
  if (headerValue) {
    try {
      return decodePaymentPayload<PaymentRequired>(headerValue);
    } catch {
      /* fall through to body */
    }
  }
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as PaymentRequired;
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

function summarizeRequirement(r: PaymentRequirements) {
  let decimal: string | null = null;
  try {
    const token = resolveToken({ network: r.network, asset: r.asset });
    decimal = formatSmallestUnit(r.amount, token.decimals);
  } catch {
    /* ignore — not in registry */
  }
  return {
    network: r.network,
    scheme: r.scheme,
    asset: r.asset,
    pay_to: r.payTo,
    amount: r.amount,
    decimal,
  };
}

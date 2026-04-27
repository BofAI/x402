/**
 * `x402 serve transfer` — start a temporary collection server.
 *
 * Exposes a single payable endpoint that any `x402 pay <url>` (or any other
 * x402-compatible client) can settle into. The CLI plays the role of a
 * minimal resource server: it issues PaymentRequirements challenges,
 * caches them per paymentId, and on the retry verifies the payload's
 * `accepted` block against the issued challenge before submitting to
 * GasFree for settlement (same in-process path as `x402 transfer`).
 *
 * MVP scope:
 *   - TRON exact_gasfree only.
 *   - In-memory challenge store; pending challenges expire after 5 min.
 *   - Settlement uses the same GasFreeAPIClient.submit + waitForSuccess
 *     path as transfer; we do not call /verify nor /settle on the
 *     facilitator (BankofAI hosts only the GasFree proxy).
 *   - SIGINT / SIGTERM trigger a graceful shutdown after the in-flight
 *     settle (if any) completes.
 *
 * Endpoints:
 *   GET  /health                  — liveness; returns { ok: true }
 *   GET  /.well-known/x402-transfer — issued payment terms
 *   POST /pay                      — protected, settles the payment
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import {
  GasFreeAPIClient,
  encodePaymentPayload,
  decodePaymentPayload,
  TronClientSigner,
  X402Client,
  getChainId,
  getGasFreeControllerAddress,
  type PaymentPayload,
  type PaymentPermit,
  type PaymentRequirements,
  type PaymentRequired,
  type SettleResponse,
} from '@bankofai/x402';
import { TronWeb } from 'tronweb';
import { runCommand, type OutputMode } from '../output.js';
import { loadConfig, getProfile, applyEnvOverrides } from '../config.js';
import { getFacilitatorBaseUrl } from '../facilitator.js';
import { X402CliError } from '../error.js';
import {
  resolveToken,
  parseHumanAmount,
  formatSmallestUnit,
  newPaymentId,
} from '../amount.js';
import { appendReceipt, type Receipt } from '../receipts.js';

const PAYMENT_REQUIRED_HEADER = 'PAYMENT-REQUIRED';
const PAYMENT_SIGNATURE_HEADER = 'PAYMENT-SIGNATURE';
const PAYMENT_RESPONSE_HEADER = 'PAYMENT-RESPONSE';

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

export interface ServeTransferOpts {
  host?: string;
  port?: number;
  payTo: string;
  amount: string;
  token?: string;
  asset?: string;
  decimals?: number;
  network?: string;
  scheme?: string;
  profile?: string;
  output: OutputMode;
}

export async function cmdServeTransfer(opts: ServeTransferOpts): Promise<number> {
  return runCommand({ command: 'serve transfer' }, opts.output, async () => {
    const cfg = await loadConfig();
    const { name: profileName, profile } = getProfile(cfg, opts.profile);
    const effective = applyEnvOverrides(profile);
    const network = opts.network || effective.network;
    const scheme = opts.scheme || effective.scheme;

    if (scheme !== 'exact_gasfree' || !network.startsWith('tron:')) {
      throw new X402CliError(
        'UNSUPPORTED_SCHEME',
        `serve transfer currently supports tron:* + exact_gasfree only; got ${network} / ${scheme}.`,
      );
    }
    if (!opts.payTo || !opts.payTo.trim()) {
      throw new X402CliError('INVALID_INPUT', `--pay-to <address> is required.`);
    }

    const tokenSymbol = opts.token || effective.token;
    const token = resolveToken({
      network,
      symbol: tokenSymbol,
      asset: opts.asset,
      decimals: opts.decimals,
    });
    const amountSmallest = parseHumanAmount(opts.amount, token.decimals);

    const facilitatorUrl = getFacilitatorBaseUrl(network);
    const gasFreeClient = new GasFreeAPIClient(facilitatorUrl);

    const challenges = new Map<string, IssuedChallenge>();
    const port = opts.port ?? 4020;
    const host = opts.host ?? '127.0.0.1';

    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host || `${host}:${port}`}`);
      try {
        if (req.method === 'GET' && url.pathname === '/health') {
          return sendJson(res, 200, { ok: true });
        }
        if (req.method === 'GET' && url.pathname === '/.well-known/x402-transfer') {
          return sendJson(res, 200, {
            network,
            scheme,
            token: token.symbol,
            asset: token.address,
            amount: amountSmallest.toString(),
            amountDisplay: `${formatSmallestUnit(amountSmallest, token.decimals)} ${token.symbol}`,
            payTo: opts.payTo.trim(),
            payUrl: `http://${host}:${port}/pay`,
          });
        }
        if ((req.method === 'GET' || req.method === 'POST') && url.pathname === '/pay') {
          await handlePay(req, res, {
            network,
            scheme,
            token,
            amountSmallest,
            payTo: opts.payTo.trim(),
            challenges,
            gasFreeClient,
            facilitatorUrl,
            profileName,
          });
          return;
        }
        sendJson(res, 404, { error: 'not found' });
      } catch (err) {
        process.stderr.write(`[x402 serve] handler error: ${(err as Error).message}\n`);
        sendJson(res, 500, { error: (err as Error).message });
      }
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => resolve());
    });

    const cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [id, ch] of challenges) {
        if (ch.expiresAt < now) challenges.delete(id);
      }
    }, 60_000);

    process.stdout.write(
      `x402 serve transfer listening on http://${host}:${port}/pay  ` +
        `(network=${network} scheme=${scheme} token=${token.symbol} amount=${formatSmallestUnit(
          amountSmallest,
          token.decimals,
        )} payTo=${opts.payTo})\n`,
    );

    await new Promise<void>((resolve) => {
      const shutdown = () => {
        process.stderr.write('[x402 serve] shutting down\n');
        clearInterval(cleanupTimer);
        server.close(() => resolve());
      };
      process.once('SIGINT', shutdown);
      process.once('SIGTERM', shutdown);
    });

    return {
      stopped: true,
      host,
      port,
      payTo: opts.payTo.trim(),
      issued: challenges.size,
    };
  });
}

interface IssuedChallenge {
  paymentId: string;
  requirements: PaymentRequirements;
  expiresAt: number;
}

interface PayCtx {
  network: string;
  scheme: string;
  token: ReturnType<typeof resolveToken>;
  amountSmallest: bigint;
  payTo: string;
  challenges: Map<string, IssuedChallenge>;
  gasFreeClient: GasFreeAPIClient;
  facilitatorUrl: string;
  profileName: string;
}

async function handlePay(req: IncomingMessage, res: ServerResponse, ctx: PayCtx): Promise<void> {
  const sigHeader = req.headers[PAYMENT_SIGNATURE_HEADER.toLowerCase()];
  const sigValue = Array.isArray(sigHeader) ? sigHeader[0] : sigHeader;

  if (!sigValue) {
    // Issue a fresh challenge.
    const requirements: PaymentRequirements = {
      scheme: ctx.scheme,
      network: ctx.network,
      amount: ctx.amountSmallest.toString(),
      asset: ctx.token.address,
      payTo: ctx.payTo,
      maxTimeoutSeconds: 180,
      extra: {
        name: ctx.token.name,
        version: ctx.token.version,
      },
    };
    const paymentId = newPaymentId();
    ctx.challenges.set(paymentId, {
      paymentId,
      requirements,
      expiresAt: Date.now() + CHALLENGE_TTL_MS,
    });
    const challenge: PaymentRequired = {
      x402Version: 2,
      accepts: [requirements],
      extensions: {
        paymentPermitContext: {
          meta: {
            kind: 'PAYMENT_ONLY',
            paymentId,
            nonce: '0',
            validAfter: Math.floor(Date.now() / 1000) - 5,
            validBefore: 0,
          },
        },
      },
    };
    res.statusCode = 402;
    res.setHeader(PAYMENT_REQUIRED_HEADER, encodePaymentPayload(challenge));
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(challenge));
    return;
  }

  // Retry with payment.
  let payload: PaymentPayload;
  try {
    payload = decodePaymentPayload<PaymentPayload>(sigValue);
  } catch (err) {
    return sendJson(res, 400, { error: `invalid PAYMENT-SIGNATURE: ${(err as Error).message}` });
  }
  const accepted = payload.accepted;
  const issuedId = payload.payload.paymentPermit?.meta?.paymentId;
  if (!issuedId) {
    return sendJson(res, 400, { error: 'payload missing paymentPermit.meta.paymentId' });
  }
  const issued = ctx.challenges.get(issuedId);
  if (!issued) {
    return sendJson(res, 400, { error: `unknown or expired challenge: ${issuedId}` });
  }
  if (
    accepted.scheme !== issued.requirements.scheme ||
    accepted.network !== issued.requirements.network ||
    accepted.asset !== issued.requirements.asset ||
    accepted.amount !== issued.requirements.amount ||
    accepted.payTo !== issued.requirements.payTo
  ) {
    return sendJson(res, 400, {
      error: 'tampered: payload.accepted does not match the issued challenge',
    });
  }

  const permit = payload.payload.paymentPermit as PaymentPermit | undefined;
  const signature = payload.payload.signature;
  if (!permit || !signature) {
    return sendJson(res, 400, { error: 'payload is missing paymentPermit or signature' });
  }

  // Submit to GasFree directly.
  const { domain, message } = buildGasFreeSubmitBody(ctx.network, permit);
  let traceId: string;
  try {
    traceId = await ctx.gasFreeClient.submit(domain, message, signature);
  } catch (err) {
    return sendJson(res, 500, { error: `gasfree submit failed: ${(err as Error).message}` });
  }
  let result;
  try {
    result = await ctx.gasFreeClient.waitForSuccess(traceId);
  } catch (err) {
    return sendJson(res, 500, { error: `gasfree polling failed: ${(err as Error).message}` });
  }
  const txnHash = result.txnHash;
  if (!txnHash) {
    return sendJson(res, 500, { error: `gasfree returned ${result.state} but txnHash was empty` });
  }

  ctx.challenges.delete(issuedId);

  // Receipt.
  const receipt: Receipt = {
    paymentId: issuedId,
    command: 'serve-transfer',
    createdAt: new Date().toISOString(),
    profile: ctx.profileName,
    network: ctx.network,
    scheme: ctx.scheme,
    payer: permit.buyer,
    payTo: ctx.payTo,
    token: ctx.token.symbol,
    asset: ctx.token.address,
    amount: ctx.amountSmallest.toString(),
    amountDisplay: `${formatSmallestUnit(ctx.amountSmallest, ctx.token.decimals)} ${ctx.token.symbol}`,
    feeAmount: permit.fee.feeAmount,
    settlement: { success: true, transaction: txnHash },
    extra: { traceId, deadline: permit.meta.validBefore },
  };
  await appendReceipt(receipt);

  const settleResponse: SettleResponse = {
    success: true,
    transaction: txnHash,
    network: ctx.network,
  };
  res.statusCode = 200;
  res.setHeader(PAYMENT_RESPONSE_HEADER, encodePaymentPayload(settleResponse));
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ ok: true, paymentId: issuedId, transaction: txnHash }));
}

function buildGasFreeSubmitBody(network: string, permit: PaymentPermit) {
  const chainId = getChainId(network);
  const controllerHex = base58ToEvmHex(getGasFreeControllerAddress(network));
  const domain = {
    name: 'GasFreeController',
    version: 'V1.0.0',
    chainId,
    verifyingContract: controllerHex,
  };
  const message = {
    token: permit.payment.payToken,
    serviceProvider: permit.fee.feeTo,
    user: permit.buyer,
    receiver: permit.payment.payTo,
    value: permit.payment.payAmount,
    maxFee: permit.fee.feeAmount,
    deadline: String(permit.meta.validBefore),
    version: 1,
    nonce: Number.parseInt(permit.meta.nonce, 10),
  };
  return { domain, message };
}

function base58ToEvmHex(address: string): string {
  if (address.startsWith('0x')) return address.toLowerCase();
  const tronHex = TronWeb.address.toHex(address) as string;
  return ('0x' + tronHex.replace(/^41/, '')).toLowerCase();
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

void TronClientSigner;
void X402Client;

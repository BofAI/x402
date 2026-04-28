/**
 * `x402-tools server` — start a temporary x402 payment server.
 *
 * Endpoints:
 *   GET  /health                  — `{ ok: true }`
 *   GET  /.well-known/x402        — advertised payment terms
 *   GET | POST /pay               — protected; issues 402 then settles on retry
 *
 * Settlement paths:
 *   - TRON `exact_gasfree`      — in-process GasFree submit + waitForSuccess
 *   - any other (TRON / EVM)    — facilitator HTTP /verify + /settle
 *
 * --daemon spawns a detached child and exits the parent with the PID printed.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { spawn } from 'node:child_process';
import {
  GasFreeAPIClient,
  encodePaymentPayload,
  decodePaymentPayload,
  getChainId,
  getGasFreeControllerAddress,
  isTronNetwork,
  type PaymentPayload,
  type PaymentPermit,
  type PaymentRequirements,
  type PaymentRequired,
  type SettleResponse,
} from '@bankofai/x402';
import { TronWeb } from 'tronweb';
import { runCommand, type OutputMode } from '../output.js';
import { getFacilitatorBaseUrl, getSettlementFacilitatorBaseUrl } from '../facilitator.js';
import { FacilitatorHttpClient } from '../facilitatorClient.js';
import { X402CliError } from '../error.js';
import { resolveToken, parseAmountFlags, newPaymentId, type ResolvedToken } from '../amount.js';
import { isKnownScheme, pickScheme } from '../schemes.js';

const PAYMENT_REQUIRED_HEADER = 'PAYMENT-REQUIRED';
const PAYMENT_SIGNATURE_HEADER = 'PAYMENT-SIGNATURE';
const PAYMENT_RESPONSE_HEADER = 'PAYMENT-RESPONSE';
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

export interface ServerOpts {
  payTo: string;
  decimal?: string;
  rawAmount?: string;
  network: string;
  token?: string;
  scheme?: string;
  asset?: string;
  decimals?: number;
  host?: string;
  port?: number;
  resourceUrl?: string;
  /** D1 selector — accepted but currently unused on the server side. */
  wallet?: 'agent-wallet' | 'env';
  daemon?: boolean;
  output: OutputMode;
}

export async function cmdServer(opts: ServerOpts): Promise<number> {
  return runCommand({ command: 'server' }, opts.output, async () => {
    if (!opts.payTo || !opts.payTo.trim()) {
      throw new X402CliError('INVALID_INPUT', `--pay-to <address> is required.`);
    }
    if (!opts.network) {
      throw new X402CliError('INVALID_INPUT', `--network <id> is required.`);
    }

    const tokenSymbol = opts.token ?? 'USDT';
    const token = resolveToken({
      network: opts.network,
      symbol: tokenSymbol,
      asset: opts.asset,
      decimals: opts.decimals,
    });
    const amount = parseAmountFlags(token.decimals, {
      decimal: opts.decimal,
      rawAmount: opts.rawAmount,
    });

    const scheme =
      opts.scheme ?? pickScheme(opts.network, token.symbol) ?? 'exact_permit';
    if (!isKnownScheme(scheme)) {
      throw new X402CliError('UNSUPPORTED_SCHEME', `Unknown scheme '${scheme}'.`);
    }

    const host = opts.host ?? '127.0.0.1';
    const port = opts.port ?? 4020;
    const payUrl = `http://${host}:${port}/pay`;
    const resourceUrl = opts.resourceUrl?.trim() || payUrl;

    if (opts.daemon) {
      return spawnDaemon({
        payUrl,
        resourceUrl,
        argv: process.argv.slice(2).filter((a) => a !== '--daemon'),
      });
    }

    const challenges = new Map<string, IssuedChallenge>();
    const ctx: Ctx = {
      network: opts.network,
      scheme,
      token,
      amount,
      payTo: opts.payTo.trim(),
      resourceUrl,
      challenges,
      gasFreeClient: isTronNetwork(opts.network)
        ? new GasFreeAPIClient(getFacilitatorBaseUrl(opts.network))
        : null,
      facilitator: new FacilitatorHttpClient(getSettlementFacilitatorBaseUrl(opts.network)),
    };

    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host || `${host}:${port}`}`);
      try {
        if (req.method === 'GET' && url.pathname === '/health') {
          return sendJson(res, 200, { ok: true });
        }
        if (req.method === 'GET' && url.pathname === '/.well-known/x402') {
          return sendJson(res, 200, {
            network: ctx.network,
            scheme: ctx.scheme,
            token: ctx.token.symbol,
            asset: ctx.token.address,
            decimal: amount.decimal,
            raw_amount: amount.raw,
            pay_to: ctx.payTo,
            pay_url: payUrl,
            resource_url: resourceUrl,
          });
        }
        if ((req.method === 'GET' || req.method === 'POST') && url.pathname === '/pay') {
          await handlePay(req, res, ctx);
          return;
        }
        sendJson(res, 404, { error: 'not found' });
      } catch (err) {
        process.stderr.write(`[x402-tools server] handler error: ${(err as Error).message}\n`);
        sendJson(res, 500, { error: (err as Error).message });
      }
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => resolve());
    });

    const cleanup = setInterval(() => {
      const now = Date.now();
      for (const [id, ch] of challenges) {
        if (ch.expiresAt < now) challenges.delete(id);
      }
    }, 60_000);

    process.stdout.write(
      `x402-tools server listening\n` +
        `  pay_url:      ${payUrl}\n` +
        `  resource_url: ${resourceUrl}\n` +
        `  network:      ${ctx.network}\n` +
        `  scheme:       ${ctx.scheme}\n` +
        `  token:        ${ctx.token.symbol}\n` +
        `  decimal:      ${amount.decimal}\n` +
        `  raw_amount:   ${amount.raw}\n` +
        `  pay_to:       ${ctx.payTo}\n`,
    );

    await new Promise<void>((resolve) => {
      const shutdown = () => {
        process.stderr.write('[x402-tools server] shutting down\n');
        clearInterval(cleanup);
        server.close(() => resolve());
      };
      process.once('SIGINT', shutdown);
      process.once('SIGTERM', shutdown);
    });

    return {
      pid: null,
      pay_url: payUrl,
      resource_url: resourceUrl,
      network: ctx.network,
      scheme: ctx.scheme,
      token: ctx.token.symbol,
      decimal: amount.decimal,
      raw_amount: amount.raw,
      pay_to: ctx.payTo,
    };
  });
}

interface IssuedChallenge {
  paymentId: string;
  requirements: PaymentRequirements;
  expiresAt: number;
}

interface Ctx {
  network: string;
  scheme: string;
  token: ResolvedToken;
  amount: ReturnType<typeof parseAmountFlags>;
  payTo: string;
  resourceUrl: string;
  challenges: Map<string, IssuedChallenge>;
  gasFreeClient: GasFreeAPIClient | null;
  facilitator: FacilitatorHttpClient;
}

async function handlePay(req: IncomingMessage, res: ServerResponse, ctx: Ctx): Promise<void> {
  const sigHeader = req.headers[PAYMENT_SIGNATURE_HEADER.toLowerCase()];
  const sigValue = Array.isArray(sigHeader) ? sigHeader[0] : sigHeader;

  if (!sigValue) {
    const requirements: PaymentRequirements = {
      scheme: ctx.scheme,
      network: ctx.network,
      amount: ctx.amount.raw,
      asset: ctx.token.address,
      payTo: ctx.payTo,
      maxTimeoutSeconds: 180,
      extra: { name: ctx.token.name, version: ctx.token.version },
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
      resource: { url: ctx.resourceUrl },
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

  let settle: SettleResponse;
  try {
    if (ctx.scheme === 'exact_gasfree') {
      settle = await settleGasFree(ctx, payload);
    } else {
      settle = await ctx.facilitator.settle(payload, issued.requirements);
    }
  } catch (err) {
    return sendJson(res, 500, { error: `settle failed: ${(err as Error).message}` });
  }

  if (!settle.success) {
    return sendJson(res, 500, {
      error: `settle reported failure: ${settle.errorReason || 'unknown'}`,
    });
  }

  ctx.challenges.delete(issuedId);
  res.statusCode = 200;
  res.setHeader(PAYMENT_RESPONSE_HEADER, encodePaymentPayload(settle));
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ ok: true, paymentId: issuedId, transaction: settle.transaction }));
}

async function settleGasFree(ctx: Ctx, payload: PaymentPayload): Promise<SettleResponse> {
  const permit = payload.payload.paymentPermit as PaymentPermit | undefined;
  const signature = payload.payload.signature;
  if (!permit || !signature || !ctx.gasFreeClient) {
    return {
      success: false,
      transaction: undefined,
      network: ctx.network,
      errorReason: 'missing_payload_data',
    };
  }
  const { domain, message } = buildGasFreeSubmitBody(ctx.network, permit);
  const traceId = await ctx.gasFreeClient.submit(domain, message, signature);
  const result = await ctx.gasFreeClient.waitForSuccess(traceId);
  if (!result.txnHash) {
    return {
      success: false,
      network: ctx.network,
      errorReason: `gasfree returned ${result.state} but txnHash empty`,
    };
  }
  return { success: true, transaction: result.txnHash, network: ctx.network };
}

function buildGasFreeSubmitBody(network: string, permit: PaymentPermit) {
  const chainId = getChainId(network);
  const controllerHex = base58ToEvmHex(getGasFreeControllerAddress(network));
  return {
    domain: {
      name: 'GasFreeController',
      version: 'V1.0.0',
      chainId,
      verifyingContract: controllerHex,
    },
    message: {
      token: permit.payment.payToken,
      serviceProvider: permit.fee.feeTo,
      user: permit.buyer,
      receiver: permit.payment.payTo,
      value: permit.payment.payAmount,
      maxFee: permit.fee.feeAmount,
      deadline: String(permit.meta.validBefore),
      version: 1,
      nonce: Number.parseInt(permit.meta.nonce, 10),
    },
  };
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

function spawnDaemon(args: { payUrl: string; resourceUrl: string; argv: string[] }) {
  const child = spawn(process.execPath, [process.argv[1] ?? '', ...args.argv], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  process.stdout.write(
    `x402-tools server started\n` +
      `  pid:          ${child.pid}\n` +
      `  pay_url:      ${args.payUrl}\n` +
      `  resource_url: ${args.resourceUrl}\n`,
  );
  return {
    pid: child.pid ?? null,
    pay_url: args.payUrl,
    resource_url: args.resourceUrl,
  };
}

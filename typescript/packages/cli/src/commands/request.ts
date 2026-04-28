/**
 * `x402 request` — generate an offline transfer request.
 *
 * This command never signs, never reads a wallet, and never talks to the
 * facilitator. It only normalizes token/amount/profile inputs into either a
 * shareable `x402://transfer?...` URI or a JSON object that another CLI/Agent
 * can feed into `x402 transfer` later. QR rendering is deliberately post-MVP.
 */

import { runCommand, type OutputMode } from '../output.js';
import { loadConfig, getProfile, applyEnvOverrides, defaultConfig } from '../config.js';
import { resolveToken, parseHumanAmount, formatSmallestUnit } from '../amount.js';
import { X402CliError, isCliError } from '../error.js';

export interface RequestOpts {
  to: string;
  amount: string;
  token?: string;
  asset?: string;
  decimals?: number;
  network?: string;
  scheme?: string;
  profile?: string;
  memo?: string;
  expiresIn?: number;
  format?: 'uri' | 'json' | string;
  output: OutputMode;
}

export async function cmdRequest(opts: RequestOpts): Promise<number> {
  return runCommand({ command: 'request' }, opts.output, async () => {
    if (!opts.to || !opts.to.trim()) {
      throw new X402CliError('INVALID_INPUT', `--to <address> is required.`);
    }
    if (!opts.amount || !opts.amount.trim()) {
      throw new X402CliError('INVALID_AMOUNT', `--amount is required.`);
    }

    const cfg = await loadConfig().catch((err: unknown) => {
      if (isCliError(err) && err.code === 'CONFIG_NOT_FOUND') {
        return defaultConfig();
      }
      throw err;
    });
    const { name: profileName, profile } = getProfile(cfg, opts.profile);
    const effective = applyEnvOverrides(profile);
    const network = opts.network || effective.network;
    const scheme = opts.scheme || effective.scheme || 'exact_gasfree';
    const tokenSymbol = opts.token || effective.token;
    const token = resolveToken({
      network,
      symbol: tokenSymbol,
      asset: opts.asset,
      decimals: opts.decimals,
    });
    const amountSmallest = parseHumanAmount(opts.amount, token.decimals);
    const expiresAt =
      typeof opts.expiresIn === 'number' && Number.isFinite(opts.expiresIn) && opts.expiresIn > 0
        ? Math.floor(Date.now() / 1000) + Math.trunc(opts.expiresIn)
        : undefined;

    const request = {
      type: 'x402-transfer-request',
      profile: profileName,
      network,
      scheme,
      token: token.symbol,
      asset: token.address,
      amount: amountSmallest.toString(),
      amountDisplay: `${formatSmallestUnit(amountSmallest, token.decimals)} ${token.symbol}`,
      to: opts.to.trim(),
      ...(opts.memo ? { memo: opts.memo } : {}),
      ...(expiresAt ? { expiresAt } : {}),
    };
    const uri = buildTransferUri(request);
    const format = opts.format || 'uri';

    if (format === 'uri') {
      return { uri, request };
    }
    if (format === 'json') {
      return request;
    }
    throw new X402CliError(
      'INVALID_INPUT',
      `Unsupported request format '${format}'. Use 'uri' or 'json'.`,
    );
  });
}

type RequestShape = {
  type: string;
  profile: string;
  network: string;
  scheme: string;
  token: string;
  asset: string;
  amount: string;
  amountDisplay: string;
  to: string;
  memo?: string;
  expiresAt?: number;
};

function buildTransferUri(req: RequestShape): string {
  const params = new URLSearchParams();
  params.set('network', req.network);
  params.set('scheme', req.scheme);
  params.set('token', req.token);
  params.set('asset', req.asset);
  params.set('amount', req.amount);
  params.set('to', req.to);
  if (req.memo) params.set('memo', req.memo);
  if (req.expiresAt) params.set('expiresAt', String(req.expiresAt));
  return `x402://transfer?${params.toString()}`;
}

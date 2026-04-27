/**
 * On-chain (live) balance queries.
 *
 * The GasFree API surfaces `assets[].balance`, but as observed during
 * 2026-04-27 e2e (see docs/solutions.md #11), that field can lag by minutes
 * and cannot be trusted for any decision the user is about to act on.
 *
 * This module bypasses both the API and TronWeb's abi-encoder by talking
 * directly to the Tron full-node `/wallet/triggerconstantcontract` endpoint
 * with a hand-built calldata. Read-only; never builds nor signs a tx.
 */

import { TronWeb } from 'tronweb';
import { getTronRpcUrl, isTronNetwork } from '@bankofai/x402';
import { X402CliError } from './error.js';

const BALANCE_OF_SELECTOR = 'balanceOf(address)';

interface TriggerConstantResponse {
  result?: { result?: boolean; message?: string };
  constant_result?: string[];
}

/**
 * Live TRC-20 balance for `holder` on `network`. Returns a BigInt in the
 * smallest unit. Throws X402CliError on RPC errors so callers can surface
 * a clean envelope.
 */
export async function getTrc20Balance(opts: {
  network: string;
  token: string; // Base58 or 0x hex
  holder: string; // Base58 or 0x hex
}): Promise<bigint> {
  if (!isTronNetwork(opts.network)) {
    throw new X402CliError(
      'UNSUPPORTED_NETWORK',
      `On-chain TRC-20 lookup is TRON-only; got ${opts.network}.`,
    );
  }
  const rpc = getTronRpcUrl(opts.network);
  if (!rpc) {
    throw new X402CliError(
      'UNSUPPORTED_NETWORK',
      `No TRON RPC configured for ${opts.network}.`,
    );
  }

  // 41-prefixed 21-byte hex form for the JSON-RPC body.
  const tokenHex41 = TronWeb.address.toHex(ensureBase58(opts.token));
  const holderHex41 = TronWeb.address.toHex(ensureBase58(opts.holder));
  // For the calldata parameter, encode the 20-byte EVM-style address into
  // a 32-byte ABI word (left-padded with zeros).
  const param = holderHex41.replace(/^41/, '').toLowerCase().padStart(64, '0');

  const url = rpc.replace(/\/$/, '') + '/wallet/triggerconstantcontract';
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const apiKey = process.env.TRON_GRID_API_KEY;
  if (apiKey) headers['TRON-PRO-API-KEY'] = apiKey;

  let res: TriggerConstantResponse;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        owner_address: holderHex41,
        contract_address: tokenHex41,
        function_selector: BALANCE_OF_SELECTOR,
        parameter: param,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 240)}`);
    }
    res = (await response.json()) as TriggerConstantResponse;
  } catch (err) {
    throw new X402CliError(
      'IO_ERROR',
      `On-chain balanceOf RPC failed: ${(err as Error).message}`,
    );
  }
  if (res.result && res.result.result === false) {
    throw new X402CliError(
      'IO_ERROR',
      `balanceOf reverted: ${decodeMessage(res.result.message) || 'unknown'}`,
    );
  }
  const raw = res.constant_result?.[0];
  if (!raw) return 0n;
  return BigInt('0x' + raw);
}

function ensureBase58(addr: string): string {
  if (!addr.startsWith('0x')) return addr;
  return TronWeb.address.fromHex('41' + addr.slice(2).toLowerCase()) as string;
}

function decodeMessage(hex?: string): string | null {
  if (!hex) return null;
  try {
    return Buffer.from(hex, 'hex').toString('utf8');
  } catch {
    return null;
  }
}

/**
 * `x402 balance` — read-only balance inspection.
 *
 * Default mode: query the GasFree API for the wallet's account info, surfacing
 * main address, derived gasFreeAddress, USDT balance, fees, and activation
 * state. Honors solutions.md #3: the balance call uses the wallet's main
 * address and reads the gasFreeAddress that the API returns; no recursive
 * follow-up query (solutions.md #9).
 *
 * Future flags (post-MVP):
 *   --token <symbol>    filter to a specific TRC-20 by symbol
 *   --no-gasfree        also report main-wallet on-chain TRC-20 balance
 *
 * For now the response includes every asset the GasFree API returns for the
 * account, masking the address fields by default (--verbose to disable).
 */

import { runCommand, type OutputMode, maskAddress } from '../output.js';
import { loadConfig, getProfile, applyEnvOverrides } from '../config.js';
import { getFacilitatorBaseUrl } from '../facilitator.js';
import { deriveWalletInfo } from '../wallet.js';
import { X402CliError } from '../error.js';
import { GasFreeAPIClient, isTronNetwork } from '@bankofai/x402';

export async function cmdBalance(opts: {
  profile?: string;
  network?: string;
  token?: string;
  gasfree?: boolean;
  verbose?: boolean;
  output: OutputMode;
}): Promise<number> {
  return runCommand({ command: 'balance' }, opts.output, async () => {
    const cfg = await loadConfig();
    const { profile } = getProfile(cfg, opts.profile);
    const effective = applyEnvOverrides(profile);
    const network = opts.network || effective.network;

    if (!isTronNetwork(network)) {
      throw new X402CliError(
        'UNSUPPORTED_NETWORK',
        `'balance --gasfree' is currently only supported for TRON networks; got ${network}.`,
        'EVM balance support is post-MVP.',
      );
    }

    // Default in MVP: --gasfree implied. Allow --no-gasfree once we have the
    // alternative path; until then the flag is a no-op alias.
    void opts.gasfree;

    const wallet = deriveWalletInfo(profile.wallet.network);
    const facilitatorUrl = getFacilitatorBaseUrl(network);
    const client = new GasFreeAPIClient(facilitatorUrl);
    let info;
    try {
      info = await client.getAddressInfo(wallet.address);
    } catch (err) {
      throw new X402CliError(
        'FACILITATOR_UNAVAILABLE',
        `Failed to query GasFree API at ${facilitatorUrl}: ${(err as Error).message}`,
      );
    }

    const display = (s: string) => (opts.verbose ? s : maskAddress(s));

    // The GasFree address returned here is the canonical one for this wallet —
    // never recursively re-query it (solutions.md #9).
    const assets = info.assets
      .filter((asset) => !opts.token || asset.tokenSymbol === opts.token)
      .map((asset) => ({
        symbol: asset.tokenSymbol,
        address: display(asset.tokenAddress),
        decimals: asset.decimal,
        balance: asset.balance ?? '0',
        balanceDisplay: formatSmallestUnit(asset.balance ?? '0', asset.decimal),
        transferFee: formatSmallestUnit(asset.transferFee, asset.decimal),
        activateFee: formatSmallestUnit(asset.activateFee, asset.decimal),
        frozen: asset.frozen,
      }));

    return {
      network,
      wallet: display(wallet.address),
      gasFreeAddress: display(info.gasFreeAddress),
      active: info.active,
      allowSubmit: info.allowSubmit,
      nonce: info.nonce,
      assets,
    };
  });
}

function formatSmallestUnit(amount: string | number, decimals: number): string {
  const raw = typeof amount === 'number' ? BigInt(Math.trunc(amount)) : BigInt(amount || '0');
  if (decimals <= 0) return raw.toString();
  const negative = raw < 0n;
  const abs = negative ? -raw : raw;
  const divisor = 10n ** BigInt(decimals);
  const whole = abs / divisor;
  const frac = abs % divisor;
  const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '');
  const display = fracStr.length > 0 ? `${whole}.${fracStr}` : whole.toString();
  return negative ? `-${display}` : display;
}

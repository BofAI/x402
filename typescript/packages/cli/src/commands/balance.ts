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
import { getTrc20Balance } from '../onchain.js';
import { formatSmallestUnit } from '../amount.js';

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
    // never recursively re-query it (solutions.md #9). For each asset we query
    // the chain directly for the authoritative balance (solutions.md #11) and
    // surface both the chain figure and the API figure so callers can detect
    // GasFree API caching lag.
    const candidates = info.assets.filter(
      (asset) => !opts.token || asset.tokenSymbol === opts.token,
    );
    const assets = await Promise.all(
      candidates.map(async (asset) => {
        let chainBalance: bigint | null = null;
        let chainBalanceError: string | null = null;
        try {
          chainBalance = await getTrc20Balance({
            network,
            token: asset.tokenAddress,
            holder: info.gasFreeAddress,
          });
        } catch (err) {
          chainBalanceError = (err as Error).message;
        }
        const apiBalanceRaw = String(asset.balance ?? '0');
        const stale =
          chainBalance !== null && chainBalance !== BigInt(apiBalanceRaw || '0');
        return {
          symbol: asset.tokenSymbol,
          address: display(asset.tokenAddress),
          decimals: asset.decimal,
          chainBalance: chainBalance !== null ? chainBalance.toString() : null,
          chainBalanceDisplay:
            chainBalance !== null
              ? formatSmallestUnit(chainBalance, asset.decimal)
              : null,
          chainBalanceError,
          apiBalance: apiBalanceRaw,
          apiBalanceDisplay: formatSmallestUnit(apiBalanceRaw, asset.decimal),
          apiBalanceStale: stale,
          transferFee: formatSmallestUnit(asset.transferFee, asset.decimal),
          activateFee: formatSmallestUnit(asset.activateFee, asset.decimal),
          frozen: asset.frozen,
        };
      }),
    );

    const stalewarn = assets.find((a) => a.apiBalanceStale);
    if (stalewarn) {
      process.stderr.write(
        `[x402] GasFree API balance is stale for ${stalewarn.symbol}: ` +
          `chain=${stalewarn.chainBalanceDisplay} api=${stalewarn.apiBalanceDisplay}. ` +
          `Trust the chain figure.\n`,
      );
    }

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


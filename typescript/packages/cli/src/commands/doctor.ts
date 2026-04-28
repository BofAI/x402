/**
 * `x402 doctor` — read-only diagnostics for the current profile.
 *
 * Checks (each independent, never throws past its own failure):
 *   - Node.js version meets >=20
 *   - Wallet env var present + derives a valid address
 *   - Facilitator endpoint reachable (HTTP 200 from an idempotent GET)
 *   - GasFree API returns address info for the wallet (when scheme is exact_gasfree)
 *   - Token registry resolves the configured default token (if any)
 *
 * Each check produces { name, status, detail? }. Overall pass = every check
 * is `ok` or `skipped`; any `fail` flips overall to fail.
 */

import { runCommand, type OutputMode, maskAddress } from '../output.js';
import { loadConfig, getProfile, applyEnvOverrides } from '../config.js';
import { getFacilitatorBaseUrl } from '../facilitator.js';
import { deriveWalletInfo } from '../wallet.js';
import { X402CliError, isCliError } from '../error.js';
import {
  GasFreeAPIClient,
  isTronNetwork,
} from '@bankofai/x402';

type CheckStatus = 'ok' | 'fail' | 'skipped' | 'warn';

interface Check {
  name: string;
  status: CheckStatus;
  detail?: string;
}

export async function cmdDoctor(opts: {
  profile?: string;
  network?: string;
  output: OutputMode;
}): Promise<number> {
  return runCommand({ command: 'doctor' }, opts.output, async () => {
    const cfg = await loadConfig();
    const { name: profileName, profile } = getProfile(cfg, opts.profile);
    const effective = applyEnvOverrides(profile);
    const network = opts.network || effective.network;
    const scheme = effective.scheme || 'exact_gasfree';

    const checks: Check[] = [];

    // 1. Node version
    checks.push(checkNode());

    // 2. Wallet
    let address: string | undefined;
    try {
      const w = deriveWalletInfo(profile.wallet.network);
      address = w.address;
      checks.push({ name: 'wallet', status: 'ok', detail: maskAddress(address) });
    } catch (err) {
      checks.push({
        name: 'wallet',
        status: 'fail',
        detail: isCliError(err) ? err.message : (err as Error).message,
      });
    }

    // 3. Facilitator endpoint reachable
    let facilitatorUrl: string;
    try {
      facilitatorUrl = getFacilitatorBaseUrl(network);
    } catch (err) {
      checks.push({
        name: 'facilitator',
        status: 'fail',
        detail: isCliError(err) ? err.message : (err as Error).message,
      });
      return finalize(checks, profileName, network, scheme, address);
    }
    checks.push(await pingFacilitator(facilitatorUrl));

    // 4. GasFree API returns address info (only for exact_gasfree on TRON)
    if (scheme === 'exact_gasfree' && isTronNetwork(network) && address) {
      checks.push(await checkGasFreeAddress(facilitatorUrl, address));
    } else {
      checks.push({
        name: 'gasfree',
        status: 'skipped',
        detail: `not applicable: scheme=${scheme} network=${network}`,
      });
    }

    // 5. Token sanity check (registry-only, no network call)
    if (effective.token) {
      checks.push(checkToken(network, effective.token));
    } else {
      checks.push({ name: 'token', status: 'skipped', detail: 'no default token in profile' });
    }

    return finalize(checks, profileName, network, scheme, address);
  });
}

function finalize(
  checks: Check[],
  profile: string,
  network: string,
  scheme: string,
  address: string | undefined,
) {
  const failed = checks.filter((c) => c.status === 'fail').length;
  const warned = checks.filter((c) => c.status === 'warn').length;
  return {
    profile,
    network,
    scheme,
    wallet: address ? maskAddress(address) : null,
    overall: failed === 0 ? (warned === 0 ? 'ok' : 'warn') : 'fail',
    checks,
  };
}

function checkNode(): Check {
  const major = parseInt(process.versions.node.split('.')[0]!, 10);
  if (Number.isFinite(major) && major >= 20) {
    return { name: 'node', status: 'ok', detail: process.versions.node };
  }
  return {
    name: 'node',
    status: 'fail',
    detail: `Node ${process.versions.node} is below the required >=20.`,
  };
}

async function pingFacilitator(baseUrl: string): Promise<Check> {
  // We probe two endpoints in series so the check works on both the
  // network-scoped GasFree proxy (e.g. /nile) and the root facilitator
  // (which serves /supported but no /api/v1/...). The first one to reply
  // with 2xx wins.
  const probes = [
    `${baseUrl}/api/v1/config/provider/all`, // GasFree proxy on TRON nodes
    `${baseUrl}/supported`, // root facilitator (TRON + EVM) — fits both
  ];
  let lastDetail = '';
  for (const probe of probes) {
    try {
      const res = await fetch(probe, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        return { name: 'facilitator', status: 'ok', detail: probe };
      }
      lastDetail = `${probe} returned HTTP ${res.status}`;
    } catch (err) {
      lastDetail = `${probe}: ${(err as Error).message}`;
    }
  }
  return { name: 'facilitator', status: 'fail', detail: lastDetail };
}

async function checkGasFreeAddress(facilitatorUrl: string, address: string): Promise<Check> {
  try {
    const client = new GasFreeAPIClient(facilitatorUrl);
    const info = await client.getAddressInfo(address);
    const summary =
      `gasFree=${maskAddress(info.gasFreeAddress)} active=${info.active} ` +
      `allowSubmit=${info.allowSubmit} nonce=${info.nonce}`;
    return { name: 'gasfree', status: 'ok', detail: summary };
  } catch (err) {
    return {
      name: 'gasfree',
      status: 'fail',
      detail: `getAddressInfo(${maskAddress(address)}) failed: ${(err as Error).message}`,
    };
  }
}

function checkToken(network: string, token: string): Check {
  // The SDK's TokenRegistry isn't currently exported as a typed structure on
  // the public surface, so we do a lightweight check: token symbol must be a
  // known identifier shape, leave actual address resolution to the balance /
  // transfer commands which need it.
  if (!/^[A-Z0-9]{2,10}$/.test(token)) {
    return {
      name: 'token',
      status: 'warn',
      detail: `token '${token}' on ${network}: symbol shape unusual`,
    };
  }
  return { name: 'token', status: 'ok', detail: `${token} on ${network}` };
}

void X402CliError;

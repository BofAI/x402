/**
 * Facilitator endpoint resolution.
 *
 * Per D4 (specs/002-bankofai-cli/notes/decisions.md): the CLI talks to
 * BankofAI's hosted facilitator only. URLs are derived from `network`,
 * not configured per-profile and not exposed as a CLI flag.
 *
 * Single internal escape hatch: X402_FACILITATOR_URL_OVERRIDE for the e2e
 * harness. When set, every command emits a stderr warning so it's never
 * silent.
 */

import { isTronNetwork, isEvmNetwork, getGasFreeApiBaseUrl } from '@bankofai/x402';
import { X402CliError } from './error.js';

const OVERRIDE_ENV = 'X402_FACILITATOR_URL_OVERRIDE';

const BSC_FACILITATOR_URLS: Record<string, string> = {
  // EVM networks use the same host pattern; slugs are TBD by the BankofAI
  // operations team. For now the only EVM endpoint we serve is BSC testnet.
  'eip155:97': 'https://facilitator.bankofai.io/bsc-testnet',
  'eip155:56': 'https://facilitator.bankofai.io/bsc',
};

let _overrideWarned = false;

/**
 * Resolve the facilitator base URL for a network.
 *
 * @throws X402CliError UNSUPPORTED_NETWORK when no hosted endpoint is registered
 */
export function getFacilitatorBaseUrl(network: string): string {
  const override = process.env[OVERRIDE_ENV];
  if (override && override.trim()) {
    if (!_overrideWarned) {
      _overrideWarned = true;
      process.stderr.write(
        `[x402] CLI facilitator override active: ${override.trim()} (via ${OVERRIDE_ENV}). ` +
          `This is intended for e2e testing only.\n`,
      );
    }
    return override.trim().replace(/\/$/, '');
  }

  if (isTronNetwork(network)) {
    // For TRON the GasFree API URL and the facilitator URL are the same host.
    return getGasFreeApiBaseUrl(network).replace(/\/$/, '');
  }

  if (isEvmNetwork(network)) {
    const url = BSC_FACILITATOR_URLS[network];
    if (url) return url.replace(/\/$/, '');
    throw new X402CliError(
      'UNSUPPORTED_NETWORK',
      `No BankofAI facilitator endpoint configured for ${network}.`,
      `Use a TRON network (tron:nile / tron:mainnet) or set ${OVERRIDE_ENV} to point at a local facilitator.`,
    );
  }

  throw new X402CliError(
    'UNSUPPORTED_NETWORK',
    `Unrecognized network identifier: ${network}.`,
    'Network must start with "tron:" or "eip155:".',
  );
}

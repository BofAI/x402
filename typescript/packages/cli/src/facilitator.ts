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

const ROOT_FACILITATOR = 'https://facilitator.bankofai.io';

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
    // For TRON the GasFree API URL and the facilitator URL are the same host
    // (network-scoped proxy at /nile, /mainnet, /shasta).
    return getGasFreeApiBaseUrl(network).replace(/\/$/, '');
  }

  if (isEvmNetwork(network)) {
    // EVM has no GasFree proxy; commands that probe a "GasFree-shaped"
    // endpoint should use the root facilitator instead. Settlement
    // (/fee/quote /verify /settle) likewise lives at root for EVM.
    return ROOT_FACILITATOR;
  }

  throw new X402CliError(
    'UNSUPPORTED_NETWORK',
    `Unrecognized network identifier: ${network}.`,
    'Network must start with "tron:" or "eip155:".',
  );
}

/**
 * Resolve the generic facilitator settlement surface for non-GasFree schemes.
 * Both TRON and EVM `exact` / `exact_permit` settlement (`/fee/quote`,
 * `/verify`, `/settle`) lives at the root URL — only TRON GasFree balance
 * lookups go through the network-scoped proxy at `/nile`, `/mainnet`, etc.
 */
export function getSettlementFacilitatorBaseUrl(network: string): string {
  const override = process.env[OVERRIDE_ENV];
  if (override && override.trim()) {
    return override.trim().replace(/\/$/, '');
  }
  if (isTronNetwork(network) || isEvmNetwork(network)) {
    return ROOT_FACILITATOR;
  }
  throw new X402CliError(
    'UNSUPPORTED_NETWORK',
    `Unrecognized network identifier: ${network}.`,
  );
}

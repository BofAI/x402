/**
 * Scheme auto-selection for x402 CLI.
 *
 * The protocol defines three settlement schemes; each token can support some
 * subset. This table is the authoritative per-token capability map:
 *
 *   exact         — ERC-3009 transferWithAuthorization. Single-sig settle,
 *                   no facilitator relayer fee. Facilitator pays chain gas.
 *   exact_permit  — PaymentPermit EIP/TIP-712 + transferFrom. Two-call
 *                   settle in one tx, facilitator pays chain gas.
 *   exact_gasfree — TRON GasFree relayer. Provider pays TRX, charges a flat
 *                   USDT fee (~0.1 USDT/tx). Fallback path when users prefer
 *                   no TRX approval setup over lower per-payment fees.
 *
 * Order in each array = recommended preference (cheapest user-cost first).
 */

export type Scheme = 'exact' | 'exact_permit' | 'exact_gasfree';

export const ALL_SCHEMES: Scheme[] = ['exact', 'exact_permit', 'exact_gasfree'];

const TOKEN_SCHEME_TABLE: Record<string, Record<string, Scheme[]>> = {
  // BSC Testnet
  'eip155:97': {
    DHLU: ['exact'], // ERC-3009 only
    USDT: ['exact_permit'], // EIP-2612 only (verified on-chain)
    USDC: ['exact_permit'],
  },
  // BSC Mainnet — assumed; verify before production use.
  'eip155:56': {
    USDT: ['exact_permit'],
    USDC: ['exact_permit'],
  },
  // TRON: default USDT to GasFree because hosted/self-hosted exact_permit
  // settlement can verify signatures but still fail during permitTransferFrom
  // broadcast. Users can still force `--scheme exact_permit` for diagnostics.
  'tron:mainnet': {
    USDT: ['exact_gasfree'],
    USDD: ['exact_gasfree'],
  },
  'tron:nile': {
    USDT: ['exact_gasfree'],
    USDD: ['exact_gasfree'],
  },
  'tron:shasta': {
    USDT: ['exact_gasfree'],
  },
};

/**
 * Recommended schemes for a (network, token-symbol) pair, in preference order.
 * Returns null when the token is unknown — the caller should fail with
 * TOKEN_NOT_FOUND or accept user-supplied --scheme as final.
 */
export function recommendedSchemes(
  network: string,
  tokenSymbol: string,
): Scheme[] | null {
  const networkTable = TOKEN_SCHEME_TABLE[network];
  if (!networkTable) return null;
  const list = networkTable[tokenSymbol.toUpperCase()];
  return list ? [...list] : null;
}

/**
 * Single recommended scheme — the first entry of `recommendedSchemes`.
 * Returns null when nothing is registered.
 */
export function pickScheme(network: string, tokenSymbol: string): Scheme | null {
  const list = recommendedSchemes(network, tokenSymbol);
  return list && list.length > 0 ? list[0]! : null;
}

/**
 * Whether `scheme` is a known x402 scheme identifier (regardless of token
 * support). Useful for validating user --scheme overrides.
 */
export function isKnownScheme(scheme: string): scheme is Scheme {
  return ALL_SCHEMES.includes(scheme as Scheme);
}

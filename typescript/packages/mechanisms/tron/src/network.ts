/** Canonical TRON Mainnet CAIP-2 identifier. */
export const TRON_MAINNET = "tron:728126428";

/** Canonical TRON Nile testnet CAIP-2 identifier. */
export const TRON_NILE = "tron:3448148188";

/** Canonical TRON Shasta testnet CAIP-2 identifier. */
export const TRON_SHASTA = "tron:2494104990";

/**
 * Deprecated hexadecimal CAIP-2 aliases emitted by earlier x402 releases.
 *
 * Accept these at protocol boundaries for backwards compatibility, but emit
 * the decimal identifiers above for new requirements and configuration.
 */
const LEGACY_TRON_NETWORK_ALIASES: Readonly<Record<string, string>> = {
  "tron:0x2b6653dc": TRON_MAINNET,
  "tron:0xcd8690dc": TRON_NILE,
  "tron:0x94a9059e": TRON_SHASTA,
};

/**
 * Convert a hexadecimal TRON CAIP-2 identifier to decimal form. Unknown
 * non-hexadecimal identifiers are returned unchanged so callers can produce
 * their existing domain-specific error messages.
 *
 * @param network - Candidate TRON CAIP-2 identifier.
 * @returns The canonical decimal identifier when the input is a known alias.
 */
export function normalizeTronNetwork(network: string): string {
  const legacyAlias = LEGACY_TRON_NETWORK_ALIASES[network.toLowerCase()];
  if (legacyAlias) {
    return legacyAlias;
  }

  const hexadecimalReference = /^tron:0x([0-9a-f]+)$/i.exec(network)?.[1];
  return hexadecimalReference
    ? `tron:${BigInt(`0x${hexadecimalReference}`).toString(10)}`
    : network;
}

/**
 * Compare two TRON network identifiers after normalizing legacy aliases.
 *
 * @param left - First network identifier.
 * @param right - Second network identifier.
 * @returns Whether both identifiers refer to the same TRON network.
 */
export function tronNetworksEqual(left: string, right: string): boolean {
  return normalizeTronNetwork(left) === normalizeTronNetwork(right);
}

/**
 * Lists canonical and deprecated representations that may identify the same
 * durable TRON record. Canonical decimal form is always first.
 *
 * @param network - Decimal identifier or deprecated hexadecimal alias.
 * @returns Representations to try when reading existing persisted state.
 */
export function getTronNetworkRepresentations(network: string): readonly string[] {
  const canonical = normalizeTronNetwork(network);
  const representations = new Set<string>([canonical]);
  const decimalReference = /^tron:(\d+)$/.exec(canonical)?.[1];
  if (decimalReference) {
    const hexadecimalReference = BigInt(decimalReference).toString(16);
    representations.add(`tron:0x${hexadecimalReference}`);
    representations.add(`tron:0x${hexadecimalReference.toUpperCase()}`);
  }
  representations.add(network);
  return [...representations];
}

/**
 * Resolve a value from a network-keyed record using decimal or legacy hex.
 * This also supports caller-owned records that still contain only hex keys.
 *
 * @param values - Values keyed by TRON CAIP-2 identifier.
 * @param network - Decimal identifier or deprecated hexadecimal alias.
 * @returns The configured value, if present.
 */
export function getTronNetworkValue<T>(
  values: Readonly<Record<string, T>>,
  network: string,
): T | undefined {
  const canonical = normalizeTronNetwork(network);
  if (Object.prototype.hasOwnProperty.call(values, canonical)) {
    return values[canonical];
  }
  if (Object.prototype.hasOwnProperty.call(values, network)) {
    return values[network];
  }
  for (const [alias, target] of Object.entries(LEGACY_TRON_NETWORK_ALIASES)) {
    if (target === canonical && Object.prototype.hasOwnProperty.call(values, alias)) {
      return values[alias];
    }
  }
  return undefined;
}

/**
 * Add deprecated hexadecimal lookup keys to a canonical network record.
 * Canonical decimal keys remain the source of truth and are emitted first.
 *
 * @param values - Values keyed by canonical decimal TRON identifiers.
 * @returns A record addressable by both decimal identifiers and hex aliases.
 */
export function withTronNetworkAliases<T>(values: Record<string, T>): Record<string, T> {
  const compatible = { ...values };
  for (const [alias, canonical] of Object.entries(LEGACY_TRON_NETWORK_ALIASES)) {
    const value = values[canonical];
    if (value !== undefined) {
      compatible[alias] = value;
    }
  }
  return compatible;
}

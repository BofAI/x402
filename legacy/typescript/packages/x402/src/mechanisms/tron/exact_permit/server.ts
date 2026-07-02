import { BaseExactPermitServerMechanism } from '../../_exact_permit_base/server.js';

/**
 * TRON server mechanism for the `exact_permit` scheme.
 *
 * Mirrors Python `mechanisms.tron.exact_permit.server.ExactPermitTronServerMechanism`.
 */
export class ExactPermitTronServerMechanism extends BaseExactPermitServerMechanism {
  protected getNetworkPrefix(): string {
    return 'tron:';
  }

  protected validateAddressFormat(address: string): boolean {
    if (typeof address !== 'string') return false;
    // Accept both Base58 (T...) and 0x-prefixed hex forms
    if (address.startsWith('T') && address.length === 34) return true;
    if (address.startsWith('0x') && address.length === 42) return true;
    return false;
  }
}

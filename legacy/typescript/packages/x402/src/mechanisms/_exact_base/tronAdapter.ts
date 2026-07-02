import { TronAddressConverter, toBase58 } from '../../address.js';
import type { ChainAdapter } from './adapter.js';

const TRON_CHAIN_IDS: Record<string, number> = {
  'tron:mainnet': 728126428,
  'tron:shasta': 2494104990,
  'tron:nile': 3448148188,
};

const TRON_CONVERTER = new TronAddressConverter();

/** TRON (`tron:<name>`) ChainAdapter. */
export class TronChainAdapter implements ChainAdapter {
  parseChainId(network: string): number {
    const id = TRON_CHAIN_IDS[network];
    if (id === undefined) {
      throw new Error(`Unknown TRON network: ${network}`);
    }
    return id;
  }

  validateNetwork(network: string): boolean {
    return network.startsWith('tron:');
  }

  validateAddress(address: string): boolean {
    if (typeof address !== 'string') return false;
    // Accept both Base58 (T...) and 0x-prefixed hex forms
    if (address.startsWith('T') && address.length === 34) return true;
    if (address.startsWith('0x') && address.length === 42) return true;
    return false;
  }

  normalizeAddress(address: string): string {
    if (!this.validateAddress(address)) return address;
    if (address.startsWith('0x')) {
      try {
        return toBase58(address);
      } catch {
        return address;
      }
    }
    return address;
  }

  /** TIP-712 requires 0x-prefixed EVM-hex form for every address field. */
  toSigningAddress(address: string): string {
    return TRON_CONVERTER.toEvmFormat(address);
  }
}

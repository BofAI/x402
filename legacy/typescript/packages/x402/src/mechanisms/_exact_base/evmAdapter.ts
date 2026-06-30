import { getAddress, isAddress } from 'viem';

import type { ChainAdapter } from './adapter.js';

/** EVM (`eip155:<chainId>`) ChainAdapter. */
export class EvmChainAdapter implements ChainAdapter {
  parseChainId(network: string): number {
    const parts = network.split(':');
    if (parts.length !== 2 || parts[0] !== 'eip155') {
      throw new Error(`Invalid EVM network identifier: ${network}`);
    }
    const id = parseInt(parts[1]!, 10);
    if (!Number.isFinite(id) || id <= 0) {
      throw new Error(`Invalid EVM chain id in ${network}`);
    }
    return id;
  }

  validateNetwork(network: string): boolean {
    return network.startsWith('eip155:');
  }

  validateAddress(address: string): boolean {
    return isAddress(address, { strict: false });
  }

  normalizeAddress(address: string): string {
    return this.validateAddress(address) ? address.toLowerCase() : address;
  }

  toSigningAddress(address: string): string {
    return this.validateAddress(address) ? getAddress(address) : address;
  }
}

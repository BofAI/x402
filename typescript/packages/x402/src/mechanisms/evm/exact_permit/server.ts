import { isAddress } from 'viem';

import { BaseExactPermitServerMechanism } from '../../_exact_permit_base/server.js';

/**
 * BSC / EVM server mechanism for the `exact_permit` scheme.
 *
 * Mirrors Python `mechanisms.evm.exact_permit.server.ExactPermitEvmServerMechanism`.
 */
export class ExactPermitEvmServerMechanism extends BaseExactPermitServerMechanism {
  protected getNetworkPrefix(): string {
    return 'eip155:';
  }

  protected validateAddressFormat(address: string): boolean {
    return isAddress(address, { strict: false });
  }
}

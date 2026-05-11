/**
 * Tests for transaction verification base + factory.
 */

import { afterEach, describe, expect, it } from 'vitest';

import type { PaymentPayload, PaymentRequirements } from '../types/index.js';
import {
  BaseTransactionVerifier,
  type TransactionInfo,
  type TransferEvent,
  getVerifierForNetwork,
  registerVerifierFactory,
} from './tx_verification.js';

const REQ: PaymentRequirements = {
  scheme: 'exact_permit',
  network: 'tron:nile',
  amount: '1000000',
  asset: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
  payTo: 'TJWdoJk8KyrfxZ2iDUqz7fwpXaMkNqPehx',
};
const PAYLOAD: PaymentPayload = {
  x402Version: 2,
  accepted: REQ,
  payload: { signature: '0x' + 'aa'.repeat(65) },
} as PaymentPayload;

/** Minimal verifier subclass driven by a canned `getTransactionInfo`. */
class StubVerifier extends BaseTransactionVerifier {
  constructor(private readonly info: TransactionInfo | (() => Promise<TransactionInfo>)) {
    super();
  }
  async getTransactionInfo() {
    return typeof this.info === 'function' ? this.info() : this.info;
  }
  async getTransactionTransfers(): Promise<TransferEvent[]> {
    return [];
  }
  normalizeAddress(addr: string): string {
    return addr;
  }
}

describe('BaseTransactionVerifier.verifyTransaction', () => {
  it('returns success when transaction status is "success"', async () => {
    const verifier = new StubVerifier({ status: 'success', blockNumber: '12345' });
    const result = await verifier.verifyTransaction('0xtx', PAYLOAD, REQ);
    expect(result.success).toBe(true);
    expect(result.statusVerified).toBe(true);
    expect(result.blockNumber).toBe('12345');
    expect(result.txHash).toBe('0xtx');
  });

  it('returns failure when status is "failed"', async () => {
    const verifier = new StubVerifier({ status: 'failed', blockNumber: '12345' });
    const result = await verifier.verifyTransaction('0xtx', PAYLOAD, REQ);
    expect(result.success).toBe(false);
    expect(result.errorReason).toBe('transaction_failed_on_chain');
    expect(result.statusVerified).toBe(false);
  });

  it('returns failure when status is "0" (numeric-as-string)', async () => {
    const verifier = new StubVerifier({ status: '0' });
    const result = await verifier.verifyTransaction('0xtx', PAYLOAD, REQ);
    expect(result.success).toBe(false);
  });

  it('returns failure when status is missing / empty', async () => {
    const verifier = new StubVerifier({ blockNumber: '1' });
    const result = await verifier.verifyTransaction('0xtx', PAYLOAD, REQ);
    expect(result.success).toBe(false);
  });

  it('catches getTransactionInfo errors into verification_error', async () => {
    const verifier = new StubVerifier(async () => {
      throw new Error('rpc down');
    });
    const result = await verifier.verifyTransaction('0xtx', PAYLOAD, REQ);
    expect(result.success).toBe(false);
    expect(result.errorReason).toMatch(/verification_error: rpc down/);
  });

  it('paymentVerified / feeVerified default false at base level', async () => {
    const verifier = new StubVerifier({ status: 'success' });
    const result = await verifier.verifyTransaction('0xtx', PAYLOAD, REQ);
    expect(result.paymentVerified).toBe(false);
    expect(result.feeVerified).toBe(false);
  });
});

describe('getVerifierForNetwork / registerVerifierFactory', () => {
  // Snapshot/restore is overkill — these tests use a unique prefix.
  const TEST_PREFIX = 'testnet:';
  afterEach(() => {
    // No public unregister; just leave the test factory in place — prefix is unique.
  });

  it('throws when no factory matches the network prefix', () => {
    expect(() => getVerifierForNetwork('unknown:42')).toThrow(
      /No transaction verifier registered/,
    );
  });

  it('returns a verifier from a registered factory', () => {
    const fakeVerifier = {
      verifyTransaction: async () => {
        throw new Error('not implemented');
      },
      getTransactionTransfers: async () => [],
    };
    registerVerifierFactory(TEST_PREFIX, () => fakeVerifier);
    const v = getVerifierForNetwork(`${TEST_PREFIX}foo`);
    expect(v).toBe(fakeVerifier);
  });

  it('forwards options to the factory', () => {
    let receivedOpts: { rpcUrl?: string } | undefined;
    registerVerifierFactory('opts-test:', (_network, opts) => {
      receivedOpts = opts;
      return {
        verifyTransaction: async () => ({} as never),
        getTransactionTransfers: async () => [],
      };
    });
    getVerifierForNetwork('opts-test:1', { rpcUrl: 'https://rpc.example' });
    expect(receivedOpts).toEqual({ rpcUrl: 'https://rpc.example' });
  });
});

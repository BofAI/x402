import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GasFreeAPIClient } from './gasfree.js';

describe('GasFreeAPIClient', () => {
  const baseUrl = 'https://api.example.com';
  let client: GasFreeAPIClient;

  beforeEach(() => {
    // Provide dummy keys to trigger HMAC logic in tests
    client = new GasFreeAPIClient(baseUrl, 'test-key', 'test-secret');
    vi.stubGlobal('fetch', vi.fn());
  });

  it('should get address info', async () => {
    const mockResponse = {
      code: 200,
      data: {
        accountAddress: '0x123',
        gasFreeAddress: '0x456',
        active: true,
        nonce: 5,
        assets: [],
      },
    };

    (fetch as any).mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify(mockResponse),
    });

    const info = await client.getAddressInfo('0x123');
    expect(info.gasFreeAddress).toBe('0x456');
    expect(info.nonce).toBe(5);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/address/0x123'),
      expect.objectContaining({
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
        })
      })
    );
  });

  it('should submit transaction', async () => {
    const mockResponse = {
      code: 200,
      data: { id: 'trace-123' },
    };

    (fetch as any).mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify(mockResponse),
    });

    const message = {
      token: '0xtoken',
      serviceProvider: '0xprovider',
      user: '0xuser',
      receiver: '0xreceiver',
      value: 100,
      maxFee: 10,
      deadline: 1000,
      version: 1,
      nonce: 1,
    };

    const traceId = await client.submit({}, message, '0xabc');
    expect(traceId).toBe('trace-123');
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/gasfree/submit'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
        }),
      })
    );
  });

  it('should get transaction status', async () => {
    const mockResponse = {
      code: 200,
      data: { id: 'trace-123', state: 'SUCCEED' },
    };

    (fetch as any).mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify(mockResponse),
    });

    const status = await client.getStatus('trace-123');
    expect(status.state).toBe('SUCCEED');
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/gasfree/trace-123'),
      expect.objectContaining({
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
        }),
      })
    );
  });

  it('should wait for success', async () => {
    const mockResponse = {
      code: 200,
      data: { id: 'trace-123', state: 'SUCCEED' },
    };

    (fetch as any).mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify(mockResponse),
    });

    const result = await client.waitForSuccess('trace-123', 1000, 100);
    expect(result.state).toBe('SUCCEED');
  });

  it('should get nonce', async () => {
    vi.spyOn(client, 'getAddressInfo').mockResolvedValue({
      nonce: 42,
    } as any);

    const nonce = await client.getNonce('0x123');
    expect(nonce).toBe(42);
  });
});

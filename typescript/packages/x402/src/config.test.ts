import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getTronRpcUrl, TRON_RPC_URLS, TRON_FALLBACK_RPC_URLS, resolveRpcUrl } from './config.js';

const FALLBACK_URL = TRON_FALLBACK_RPC_URLS['tron:mainnet'];

describe('getTronRpcUrl', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.TRON_GRID_API_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns fallback URL for mainnet when TRON_GRID_API_KEY is not set', () => {
    expect(getTronRpcUrl('tron:mainnet')).toBe(FALLBACK_URL);
  });

  it('returns default TronGrid URL for mainnet when TRON_GRID_API_KEY is set', () => {
    process.env.TRON_GRID_API_KEY = 'test-api-key';
    expect(getTronRpcUrl('tron:mainnet')).toBe('https://api.trongrid.io');
  });

  it('returns default URL for non-mainnet networks when TRON_GRID_API_KEY is not set', () => {
    expect(getTronRpcUrl('tron:nile')).toBe(TRON_RPC_URLS['tron:nile']);
    expect(getTronRpcUrl('tron:shasta')).toBe(TRON_RPC_URLS['tron:shasta']);
  });

  it('returns default URL for non-mainnet networks when TRON_GRID_API_KEY is set', () => {
    process.env.TRON_GRID_API_KEY = 'test-api-key';
    expect(getTronRpcUrl('tron:nile')).toBe(TRON_RPC_URLS['tron:nile']);
    expect(getTronRpcUrl('tron:shasta')).toBe(TRON_RPC_URLS['tron:shasta']);
  });

  it('returns undefined for unknown networks', () => {
    expect(getTronRpcUrl('tron:unknown')).toBeUndefined();
  });

  it('returns undefined for unknown networks when TRON_GRID_API_KEY is set', () => {
    process.env.TRON_GRID_API_KEY = 'test-api-key';
    expect(getTronRpcUrl('tron:unknown')).toBeUndefined();
  });
});

describe('resolveRpcUrl', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.TRON_GRID_API_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('delegates to getTronRpcUrl for TRON networks', () => {
    expect(resolveRpcUrl('tron:mainnet')).toBe(FALLBACK_URL);
  });

  it('returns TronGrid URL for TRON mainnet when API key is set', () => {
    process.env.TRON_GRID_API_KEY = 'test-api-key';
    expect(resolveRpcUrl('tron:mainnet')).toBe('https://api.trongrid.io');
  });
});

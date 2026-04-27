import { describe, it, expect } from 'vitest';
import { buildSuccess, buildFailure, maskAddress } from './output.js';
import { X402CliError } from './error.js';

describe('output envelope', () => {
  it('builds a success envelope with command + network + result', () => {
    const env = buildSuccess(
      { command: 'balance', network: 'tron:nile' },
      { wallet: 'TTX1...', balance: '0' },
    );
    expect(env).toEqual({
      ok: true,
      command: 'balance',
      network: 'tron:nile',
      result: { wallet: 'TTX1...', balance: '0' },
    });
  });

  it('omits network/scheme keys when not provided', () => {
    const env = buildSuccess({ command: 'config init' }, { path: '/tmp/x' });
    expect(env).not.toHaveProperty('network');
    expect(env).not.toHaveProperty('scheme');
  });

  it('builds a failure envelope from an X402CliError preserving code + hint', () => {
    const err = new X402CliError('PROFILE_NOT_FOUND', "Profile 'bogus' is not defined.", 'try list');
    const env = buildFailure({ command: 'config use' }, err);
    expect(env).toEqual({
      ok: false,
      command: 'config use',
      error: {
        code: 'PROFILE_NOT_FOUND',
        message: "Profile 'bogus' is not defined.",
        hint: 'try list',
      },
    });
  });

  it('falls back to IO_ERROR for non-CLI errors', () => {
    const env = buildFailure({ command: 'doctor' }, new Error('boom'));
    expect(env.ok).toBe(false);
    if (!env.ok) {
      expect(env.error.code).toBe('IO_ERROR');
      expect(env.error.message).toBe('boom');
    }
  });
});

describe('maskAddress', () => {
  it('keeps short strings as-is', () => {
    expect(maskAddress('short')).toBe('short');
    expect(maskAddress('')).toBe('');
    expect(maskAddress(null)).toBe('');
    expect(maskAddress(undefined)).toBe('');
  });

  it('masks the middle of long addresses', () => {
    expect(maskAddress('TTX1Us19zqsLXhY39PPR7KRUoMa93s3J3i')).toBe('TTX1Us...3J3i');
    expect(maskAddress('0xddb8ff7605526a250bd37f5c3733badf9860f8708e808b79f40f8c56470004ba')).toBe(
      '0xddb8...04ba',
    );
  });
});

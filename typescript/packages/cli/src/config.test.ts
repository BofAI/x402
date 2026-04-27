import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  loadConfig,
  saveConfig,
  defaultConfig,
  applyEnvOverrides,
  getProfile,
} from './config.js';

let tmpDir: string;
let cfgPath: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'x402-cli-test-'));
  cfgPath = path.join(tmpDir, 'config.json');
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
  delete process.env.X402_NETWORK;
  delete process.env.X402_SCHEME;
  delete process.env.X402_TOKEN;
});

describe('config', () => {
  it('roundtrips defaultConfig through save/load', async () => {
    const cfg = defaultConfig();
    const written = await saveConfig(cfg, cfgPath);
    expect(written).toBe(cfgPath);
    const loaded = await loadConfig(cfgPath);
    expect(loaded).toEqual(cfg);
  });

  it('throws CONFIG_NOT_FOUND when the file is missing', async () => {
    const missing = path.join(tmpDir, 'nope.json');
    await expect(loadConfig(missing)).rejects.toMatchObject({
      code: 'CONFIG_NOT_FOUND',
    });
  });

  it('rejects malformed JSON with IO_ERROR', async () => {
    await fs.writeFile(cfgPath, '{ this is not json', 'utf8');
    await expect(loadConfig(cfgPath)).rejects.toMatchObject({
      code: 'IO_ERROR',
    });
  });

  it('rejects a profiles dict where defaultProfile is missing', async () => {
    await fs.writeFile(
      cfgPath,
      JSON.stringify({
        defaultProfile: 'ghost',
        profiles: {
          nile: {
            network: 'tron:nile',
            scheme: 'exact_gasfree',
            wallet: { network: 'tron' },
          },
        },
      }),
      'utf8',
    );
    await expect(loadConfig(cfgPath)).rejects.toMatchObject({
      code: 'IO_ERROR',
    });
  });

  it('getProfile uses the default when no name is given', () => {
    const cfg = defaultConfig();
    const { name, profile } = getProfile(cfg);
    expect(name).toBe('nile');
    expect(profile.network).toBe('tron:nile');
  });

  it('getProfile throws PROFILE_NOT_FOUND for unknown name', () => {
    const cfg = defaultConfig();
    expect(() => getProfile(cfg, 'ghost')).toThrowError(/PROFILE_NOT_FOUND|not defined/);
  });

  it('applyEnvOverrides replaces network/scheme/token from X402_* env', () => {
    const base = defaultConfig().profiles.nile!;
    process.env.X402_NETWORK = 'tron:mainnet';
    process.env.X402_SCHEME = 'exact_permit';
    process.env.X402_TOKEN = 'USDD';
    const merged = applyEnvOverrides(base);
    expect(merged.network).toBe('tron:mainnet');
    expect(merged.scheme).toBe('exact_permit');
    expect(merged.token).toBe('USDD');
    // Original profile is not mutated
    expect(base.network).toBe('tron:nile');
  });
});

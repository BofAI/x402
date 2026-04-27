import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { cmdInit, cmdGet, cmdUse, cmdSet, cmdList } from './config.js';

let tmpDir: string;
let cfgPath: string;
let logSpy: ReturnType<typeof vi.spyOn>;
let errSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'x402-cli-cmd-'));
  cfgPath = path.join(tmpDir, 'config.json');
  process.env.X402_CONFIG_FILE = cfgPath;
  logSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(async () => {
  delete process.env.X402_CONFIG_FILE;
  logSpy.mockRestore();
  errSpy.mockRestore();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function lastJson(): unknown {
  const calls = logSpy.mock.calls.map((c) => String(c[0])).filter((s) => s.startsWith('{'));
  return JSON.parse(calls[calls.length - 1]!);
}

describe('cmdInit', () => {
  it('creates the default config when none exists', async () => {
    const code = await cmdInit({ output: 'json' });
    expect(code).toBe(0);
    const env = lastJson() as { ok: boolean; result: { created: boolean } };
    expect(env.ok).toBe(true);
    expect(env.result.created).toBe(true);
    const onDisk = JSON.parse(await fs.readFile(cfgPath, 'utf8'));
    expect(onDisk.defaultProfile).toBe('nile');
  });

  it('refuses to overwrite without --force', async () => {
    await cmdInit({ output: 'json' });
    const code = await cmdInit({ output: 'json' });
    expect(code).toBe(1);
    const env = lastJson() as { ok: false; error: { code: string } };
    expect(env.ok).toBe(false);
    expect(env.error.code).toBe('IO_ERROR');
  });

  it('overwrites with --force', async () => {
    await cmdInit({ output: 'json' });
    const code = await cmdInit({ force: true, output: 'json' });
    expect(code).toBe(0);
    const env = lastJson() as { ok: true; result: { created: boolean } };
    expect(env.result.created).toBe(false);
  });

  it('uses --network and --scheme on the default profile', async () => {
    await cmdInit({ network: 'tron:mainnet', scheme: 'exact_permit', output: 'json' });
    const onDisk = JSON.parse(await fs.readFile(cfgPath, 'utf8'));
    expect(onDisk.profiles.nile.network).toBe('tron:mainnet');
    expect(onDisk.profiles.nile.scheme).toBe('exact_permit');
  });
});

describe('cmdGet / cmdUse', () => {
  beforeEach(async () => {
    await cmdInit({ output: 'json' });
    logSpy.mockClear();
  });

  it('returns the default profile when no name passed', async () => {
    const code = await cmdGet(undefined, 'json');
    expect(code).toBe(0);
    const env = lastJson() as { ok: true; result: { profile: string; isDefault: boolean } };
    expect(env.result.profile).toBe('nile');
    expect(env.result.isDefault).toBe(true);
  });

  it('switches the active profile', async () => {
    const code = await cmdUse('mainnet', 'json');
    expect(code).toBe(0);
    const onDisk = JSON.parse(await fs.readFile(cfgPath, 'utf8'));
    expect(onDisk.defaultProfile).toBe('mainnet');
  });

  it('rejects an unknown profile', async () => {
    const code = await cmdUse('ghost', 'json');
    expect(code).toBe(1);
    const env = lastJson() as { ok: false; error: { code: string } };
    expect(env.error.code).toBe('PROFILE_NOT_FOUND');
  });
});

describe('cmdSet', () => {
  beforeEach(async () => {
    await cmdInit({ output: 'json' });
    logSpy.mockClear();
  });

  it('updates a dotted profile field', async () => {
    const code = await cmdSet('nile.token', 'USDD', 'json');
    expect(code).toBe(0);
    const onDisk = JSON.parse(await fs.readFile(cfgPath, 'utf8'));
    expect(onDisk.profiles.nile.token).toBe('USDD');
  });

  it('updates defaultProfile when a known profile is named', async () => {
    const code = await cmdSet('defaultProfile', 'mainnet', 'json');
    expect(code).toBe(0);
    const onDisk = JSON.parse(await fs.readFile(cfgPath, 'utf8'));
    expect(onDisk.defaultProfile).toBe('mainnet');
  });

  it('rejects an unknown top-level key', async () => {
    const code = await cmdSet('mystery', 'value', 'json');
    expect(code).toBe(1);
    const env = lastJson() as { ok: false; error: { code: string } };
    expect(env.error.code).toBe('INVALID_INPUT');
  });

  it('rejects setting wallet.network to a bogus family', async () => {
    const code = await cmdSet('nile.wallet.network', 'aptos', 'json');
    expect(code).toBe(1);
    const env = lastJson() as { ok: false; error: { code: string } };
    expect(env.error.code).toBe('INVALID_INPUT');
  });
});

describe('cmdList', () => {
  it('lists all profiles + path + default name', async () => {
    await cmdInit({ output: 'json' });
    logSpy.mockClear();
    const code = await cmdList('json');
    expect(code).toBe(0);
    const env = lastJson() as {
      ok: true;
      result: { defaultProfile: string; profiles: Array<{ name: string }> };
    };
    expect(env.result.defaultProfile).toBe('nile');
    expect(env.result.profiles.map((p) => p.name).sort()).toEqual(['mainnet', 'nile']);
  });
});

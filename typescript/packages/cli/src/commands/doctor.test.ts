import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { cmdDoctor } from './doctor.js';
import { cmdInit } from './config.js';
import { GasFreeAPIClient } from '@bankofai/x402';

const SAMPLE_KEY = '0xddb8ff7605526a250bd37f5c3733badf9860f8708e808b79f40f8c56470004ba';

let tmpDir: string;
let cfgPath: string;
let stdoutSpy: ReturnType<typeof vi.spyOn>;
let stderrSpy: ReturnType<typeof vi.spyOn>;
let fetchSpy: ReturnType<typeof vi.spyOn>;
let getInfoSpy: ReturnType<typeof vi.spyOn> | null = null;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'x402-cli-doctor-'));
  cfgPath = path.join(tmpDir, 'config.json');
  process.env.X402_CONFIG_FILE = cfgPath;
  stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  // Stub the readiness probe so we never actually hit the network.
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ code: 200, data: [] }), { status: 200 }) as unknown as Response,
  );
  await cmdInit({ output: 'json' });
  stdoutSpy.mockClear();
});

afterEach(async () => {
  delete process.env.X402_CONFIG_FILE;
  delete process.env.TRON_PRIVATE_KEY;
  delete process.env.X402_FACILITATOR_URL_OVERRIDE;
  stdoutSpy.mockRestore();
  stderrSpy.mockRestore();
  fetchSpy.mockRestore();
  if (getInfoSpy) {
    getInfoSpy.mockRestore();
    getInfoSpy = null;
  }
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function lastJson(): {
  ok: boolean;
  result: {
    overall: string;
    wallet: string | null;
    checks: Array<{ name: string; status: string; detail?: string }>;
  };
} {
  const calls = stdoutSpy.mock.calls.map((c) => String(c[0])).filter((s) => s.startsWith('{'));
  return JSON.parse(calls[calls.length - 1]!);
}

function findCheck(env: ReturnType<typeof lastJson>, name: string) {
  const c = env.result.checks.find((x) => x.name === name);
  if (!c) throw new Error(`check '${name}' not in envelope`);
  return c;
}

describe('cmdDoctor', () => {
  it('reports overall=fail when wallet env is missing', async () => {
    const code = await cmdDoctor({ output: 'json' });
    expect(code).toBe(0);
    const env = lastJson();
    expect(env.result.overall).toBe('fail');
    expect(findCheck(env, 'wallet').status).toBe('fail');
    // gasfree depends on wallet → skipped, not failed.
    expect(findCheck(env, 'gasfree').status).toBe('skipped');
    // facilitator and node still ran independently.
    expect(findCheck(env, 'facilitator').status).toBe('ok');
    expect(findCheck(env, 'node').status).toBe('ok');
  });

  it('reports overall=ok when wallet + facilitator are green and gasfree is not applicable', async () => {
    process.env.TRON_PRIVATE_KEY = SAMPLE_KEY;
    getInfoSpy = vi.spyOn(GasFreeAPIClient.prototype, 'getAddressInfo').mockResolvedValue({
      accountAddress: 'TTX1Us19zqsLXhY39PPR7KRUoMa93s3J3i',
      gasFreeAddress: 'TErc7VfxqmXJo5yJmtWsMRE1YEn69jFYUt',
      active: true,
      allowSubmit: true,
      nonce: 1,
      assets: [],
    });
    const code = await cmdDoctor({ output: 'json' });
    expect(code).toBe(0);
    const env = lastJson();
    expect(env.result.overall).toBe('ok');
    expect(env.result.wallet).toMatch(/^TTX1Us\.\.\./);
    expect(findCheck(env, 'gasfree').status).toBe('skipped');
  });

  it('reports facilitator=fail when every readiness probe rejects', async () => {
    process.env.TRON_PRIVATE_KEY = SAMPLE_KEY;
    // The doctor probes /api/v1/config/provider/all then /supported in series;
    // make every fetch reject so the probe's both attempts fail.
    fetchSpy.mockRejectedValue(new Error('ECONNREFUSED'));
    const code = await cmdDoctor({ output: 'json' });
    expect(code).toBe(0);
    const env = lastJson();
    expect(findCheck(env, 'facilitator').status).toBe('fail');
    expect(env.result.overall).toBe('fail');
  });

  it('reports gasfree=fail for exact_gasfree when getAddressInfo throws', async () => {
    process.env.TRON_PRIVATE_KEY = SAMPLE_KEY;
    process.env.X402_SCHEME = 'exact_gasfree';
    getInfoSpy = vi
      .spyOn(GasFreeAPIClient.prototype, 'getAddressInfo')
      .mockRejectedValue(new Error('boom'));
    const code = await cmdDoctor({ output: 'json' });
    expect(code).toBe(0);
    const env = lastJson();
    expect(findCheck(env, 'gasfree').status).toBe('fail');
    expect(env.result.overall).toBe('fail');
  });
});

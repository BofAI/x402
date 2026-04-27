/**
 * Profile / config loading.
 *
 * Source-of-truth file: ~/.x402/config.json (overridable via X402_CONFIG_FILE).
 * Precedence (D3 in decisions.md): CLI flag > env var > profile > SDK default.
 *
 * The default `nile` profile points at the BankofAI Nile proxy and uses
 * `exact_gasfree`. After D4 the profile no longer carries `facilitatorUrl` —
 * the URL is always derived from `network`.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { X402CliError } from './error.js';

export interface WalletProfile {
  /** Network family the wallet belongs to ('tron' or 'evm'). */
  network: 'tron' | 'evm';
}

export interface Profile {
  /** CAIP-2 network id, e.g. "tron:nile" or "eip155:97". */
  network: string;
  /** Default scheme, e.g. "exact_gasfree". */
  scheme: string;
  /** Default token symbol resolved against the SDK token registry. */
  token?: string;
  wallet: WalletProfile;
}

export interface CliConfig {
  defaultProfile: string;
  profiles: Record<string, Profile>;
}

export const DEFAULT_PROFILE_NAME = 'nile';

export function defaultConfig(): CliConfig {
  return {
    defaultProfile: DEFAULT_PROFILE_NAME,
    profiles: {
      [DEFAULT_PROFILE_NAME]: {
        network: 'tron:nile',
        scheme: 'exact_gasfree',
        token: 'USDT',
        wallet: { network: 'tron' },
      },
      mainnet: {
        network: 'tron:mainnet',
        scheme: 'exact_gasfree',
        token: 'USDT',
        wallet: { network: 'tron' },
      },
    },
  };
}

export function configFilePath(): string {
  const override = process.env.X402_CONFIG_FILE;
  if (override && override.trim()) return path.resolve(override.trim());
  const home = process.env.HOME || os.homedir();
  return path.join(home, '.x402', 'config.json');
}

export async function loadConfig(filePath?: string): Promise<CliConfig> {
  const target = filePath ?? configFilePath();
  let raw: string;
  try {
    raw = await fs.readFile(target, 'utf8');
  } catch (err) {
    if (isENOENT(err)) {
      throw new X402CliError(
        'CONFIG_NOT_FOUND',
        `No x402 config at ${target}.`,
        `Run \`x402 config init\` to create the default profile.`,
      );
    }
    throw new X402CliError('IO_ERROR', `Failed to read config at ${target}: ${(err as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new X402CliError(
      'IO_ERROR',
      `Config at ${target} is not valid JSON: ${(err as Error).message}`,
    );
  }
  return validateConfig(parsed, target);
}

export async function saveConfig(cfg: CliConfig, filePath?: string): Promise<string> {
  const target = filePath ?? configFilePath();
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  return target;
}

export function getProfile(cfg: CliConfig, name?: string): { name: string; profile: Profile } {
  const target = name ?? cfg.defaultProfile;
  const profile = cfg.profiles[target];
  if (!profile) {
    throw new X402CliError(
      'PROFILE_NOT_FOUND',
      `Profile '${target}' is not defined in the config.`,
      `Run \`x402 config list\` to see available profiles, or \`x402 config init\` to recreate defaults.`,
    );
  }
  return { name: target, profile };
}

/**
 * Per D3: env var > profile > SDK default. flags > env vars handled at the
 * command layer; this function returns a profile-with-overrides snapshot
 * applied only at the env-var level.
 */
export function applyEnvOverrides(profile: Profile): Profile {
  const env = process.env;
  return {
    ...profile,
    network: env.X402_NETWORK?.trim() || profile.network,
    scheme: env.X402_SCHEME?.trim() || profile.scheme,
    token: env.X402_TOKEN?.trim() || profile.token,
  };
}

function validateConfig(value: unknown, source: string): CliConfig {
  if (!value || typeof value !== 'object') {
    throw new X402CliError('IO_ERROR', `Config at ${source} is not an object.`);
  }
  const v = value as Record<string, unknown>;
  if (typeof v.defaultProfile !== 'string') {
    throw new X402CliError('IO_ERROR', `Config at ${source} is missing 'defaultProfile'.`);
  }
  if (!v.profiles || typeof v.profiles !== 'object') {
    throw new X402CliError('IO_ERROR', `Config at ${source} is missing 'profiles'.`);
  }
  const out: CliConfig = {
    defaultProfile: v.defaultProfile,
    profiles: {},
  };
  for (const [name, raw] of Object.entries(v.profiles as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') {
      throw new X402CliError('IO_ERROR', `Profile '${name}' is not an object.`);
    }
    const p = raw as Record<string, unknown>;
    if (typeof p.network !== 'string' || typeof p.scheme !== 'string') {
      throw new X402CliError(
        'IO_ERROR',
        `Profile '${name}' is missing required string fields 'network' / 'scheme'.`,
      );
    }
    const wallet = p.wallet as Record<string, unknown> | undefined;
    if (!wallet || (wallet.network !== 'tron' && wallet.network !== 'evm')) {
      throw new X402CliError(
        'IO_ERROR',
        `Profile '${name}'.wallet.network must be 'tron' or 'evm'.`,
      );
    }
    out.profiles[name] = {
      network: p.network,
      scheme: p.scheme,
      token: typeof p.token === 'string' ? p.token : undefined,
      wallet: { network: wallet.network },
    };
  }
  if (!out.profiles[out.defaultProfile]) {
    throw new X402CliError(
      'IO_ERROR',
      `defaultProfile '${out.defaultProfile}' is not defined in profiles.`,
    );
  }
  return out;
}

function isENOENT(err: unknown): boolean {
  return Boolean(err) && typeof err === 'object' && (err as { code?: string }).code === 'ENOENT';
}

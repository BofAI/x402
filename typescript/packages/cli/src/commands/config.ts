/**
 * `x402 config` — manage local profiles.
 *
 * Sub-commands: init / use / get / set / list.
 * No network access, no wallet, no signing.
 */

import { runCommand, type OutputMode } from '../output.js';
import {
  configFilePath,
  defaultConfig,
  loadConfig,
  saveConfig,
  getProfile,
  type CliConfig,
  type Profile,
} from '../config.js';
import { X402CliError } from '../error.js';
import { promises as fs } from 'node:fs';

export async function cmdInit(opts: {
  profile?: string;
  network?: string;
  scheme?: string;
  force?: boolean;
  output: OutputMode;
}): Promise<number> {
  return runCommand({ command: 'config init' }, opts.output, async () => {
    const target = configFilePath();
    let exists = false;
    try {
      await fs.access(target);
      exists = true;
    } catch {
      exists = false;
    }
    if (exists && !opts.force) {
      throw new X402CliError(
        'IO_ERROR',
        `Config already exists at ${target}.`,
        'Pass --force to overwrite, or run `x402 config get` to inspect it.',
      );
    }
    const cfg = defaultConfig();
    if (opts.profile && opts.profile !== cfg.defaultProfile) {
      // Promote the requested profile name as the default if it exists in the
      // template, otherwise create a fresh entry by cloning the nile template.
      const base = cfg.profiles[cfg.defaultProfile]!;
      cfg.profiles[opts.profile] = {
        ...base,
        network: opts.network || base.network,
        scheme: opts.scheme || base.scheme,
      };
      cfg.defaultProfile = opts.profile;
    } else if (opts.network || opts.scheme) {
      const def = cfg.profiles[cfg.defaultProfile]!;
      cfg.profiles[cfg.defaultProfile] = {
        ...def,
        network: opts.network || def.network,
        scheme: opts.scheme || def.scheme,
      };
    }
    const path = await saveConfig(cfg);
    return {
      path,
      defaultProfile: cfg.defaultProfile,
      profiles: Object.keys(cfg.profiles),
      created: !exists,
    };
  });
}

export async function cmdUse(name: string, output: OutputMode): Promise<number> {
  return runCommand({ command: 'config use' }, output, async () => {
    const cfg = await loadConfig();
    if (!cfg.profiles[name]) {
      throw new X402CliError(
        'PROFILE_NOT_FOUND',
        `Profile '${name}' is not defined.`,
        `Run \`x402 config list\` to see available profiles.`,
      );
    }
    cfg.defaultProfile = name;
    const path = await saveConfig(cfg);
    return { path, defaultProfile: name };
  });
}

export async function cmdGet(name: string | undefined, output: OutputMode): Promise<number> {
  return runCommand({ command: 'config get' }, output, async () => {
    const cfg = await loadConfig();
    const { name: resolved, profile } = getProfile(cfg, name);
    return {
      profile: resolved,
      isDefault: cfg.defaultProfile === resolved,
      ...profile,
    };
  });
}

export async function cmdSet(
  key: string,
  value: string,
  output: OutputMode,
): Promise<number> {
  return runCommand({ command: 'config set' }, output, async () => {
    // Accepted keys (D4: facilitatorUrl is no longer settable):
    //   defaultProfile
    //   <profile>.network | <profile>.scheme | <profile>.token | <profile>.wallet.network
    const cfg = await loadConfig();
    applyKeyPath(cfg, key, value);
    const path = await saveConfig(cfg);
    return { path, key, value };
  });
}

export async function cmdList(output: OutputMode): Promise<number> {
  return runCommand({ command: 'config list' }, output, async () => {
    const cfg = await loadConfig();
    const path = configFilePath();
    return {
      path,
      defaultProfile: cfg.defaultProfile,
      profiles: Object.entries(cfg.profiles).map(([name, p]) => ({
        name,
        network: p.network,
        scheme: p.scheme,
        token: p.token,
        walletNetwork: p.wallet.network,
      })),
    };
  });
}

function applyKeyPath(cfg: CliConfig, key: string, value: string): void {
  // Single-segment key: top-level field on CliConfig.
  if (!key.includes('.')) {
    if (key === 'defaultProfile') {
      if (!cfg.profiles[value]) {
        throw new X402CliError(
          'PROFILE_NOT_FOUND',
          `Cannot set defaultProfile to '${value}' — profile is not defined.`,
        );
      }
      cfg.defaultProfile = value;
      return;
    }
    throw new X402CliError(
      'INVALID_INPUT',
      `Unsupported config key '${key}'.`,
      'Use a dotted path like `nile.network` or the special key `defaultProfile`.',
    );
  }
  // Dotted path: <profile>.<field>[.<sub>] — only the documented fields below.
  const segments = key.split('.');
  const profileName = segments[0];
  const profile: Profile | undefined = cfg.profiles[profileName];
  if (!profile) {
    throw new X402CliError(
      'PROFILE_NOT_FOUND',
      `Profile '${profileName}' is not defined.`,
    );
  }
  const field = segments.slice(1).join('.');
  switch (field) {
    case 'network':
      profile.network = value;
      return;
    case 'scheme':
      profile.scheme = value;
      return;
    case 'token':
      profile.token = value;
      return;
    case 'wallet.network':
      if (value !== 'tron' && value !== 'evm') {
        throw new X402CliError(
          'INVALID_INPUT',
          `wallet.network must be 'tron' or 'evm', got '${value}'.`,
        );
      }
      profile.wallet.network = value;
      return;
    default:
      throw new X402CliError(
        'INVALID_INPUT',
        `Unsupported profile field '${field}'.`,
        `Settable fields: network, scheme, token, wallet.network.`,
      );
  }
}

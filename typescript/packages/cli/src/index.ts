#!/usr/bin/env node
/**
 * x402 CLI entry point.
 *
 * Routes commands and resolves the output mode. All command bodies live in
 * src/commands/<name>.ts and return an exit code via runCommand().
 */

import { Command } from 'commander';
import { cmdInit, cmdUse, cmdGet, cmdSet, cmdList } from './commands/config.js';
import { cmdDoctor } from './commands/doctor.js';
import { cmdBalance } from './commands/balance.js';
import type { OutputMode } from './output.js';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

function readPackageVersion(): string {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const pkgPath = path.resolve(here, '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function resolveOutputMode(opts: Record<string, unknown>): OutputMode {
  if (opts.json === true) return 'json';
  const env = process.env.X402_OUTPUT?.trim().toLowerCase();
  if (env === 'json') return 'json';
  return 'human';
}

function exitWith(code: number): void {
  // Drain stdout before exiting so JSON piped to consumers isn't truncated.
  process.stdout.write('', () => process.exit(code));
}

async function main(argv: string[]): Promise<void> {
  const program = new Command()
    .name('x402')
    .description('BankofAI x402 command-line tool')
    .version(readPackageVersion(), '-v, --version', 'Show CLI version');

  // ---- config ----
  const config = program.command('config').description('Manage local profiles');

  config
    .command('init')
    .description('Create the default x402 config under ~/.x402/config.json')
    .option('--profile <name>', 'Profile name to set as default (default: nile)')
    .option('--network <network>', 'CAIP-2 network for the chosen profile')
    .option('--scheme <scheme>', 'Scheme (e.g. exact_gasfree)')
    .option('--force', 'Overwrite an existing config file')
    .option('--json', 'Emit machine-readable JSON output')
    .action(async (opts: Record<string, unknown>) => {
      const code = await cmdInit({
        profile: typeof opts.profile === 'string' ? opts.profile : undefined,
        network: typeof opts.network === 'string' ? opts.network : undefined,
        scheme: typeof opts.scheme === 'string' ? opts.scheme : undefined,
        force: opts.force === true,
        output: resolveOutputMode(opts),
      });
      exitWith(code);
    });

  config
    .command('use <name>')
    .description('Switch the active profile')
    .option('--json', 'Emit machine-readable JSON output')
    .action(async (name: string, opts: Record<string, unknown>) => {
      const code = await cmdUse(name, resolveOutputMode(opts));
      exitWith(code);
    });

  config
    .command('get [name]')
    .description('Show the named profile (or the default)')
    .option('--json', 'Emit machine-readable JSON output')
    .action(async (name: string | undefined, opts: Record<string, unknown>) => {
      const code = await cmdGet(name, resolveOutputMode(opts));
      exitWith(code);
    });

  config
    .command('set <key> <value>')
    .description('Update a single config field (e.g. nile.network tron:nile)')
    .option('--json', 'Emit machine-readable JSON output')
    .action(async (key: string, value: string, opts: Record<string, unknown>) => {
      const code = await cmdSet(key, value, resolveOutputMode(opts));
      exitWith(code);
    });

  config
    .command('list')
    .description('Show all defined profiles')
    .option('--json', 'Emit machine-readable JSON output')
    .action(async (opts: Record<string, unknown>) => {
      const code = await cmdList(resolveOutputMode(opts));
      exitWith(code);
    });

  // ---- doctor ----
  program
    .command('doctor')
    .description('Run read-only environment diagnostics')
    .option('--profile <name>', 'Profile to test (default: active profile)')
    .option('--network <network>', 'Override network for this run')
    .option('--json', 'Emit machine-readable JSON output')
    .action(async (opts: Record<string, unknown>) => {
      const code = await cmdDoctor({
        profile: typeof opts.profile === 'string' ? opts.profile : undefined,
        network: typeof opts.network === 'string' ? opts.network : undefined,
        output: resolveOutputMode(opts),
      });
      exitWith(code);
    });

  // ---- balance ----
  program
    .command('balance')
    .description('Show wallet + GasFree balance for the active profile')
    .option('--profile <name>', 'Profile to use')
    .option('--network <network>', 'Override network')
    .option('--token <symbol>', 'Filter to a specific token symbol')
    .option('--gasfree', 'Query the GasFree API (default for TRON)')
    .option('--no-gasfree', 'Suppress the GasFree query (post-MVP placeholder)')
    .option('--verbose', 'Show full address strings instead of masked')
    .option('--json', 'Emit machine-readable JSON output')
    .action(async (opts: Record<string, unknown>) => {
      const code = await cmdBalance({
        profile: typeof opts.profile === 'string' ? opts.profile : undefined,
        network: typeof opts.network === 'string' ? opts.network : undefined,
        token: typeof opts.token === 'string' ? opts.token : undefined,
        gasfree: opts.gasfree !== false,
        verbose: opts.verbose === true,
        output: resolveOutputMode(opts),
      });
      exitWith(code);
    });

  // No subcommand → help
  program.action(() => {
    program.outputHelp();
    exitWith(0);
  });

  await program.parseAsync(argv);
}

main(process.argv).catch((err: Error) => {
  process.stderr.write(`x402: ${err.message}\n`);
  process.exit(2);
});

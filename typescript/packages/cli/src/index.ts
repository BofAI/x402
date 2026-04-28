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
import { cmdTransfer } from './commands/transfer.js';
import { cmdPay } from './commands/pay.js';
import { cmdServeTransfer } from './commands/serve.js';
import { cmdReceiptList, cmdReceiptShow, cmdReceiptExport } from './commands/receipt.js';
import { cmdRequest } from './commands/request.js';
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

function collect(value: string, accumulator: string[]): string[] {
  return [...accumulator, value];
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
    .option('--scheme <scheme>', 'Scheme (e.g. exact_permit, exact_gasfree)')
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

  // ---- transfer ----
  program
    .command('transfer')
    .description('Direct payment: build PaymentRequirements locally and settle through the facilitator')
    .requiredOption('--to <address>', 'Recipient address (payTo)')
    .requiredOption('--amount <decimal>', 'Human-readable amount, e.g. 1.25')
    .option('--token <symbol>', 'Token symbol from the registry (e.g. USDT)')
    .option('--asset <address>', 'Explicit token address (use with --decimals when not in registry)')
    .option('--decimals <n>', 'Decimals when using --asset', (v) => Number.parseInt(v, 10))
    .option('--network <network>', 'Override network')
    .option('--scheme <scheme>', 'Scheme (default exact_permit for TRON USDT)')
    .option('--profile <name>', 'Profile to use')
    .option('--valid-for <seconds>', 'Override deadline window', (v) => Number.parseInt(v, 10))
    .option('--payment-id <id>', 'Reuse a paymentId for reconciliation')
    .option('--dry-run', 'Build the plan + fee quote without signing or settling')
    .option('--yes', 'Skip interactive confirmation (currently always implicit)')
    .option('--json', 'Emit machine-readable JSON output')
    .action(async (opts: Record<string, unknown>) => {
      const code = await cmdTransfer({
        to: String(opts.to),
        amount: String(opts.amount),
        token: typeof opts.token === 'string' ? opts.token : undefined,
        asset: typeof opts.asset === 'string' ? opts.asset : undefined,
        decimals: typeof opts.decimals === 'number' ? opts.decimals : undefined,
        network: typeof opts.network === 'string' ? opts.network : undefined,
        scheme: typeof opts.scheme === 'string' ? opts.scheme : undefined,
        profile: typeof opts.profile === 'string' ? opts.profile : undefined,
        validForSeconds: typeof opts.validFor === 'number' ? opts.validFor : undefined,
        paymentId: typeof opts.paymentId === 'string' ? opts.paymentId : undefined,
        dryRun: opts.dryRun === true,
        yes: opts.yes === true,
        output: resolveOutputMode(opts),
      });
      exitWith(code);
    });

  // ---- pay ----
  program
    .command('pay <url>')
    .description('Fetch a 402-protected URL with automatic payment retry')
    .option('--method <method>', 'HTTP method', 'GET')
    .option('--header <kv>', 'Add a header (Key: value); repeatable', collect, [])
    .option('--body <json>', 'Request body (string)')
    .option('--profile <name>', 'Profile to use')
    .option('--network <network>', 'Override network')
    .option('--scheme <scheme>', 'Override scheme filter')
    .option('--max-amount <smallest-unit>', 'Smallest-unit cap')
    .option('--dry-run', 'Probe the URL for accepts[] without signing')
    .option('--json', 'Emit machine-readable JSON output')
    .action(async (url: string, opts: Record<string, unknown>) => {
      const code = await cmdPay({
        url,
        method: typeof opts.method === 'string' ? opts.method : undefined,
        headers: Array.isArray(opts.header) ? (opts.header as string[]) : undefined,
        body: typeof opts.body === 'string' ? opts.body : undefined,
        profile: typeof opts.profile === 'string' ? opts.profile : undefined,
        network: typeof opts.network === 'string' ? opts.network : undefined,
        scheme: typeof opts.scheme === 'string' ? opts.scheme : undefined,
        maxAmount: typeof opts.maxAmount === 'string' ? opts.maxAmount : undefined,
        dryRun: opts.dryRun === true,
        output: resolveOutputMode(opts),
      });
      exitWith(code);
    });

  // ---- request ----
  program
    .command('request')
    .description('Generate an offline x402 transfer request URI or JSON object')
    .requiredOption('--to <address>', 'Recipient address')
    .requiredOption('--amount <decimal>', 'Human-readable amount')
    .option('--token <symbol>', 'Token symbol')
    .option('--asset <address>', 'Explicit token address')
    .option('--decimals <n>', 'Decimals when using --asset', (v) => Number.parseInt(v, 10))
    .option('--profile <name>', 'Profile to use')
    .option('--network <network>', 'Override network')
    .option('--scheme <scheme>', 'Override scheme')
    .option('--memo <text>', 'Optional memo')
    .option('--expires-in <seconds>', 'Expiry in seconds', (v) => Number.parseInt(v, 10))
    .option('--format <format>', 'uri | json', 'uri')
    .option('--json', 'Emit machine-readable JSON output')
    .action(async (opts: Record<string, unknown>) => {
      const code = await cmdRequest({
        to: String(opts.to),
        amount: String(opts.amount),
        token: typeof opts.token === 'string' ? opts.token : undefined,
        asset: typeof opts.asset === 'string' ? opts.asset : undefined,
        decimals: typeof opts.decimals === 'number' ? opts.decimals : undefined,
        profile: typeof opts.profile === 'string' ? opts.profile : undefined,
        network: typeof opts.network === 'string' ? opts.network : undefined,
        scheme: typeof opts.scheme === 'string' ? opts.scheme : undefined,
        memo: typeof opts.memo === 'string' ? opts.memo : undefined,
        expiresIn: typeof opts.expiresIn === 'number' ? opts.expiresIn : undefined,
        format: typeof opts.format === 'string' ? opts.format : 'uri',
        output: resolveOutputMode(opts),
      });
      exitWith(code);
    });

  // ---- serve transfer ----
  const serve = program.command('serve').description('Run a temporary x402 service');
  serve
    .command('transfer')
    .description('Start a temporary collection server: any payer can settle to --pay-to')
    .requiredOption('--pay-to <address>', 'Recipient address')
    .requiredOption('--amount <decimal>', 'Human-readable amount')
    .option('--token <symbol>', 'Token symbol')
    .option('--asset <address>', 'Explicit token address')
    .option('--decimals <n>', 'Decimals when using --asset', (v) => Number.parseInt(v, 10))
    .option('--host <host>', 'Bind host', '127.0.0.1')
    .option('--port <port>', 'Bind port', (v) => Number.parseInt(v, 10), 4020)
    .option('--profile <name>', 'Profile to use')
    .option('--network <network>', 'Override network')
    .option('--scheme <scheme>', 'Override scheme')
    .option('--json', 'Emit machine-readable JSON output')
    .action(async (opts: Record<string, unknown>) => {
      const code = await cmdServeTransfer({
        host: typeof opts.host === 'string' ? opts.host : undefined,
        port: typeof opts.port === 'number' ? opts.port : undefined,
        payTo: String(opts.payTo),
        amount: String(opts.amount),
        token: typeof opts.token === 'string' ? opts.token : undefined,
        asset: typeof opts.asset === 'string' ? opts.asset : undefined,
        decimals: typeof opts.decimals === 'number' ? opts.decimals : undefined,
        profile: typeof opts.profile === 'string' ? opts.profile : undefined,
        network: typeof opts.network === 'string' ? opts.network : undefined,
        scheme: typeof opts.scheme === 'string' ? opts.scheme : undefined,
        output: resolveOutputMode(opts),
      });
      exitWith(code);
    });

  // ---- receipt ----
  const receipt = program.command('receipt').description('Inspect the local receipt store');
  receipt
    .command('list')
    .description('List receipts (newest at the end)')
    .option('--profile <name>', 'Filter by profile')
    .option('--network <network>', 'Filter by network')
    .option('--scheme <scheme>', 'Filter by scheme')
    .option('--token <symbol>', 'Filter by token symbol')
    .option('--from <ts>', 'Start of range (unix seconds or ISO 8601)')
    .option('--to <ts>', 'End of range (unix seconds or ISO 8601)')
    .option('--limit <n>', 'Show only the last <n> matches', (v) => Number.parseInt(v, 10))
    .option('--json', 'Emit machine-readable JSON output')
    .action(async (opts: Record<string, unknown>) => {
      const code = await cmdReceiptList({
        profile: typeof opts.profile === 'string' ? opts.profile : undefined,
        network: typeof opts.network === 'string' ? opts.network : undefined,
        scheme: typeof opts.scheme === 'string' ? opts.scheme : undefined,
        token: typeof opts.token === 'string' ? opts.token : undefined,
        from: typeof opts.from === 'string' ? opts.from : undefined,
        to: typeof opts.to === 'string' ? opts.to : undefined,
        limit: typeof opts.limit === 'number' ? opts.limit : undefined,
        output: resolveOutputMode(opts),
      });
      exitWith(code);
    });
  receipt
    .command('show <id>')
    .description('Show a receipt by paymentId or transaction hash')
    .option('--json', 'Emit machine-readable JSON output')
    .action(async (id: string, opts: Record<string, unknown>) => {
      const code = await cmdReceiptShow(id, resolveOutputMode(opts));
      exitWith(code);
    });
  receipt
    .command('export')
    .description('Export all receipts as JSON or CSV')
    .option('--format <format>', 'json | csv', 'json')
    .option('--json', 'Wrap the output in the standard envelope')
    .action(async (opts: Record<string, unknown>) => {
      const code = await cmdReceiptExport(
        typeof opts.format === 'string' ? opts.format : 'json',
        resolveOutputMode(opts),
      );
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

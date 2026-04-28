#!/usr/bin/env node
/**
 * x402-tools CLI entry point.
 *
 * Two commands only:
 *   server <opts>       — start a local x402 payment server
 *   client <url> <opts> — pay an x402-protected URL as a client
 *
 * See FEATURES.md for the full flag matrix.
 */

import { Command } from 'commander';
import { cmdServer } from './commands/server.js';
import { cmdClient } from './commands/client.js';
import type { OutputMode } from './output.js';
import type { WalletSource } from './wallet.js';

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

function resolveWalletSource(value: unknown): WalletSource | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  if (value === 'agent-wallet' || value === 'env') return value;
  throw new Error(`--wallet must be 'agent-wallet' or 'env' (got '${value}')`);
}

function exitWith(code: number): void {
  process.stdout.write('', () => process.exit(code));
}

function collect(value: string, accumulator: string[]): string[] {
  return [...accumulator, value];
}

async function main(argv: string[]): Promise<void> {
  const program = new Command()
    .name('x402-tools')
    .description('One-shot BankofAI x402 tools for serving and paying x402 endpoints.')
    .version(readPackageVersion(), '-v, --version', 'Show CLI version');

  program
    .command('server')
    .description('Start a local x402 payment server')
    .requiredOption('--pay-to <address>', 'Recipient wallet address')
    .option('--decimal <decimal>', 'Human-readable amount, e.g. 1.25')
    .option('--amount <integer>', 'Smallest-unit amount, e.g. 1250000 for 1.25 USDT')
    .requiredOption('--network <id>', 'Payment network, e.g. tron:nile, eip155:97')
    .option('--token <symbol>', 'Token symbol from the registry (default: USDT)', 'USDT')
    .option('--asset <address>', 'Explicit token address (out of registry)')
    .option('--decimals <n>', 'Token decimals when --asset is given', (v) => Number.parseInt(v, 10))
    .option('--scheme <name>', 'x402 scheme: exact_permit | exact | exact_gasfree')
    .option('--host <host>', 'Bind host (default: 127.0.0.1)', '127.0.0.1')
    .option('--port <port>', 'Bind port (default: 4020)', (v) => Number.parseInt(v, 10), 4020)
    .option('--resource-url <url>', 'Resource URL advertised in x402 requirements')
    .option('--wallet <source>', 'Wallet source: agent-wallet | env (default: agent-wallet)', 'agent-wallet')
    .option('--daemon', 'Run server in background and print pid')
    .option('--json', 'Print server info as JSON')
    .action(async (opts: Record<string, unknown>) => {
      const code = await cmdServer({
        payTo: String(opts.payTo),
        decimal: typeof opts.decimal === 'string' ? opts.decimal : undefined,
        amount: typeof opts.amount === 'string' ? opts.amount : undefined,
        network: String(opts.network),
        token: typeof opts.token === 'string' ? opts.token : undefined,
        asset: typeof opts.asset === 'string' ? opts.asset : undefined,
        decimals: typeof opts.decimals === 'number' ? opts.decimals : undefined,
        scheme: typeof opts.scheme === 'string' ? opts.scheme : undefined,
        host: typeof opts.host === 'string' ? opts.host : undefined,
        port: typeof opts.port === 'number' ? opts.port : undefined,
        resourceUrl: typeof opts.resourceUrl === 'string' ? opts.resourceUrl : undefined,
        wallet: resolveWalletSource(opts.wallet),
        daemon: opts.daemon === true,
        output: resolveOutputMode(opts),
      });
      exitWith(code);
    });

  program
    .command('client <url>')
    .description('Pay an x402-protected URL when the server returns 402 Payment Required')
    .option('--max-decimal <decimal>', 'Maximum human-readable amount allowed')
    .option('--max-amount <integer>', 'Maximum smallest-unit amount allowed')
    .option('--network <id>', 'Require a specific network')
    .option('--token <symbol>', 'Require a specific token (default: USDT)')
    .option('--scheme <name>', 'Require a specific x402 scheme')
    .option('--method <method>', 'HTTP method (default: GET)', 'GET')
    .option('--header <kv>', 'HTTP header; can be repeated', collect, [])
    .option('--body <value>', 'Request body string or JSON')
    .option('--wallet <source>', 'Wallet source: agent-wallet | env (default: agent-wallet)', 'agent-wallet')
    .option('--dry-run', 'Read payment requirements but do not sign or pay')
    .option('--yes', 'Skip interactive confirmation (currently always implicit)')
    .option('--json', 'Print machine-readable JSON')
    .action(async (url: string, opts: Record<string, unknown>) => {
      const code = await cmdClient({
        url,
        method: typeof opts.method === 'string' ? opts.method : undefined,
        headers: Array.isArray(opts.header) ? (opts.header as string[]) : undefined,
        body: typeof opts.body === 'string' ? opts.body : undefined,
        maxDecimal: typeof opts.maxDecimal === 'string' ? opts.maxDecimal : undefined,
        maxAmount: typeof opts.maxAmount === 'string' ? opts.maxAmount : undefined,
        network: typeof opts.network === 'string' ? opts.network : undefined,
        token: typeof opts.token === 'string' ? opts.token : undefined,
        scheme: typeof opts.scheme === 'string' ? opts.scheme : undefined,
        wallet: resolveWalletSource(opts.wallet),
        dryRun: opts.dryRun === true,
        yes: opts.yes === true,
        output: resolveOutputMode(opts),
      });
      exitWith(code);
    });

  program.action(() => {
    program.outputHelp();
    exitWith(0);
  });

  await program.parseAsync(argv);
}

main(process.argv).catch((err: Error) => {
  process.stderr.write(`x402-tools: ${err.message}\n`);
  process.exit(2);
});

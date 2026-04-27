/**
 * Output formatting for the BankofAI x402 CLI.
 *
 * Two modes:
 * - human (default): printable, optionally with masking
 * - json: stable wrapped envelope for Agent consumption
 *
 * Envelope shape (D2 in specs/002-bankofai-cli/notes/decisions.md):
 *
 *   { ok: true,  command, network?, scheme?, result }
 *   { ok: false, command, error: { code, message, hint? } }
 */

import { isCliError, X402CliError } from './error.js';

export type OutputMode = 'human' | 'json';

export interface EnvelopeContext {
  command: string;
  network?: string;
  scheme?: string;
}

export interface SuccessEnvelope<T = unknown> {
  ok: true;
  command: string;
  network?: string;
  scheme?: string;
  result: T;
}

export interface FailureEnvelope {
  ok: false;
  command: string;
  network?: string;
  scheme?: string;
  error: {
    code: string;
    message: string;
    hint?: string;
  };
}

export function buildSuccess<T>(ctx: EnvelopeContext, result: T): SuccessEnvelope<T> {
  return {
    ok: true,
    command: ctx.command,
    ...(ctx.network ? { network: ctx.network } : {}),
    ...(ctx.scheme ? { scheme: ctx.scheme } : {}),
    result,
  };
}

export function buildFailure(ctx: EnvelopeContext, err: unknown): FailureEnvelope {
  let code = 'IO_ERROR';
  let message = 'unexpected error';
  let hint: string | undefined;

  if (isCliError(err)) {
    code = err.code;
    message = err.message;
    hint = err.hint;
  } else if (err instanceof Error) {
    message = err.message;
  } else if (typeof err === 'string') {
    message = err;
  }

  return {
    ok: false,
    command: ctx.command,
    ...(ctx.network ? { network: ctx.network } : {}),
    ...(ctx.scheme ? { scheme: ctx.scheme } : {}),
    error: hint ? { code, message, hint } : { code, message },
  };
}

export function emit(envelope: SuccessEnvelope | FailureEnvelope, mode: OutputMode): void {
  if (mode === 'json') {
    process.stdout.write(JSON.stringify(envelope) + '\n');
    return;
  }
  // Human mode renders below; envelope still carries the data.
  if (envelope.ok) {
    process.stdout.write(formatHuman(envelope) + '\n');
  } else {
    const e = envelope.error;
    process.stderr.write(`✗ ${envelope.command} failed: ${e.code}\n`);
    process.stderr.write(`  ${e.message}\n`);
    if (e.hint) {
      process.stderr.write(`  hint: ${e.hint}\n`);
    }
  }
}

/**
 * Mask an address: keep first 6 + last 4 chars, replace middle with "...".
 * Empty / short strings are returned as-is.
 */
export function maskAddress(addr: string | undefined | null): string {
  if (!addr) return '';
  const s = addr.trim();
  if (s.length <= 12) return s;
  return `${s.slice(0, 6)}...${s.slice(-4)}`;
}

function formatHuman(env: SuccessEnvelope): string {
  const lines: string[] = [];
  const header = `${env.command}${env.network ? ` (${env.network})` : ''}${env.scheme ? ` — ${env.scheme}` : ''}`;
  lines.push(`✓ ${header}`);
  if (env.result && typeof env.result === 'object') {
    for (const [k, v] of Object.entries(env.result as Record<string, unknown>)) {
      lines.push(`  ${k}: ${formatScalar(v)}`);
    }
  } else if (env.result !== undefined) {
    lines.push(`  ${formatScalar(env.result)}`);
  }
  return lines.join('\n');
}

function formatScalar(v: unknown): string {
  if (v === null) return 'null';
  if (v === undefined) return '';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
    return String(v);
  }
  return JSON.stringify(v);
}

/** Helper for command implementations: run a thunk and emit the result. */
export async function runCommand<T>(
  ctx: EnvelopeContext,
  mode: OutputMode,
  fn: () => Promise<T>,
): Promise<number> {
  try {
    const result = await fn();
    emit(buildSuccess(ctx, result), mode);
    return 0;
  } catch (err) {
    emit(buildFailure(ctx, err), mode);
    // Surface failures as non-zero exit so shell pipes can detect them.
    return isCliError(err) ? 1 : 2;
  }
}

// Helper used by tests and special callers that want to format without
// emitting (e.g. constructing nested results).
export type { SuccessEnvelope as _SuccessEnvelope };

void X402CliError; // referenced for type-only import keepalive

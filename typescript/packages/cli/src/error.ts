/**
 * Standardized error codes for the BankofAI x402 CLI.
 *
 * Every user-visible failure is normalized to one of these codes so Agent
 * consumers parsing `--json` can dispatch on `error.code` without string-match.
 *
 * Source of truth: specs/002-bankofai-cli/bankofai-cli.md § "标准错误码".
 */

export type ErrorCode =
  | 'CONFIG_NOT_FOUND'
  | 'PROFILE_NOT_FOUND'
  | 'UNSUPPORTED_NETWORK'
  | 'UNSUPPORTED_SCHEME'
  | 'TOKEN_NOT_FOUND'
  | 'INVALID_AMOUNT'
  | 'WALLET_NOT_AVAILABLE'
  | 'GASFREE_ACCOUNT_NOT_ACTIVE'
  | 'INSUFFICIENT_GASFREE_BALANCE'
  | 'FEE_QUOTE_NOT_FOUND'
  | 'VERIFY_FAILED'
  | 'SETTLE_FAILED'
  | 'FACILITATOR_UNAVAILABLE'
  | 'PAYMENT_CANCELLED'
  | 'RECEIPT_NOT_FOUND'
  | 'INVALID_INPUT'
  | 'IO_ERROR';

export class X402CliError extends Error {
  readonly code: ErrorCode;
  readonly hint?: string;

  constructor(code: ErrorCode, message: string, hint?: string) {
    super(message);
    this.name = 'X402CliError';
    this.code = code;
    this.hint = hint;
  }
}

export function isCliError(err: unknown): err is X402CliError {
  return err instanceof X402CliError;
}

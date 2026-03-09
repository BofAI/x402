/**
 * x402 custom error hierarchy
 */

/** Base error for all x402 errors */
export class X402Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'X402Error';
  }
}

/** Signature-related error */
export class SignatureError extends X402Error {
  constructor(message: string) {
    super(message);
    this.name = 'SignatureError';
  }
}

/** Signature creation failed */
export class SignatureCreationError extends SignatureError {
  constructor(message: string) {
    super(message);
    this.name = 'SignatureCreationError';
  }
}

/** Allowance-related error */
export class AllowanceError extends X402Error {
  constructor(message: string) {
    super(message);
    this.name = 'AllowanceError';
  }
}

/** Insufficient allowance */
export class InsufficientAllowanceError extends AllowanceError {
  constructor(message: string) {
    super(message);
    this.name = 'InsufficientAllowanceError';
  }
}

/** Configuration-related error */
export class ConfigurationError extends X402Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

/** Unsupported network */
export class UnsupportedNetworkError extends ConfigurationError {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedNetworkError';
  }
}

/** Validation-related error */
export class ValidationError extends X402Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/** Permit validation failed */
export class PermitValidationError extends ValidationError {
  reason: string;

  constructor(reason: string, message?: string) {
    super(message || reason);
    this.name = 'PermitValidationError';
    this.reason = reason;
  }
}

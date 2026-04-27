/**
 * Wallet detection (read-only).
 *
 * Read-only commands (config / doctor / balance) don't sign anything; they
 * only need the wallet's address. We derive it from the env-var private key
 * locally, so we don't pull in @bankofai/agent-wallet's full provider flow
 * for this. Signing commands (transfer / pay / serve) will use
 * `TronClientSigner.create()` from the SDK proper.
 *
 * Env vars (D1, D3 in decisions.md):
 *   TRON_PRIVATE_KEY  — required when wallet.network === 'tron'
 *   EVM_PRIVATE_KEY   — required when wallet.network === 'evm' (post-MVP)
 */

import { TronWeb } from 'tronweb';
import { X402CliError } from './error.js';

export interface WalletInfo {
  network: 'tron' | 'evm';
  /** Base58 (TRON) or 0x-prefixed hex (EVM). */
  address: string;
  /** 0x-prefixed hex form, useful for typed-data signing in EIP-712 / TIP-712 contexts. */
  evmHexAddress: string;
}

export function readPrivateKey(walletNetwork: 'tron' | 'evm'): string {
  const envName = walletNetwork === 'tron' ? 'TRON_PRIVATE_KEY' : 'EVM_PRIVATE_KEY';
  const raw = process.env[envName]?.trim();
  if (!raw) {
    throw new X402CliError(
      'WALLET_NOT_AVAILABLE',
      `${envName} is not set in the environment.`,
      `Export your ${walletNetwork === 'tron' ? 'TRON' : 'EVM'} private key (0x-prefixed hex) ` +
        `as ${envName}. Avoid inline shell-history exposure — use a sourced .env or stdin.`,
    );
  }
  return raw.startsWith('0x') ? raw : `0x${raw}`;
}

export function deriveWalletInfo(walletNetwork: 'tron' | 'evm'): WalletInfo {
  const privateKey = readPrivateKey(walletNetwork);
  if (walletNetwork === 'tron') {
    const hex = privateKey.startsWith('0x') ? privateKey.slice(2) : privateKey;
    if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
      throw new X402CliError(
        'WALLET_NOT_AVAILABLE',
        'TRON_PRIVATE_KEY must be a 32-byte (64-hex-character) value.',
      );
    }
    let base58: string;
    try {
      base58 = TronWeb.address.fromPrivateKey(hex) as string;
    } catch (err) {
      throw new X402CliError(
        'WALLET_NOT_AVAILABLE',
        `Failed to derive TRON address from TRON_PRIVATE_KEY: ${(err as Error).message}`,
      );
    }
    if (!base58 || typeof base58 !== 'string') {
      throw new X402CliError(
        'WALLET_NOT_AVAILABLE',
        'tronweb returned an invalid address; check that TRON_PRIVATE_KEY is correct.',
      );
    }
    const evmHex = '0x' + (TronWeb.address.toHex(base58) as string).replace(/^41/, '');
    return { network: 'tron', address: base58, evmHexAddress: evmHex.toLowerCase() };
  }
  // EVM: post-MVP. Stub for now; transfer/pay commands will fill this in.
  throw new X402CliError(
    'UNSUPPORTED_NETWORK',
    'EVM wallet derivation is not implemented in this CLI release.',
    'MVP scope is TRON GasFree. EVM support lands with the transfer/pay commands.',
  );
}

/**
 * Wallet detection (read-only).
 *
 * Read-only commands (config / doctor / balance) don't sign anything; they
 * only need the wallet's address. Signing commands also use the env-var key
 * directly by wrapping it in the SDK's TronClientSigner interface. This keeps
 * the CLI aligned with D1: no private keys in config files and no dependency
 * on an external agent-wallet profile for MVP.
 *
 * Env vars (D1, D3 in decisions.md):
 *   TRON_PRIVATE_KEY  — required when wallet.network === 'tron'
 *   EVM_PRIVATE_KEY   — required when wallet.network === 'evm'
 */

import { TronWeb } from 'tronweb';
import { privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';
import { EvmClientSigner, TronClientSigner, type AgentWallet } from '@bankofai/x402';
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
  const account = privateKeyToAccount(privateKey as Hex);
  return { network: 'evm', address: account.address, evmHexAddress: account.address.toLowerCase() };
}

export function createTronClientSignerFromEnv(): TronClientSigner {
  const wallet = createLocalTronWallet();
  const signer = new TronClientSigner(wallet);
  signer.setAddress(wallet.address);
  return signer;
}

export function createEvmClientSignerFromEnv(): EvmClientSigner {
  const wallet = createLocalEvmWallet();
  const signer = new EvmClientSigner(wallet);
  signer.setAddress(wallet.address);
  return signer;
}

export type WalletSource = 'agent-wallet' | 'env';

/**
 * Resolve a network's client signer per D1 (decisions.md): prefer agent-wallet
 * when source = "agent-wallet" and fall back to the env-key path on failure.
 * Pass source = "env" to skip agent-wallet entirely (CI / dev).
 */
export async function resolveTronClientSigner(
  source: WalletSource = 'agent-wallet',
): Promise<TronClientSigner> {
  if (source === 'env') return createTronClientSignerFromEnv();
  try {
    return await TronClientSigner.create();
  } catch (err) {
    process.stderr.write(
      `[x402-tools] agent-wallet TRON wallet unavailable (${(err as Error).message}); falling back to TRON_PRIVATE_KEY.\n`,
    );
    return createTronClientSignerFromEnv();
  }
}

export async function resolveEvmClientSigner(
  source: WalletSource = 'agent-wallet',
): Promise<EvmClientSigner> {
  if (source === 'env') return createEvmClientSignerFromEnv();
  try {
    return await EvmClientSigner.create();
  } catch (err) {
    process.stderr.write(
      `[x402-tools] agent-wallet EVM wallet unavailable (${(err as Error).message}); falling back to EVM_PRIVATE_KEY.\n`,
    );
    return createEvmClientSignerFromEnv();
  }
}

interface LocalTronWallet extends AgentWallet {
  address: string;
}

interface LocalEvmWallet extends AgentWallet {
  address: `0x${string}`;
}

function createLocalTronWallet(): LocalTronWallet {
  const privateKey = readPrivateKey('tron');
  const hex = privateKey.startsWith('0x') ? privateKey.slice(2) : privateKey;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new X402CliError(
      'WALLET_NOT_AVAILABLE',
      'TRON_PRIVATE_KEY must be a 32-byte (64-hex-character) value.',
    );
  }
  const address = TronWeb.address.fromPrivateKey(hex) as string;
  if (!address) {
    throw new X402CliError(
      'WALLET_NOT_AVAILABLE',
      'Failed to derive TRON address from TRON_PRIVATE_KEY.',
    );
  }
  const fullHost = process.env.TRON_NILE_RPC_URL || process.env.TRON_RPC_URL || 'https://nile.trongrid.io';
  const headers = process.env.TRON_GRID_API_KEY
    ? { 'TRON-PRO-API-KEY': process.env.TRON_GRID_API_KEY }
    : undefined;
  const tronWeb = new TronWeb({ fullHost, privateKey: hex, headers });

  return {
    address,
    async getAddress(): Promise<string> {
      return address;
    },
    async signMessage(msg: Uint8Array): Promise<string> {
      return tronWeb.trx.signMessageV2(Buffer.from(msg).toString('hex'), hex);
    },
    async signTypedData(data: Record<string, unknown>): Promise<string> {
      const typed = data as {
        domain: Record<string, unknown>;
        types: Record<string, unknown>;
        primaryType: string;
        message: Record<string, unknown>;
      };
      const types = { ...typed.types } as Record<string, unknown>;
      delete types.EIP712Domain;
      const trx = tronWeb.trx as unknown as {
        signTypedData?: (
          domain: Record<string, unknown>,
          types: Record<string, unknown>,
          message: Record<string, unknown>,
          privateKey: string,
        ) => Promise<string>;
        _signTypedData?: (
          domain: Record<string, unknown>,
          types: Record<string, unknown>,
          message: Record<string, unknown>,
          privateKey: string,
        ) => Promise<string>;
      };
      const signer = trx.signTypedData ?? trx._signTypedData;
      if (!signer) {
        throw new X402CliError(
          'WALLET_NOT_AVAILABLE',
          'Installed tronweb does not support TIP-712 signTypedData.',
        );
      }
      return signer.call(tronWeb.trx, typed.domain, types, typed.message, hex);
    },
    async signTransaction(payload: Record<string, unknown>): Promise<string> {
      const signed = await tronWeb.trx.sign(payload as never, hex);
      return JSON.stringify(signed);
    },
  };
}

function createLocalEvmWallet(): LocalEvmWallet {
  const privateKey = readPrivateKey('evm');
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    throw new X402CliError(
      'WALLET_NOT_AVAILABLE',
      'EVM_PRIVATE_KEY must be a 32-byte (64-hex-character) 0x-prefixed value.',
    );
  }
  const account = privateKeyToAccount(privateKey as Hex);
  return {
    address: account.address,
    async getAddress(): Promise<string> {
      return account.address;
    },
    async signMessage(msg: Uint8Array): Promise<string> {
      return account.signMessage({ message: { raw: msg } });
    },
    async signTypedData(data: Record<string, unknown>): Promise<string> {
      const typed = data as {
        domain: Record<string, unknown>;
        types: Record<string, unknown>;
        primaryType: string;
        message: Record<string, unknown>;
      };
      const types = { ...typed.types } as Record<string, unknown>;
      delete types.EIP712Domain;
      return (account as unknown as {
        signTypedData(input: Record<string, unknown>): Promise<string>;
      }).signTypedData({
        domain: typed.domain as never,
        types: types as never,
        primaryType: typed.primaryType as never,
        message: typed.message as never,
      });
    },
    async signTransaction(payload: Record<string, unknown>): Promise<string> {
      return account.signTransaction(payload as never);
    },
  };
}

/**
 * EvmPrivateKeyWallet — EVM wallet backed by a local private key (viem).
 */

import { privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';
import type { Wallet } from './types.js';

export class EvmPrivateKeyWallet implements Wallet {
  private account: ReturnType<typeof privateKeyToAccount>;
  private _address: string;

  constructor(privateKey: string) {
    const hexKey = (privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`) as Hex;
    this.account = privateKeyToAccount(hexKey);
    this._address = this.account.address;
  }

  getAddress(): string {
    return this._address;
  }

  async signMessage(message: Uint8Array): Promise<string> {
    return this.account.signMessage({
      message: { raw: message },
    });
  }

  async signTypedData(data: Record<string, unknown>): Promise<string> {
    const { domain, types, primaryType, message } = data as {
      domain: Record<string, unknown>;
      types: Record<string, Array<{ name: string; type: string }>>;
      primaryType: string;
      message: Record<string, unknown>;
    };

    // Remove EIP712Domain from types — viem adds it automatically
    const { EIP712Domain, ...messageTypes } = types;

    return this.account.signTypedData({
      domain: domain as any,
      types: messageTypes as any,
      primaryType,
      message: message as any,
    });
  }

  async signTransaction(tx: Record<string, unknown>): Promise<string> {
    return this.account.signTransaction(
      tx as Parameters<typeof this.account.signTransaction>[0],
    );
  }
}

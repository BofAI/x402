/**
 * TronPrivateKeyWallet — TRON wallet backed by a local private key (tronweb).
 */

import { TronWeb as TronWebClass } from 'tronweb';
import type { Wallet } from './types.js';
import type { TronWeb, TypedDataDomain, TypedDataField } from '../signers/types.js';

export class TronPrivateKeyWallet implements Wallet {
  private privateKey: string;
  private _address: string;
  private tronWeb: TronWeb;

  constructor(privateKey: string) {
    const cleanKey = privateKey.startsWith('0x') ? privateKey.slice(2) : privateKey;
    this.privateKey = cleanKey;

    // Derive address using a temporary TronWeb instance (pure crypto, no network needed)
    this.tronWeb = new TronWebClass({
      fullHost: 'https://nile.trongrid.io',
      privateKey: cleanKey,
    }) as unknown as TronWeb;
    this._address = this.tronWeb.address.fromPrivateKey(cleanKey);
  }

  getAddress(): string {
    return this._address;
  }

  async signMessage(message: Uint8Array): Promise<string> {
    const messageHex = Array.from(message)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    return this.tronWeb.trx.signMessageV2(messageHex, this.privateKey);
  }

  async signTypedData(data: Record<string, unknown>): Promise<string> {
    const { domain, types, message } = data as {
      domain: Record<string, unknown>;
      types: Record<string, Array<{ name: string; type: string }>>;
      message: Record<string, unknown>;
    };

    const typedDomain: TypedDataDomain = {
      name: domain.name as string,
      chainId: domain.chainId as number,
      verifyingContract: domain.verifyingContract as string,
    };

    // Remove EIP712Domain from types for TronWeb
    const { EIP712Domain, ...messageTypes } = types;

    const signFn = this.tronWeb.trx.signTypedData || this.tronWeb.trx._signTypedData;
    if (!signFn) {
      throw new Error('TronWeb does not support signTypedData. Please upgrade to TronWeb >= 5.0');
    }

    return signFn.call(
      this.tronWeb.trx,
      typedDomain,
      messageTypes as Record<string, TypedDataField[]>,
      message,
      this.privateKey,
    );
  }

  async signTransaction(tx: Record<string, unknown>): Promise<string> {
    const signedTx = await this.tronWeb.trx.sign(tx, this.privateKey);
    const sig: string = (signedTx as any).signature?.[0] ?? '';
    return sig.startsWith('0x') ? sig.slice(2) : sig;
  }
}

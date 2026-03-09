/**
 * TronClientSigner - TRON client signer for x402 protocol
 *
 * Uses TronWeb's signTypedData (TIP-712) for EIP-712 compatible signing.
 */

import type { ClientSigner } from '../index.js';
import {
  getPaymentPermitAddress,
  toEvmHex,
  type Hex,
  SignatureCreationError,
  InsufficientAllowanceError,
  UnsupportedNetworkError,
  TRON_RPC_URLS,
} from '../index.js';
import { TronWeb as TronWebClass } from 'tronweb';
import type { TronWeb, TypedDataDomain, TypedDataField } from './types.js';
import type { Wallet } from '../wallet/types.js';
import { TronPrivateKeyWallet } from '../wallet/tronPrivateKeyWallet.js';

/** ERC20 function selectors */
const ERC20_ALLOWANCE_SELECTOR = 'allowance(address,address)';
const ERC20_APPROVE_SELECTOR = 'approve(address,uint256)';

/**
 * TRON client signer implementation using TronWeb's signTypedData
 */
export class TronClientSigner implements ClientSigner {
  private wallet: Wallet;
  private address: string; // Base58 format
  private tronWebInstances: Map<string, TronWeb> = new Map();

  constructor(wallet: Wallet) {
    this.wallet = wallet;
    this.address = wallet.getAddress();
  }

  /** Create signer from a Wallet instance. */
  static fromWallet(wallet: Wallet): TronClientSigner {
    return new TronClientSigner(wallet);
  }

  /** Create signer from private key (convenience factory). */
  static fromPrivateKey(privateKey: string): TronClientSigner {
    return new TronClientSigner(new TronPrivateKeyWallet(privateKey));
  }

  /**
   * Get or create a TronWeb instance for the given network.
   */
  private getTronWeb(network?: string): TronWeb {
    const host = network ? TRON_RPC_URLS[network] : undefined;
    const key = host ?? '__default__';
    let tw = this.tronWebInstances.get(key);
    if (!tw) {
      if (!host) {
        throw new UnsupportedNetworkError(`No RPC URL configured for network: ${network}`);
      }
      tw = this.createTronWeb(host);
      this.tronWebInstances.set(key, tw);
    }
    return tw;
  }

  private getDefaultTronWeb(): TronWeb {
    let tw = this.tronWebInstances.get('__default__');
    if (!tw) {
      tw = this.createTronWeb('https://nile.trongrid.io');
      this.tronWebInstances.set('__default__', tw);
    }
    return tw;
  }

  private createTronWeb(fullHost: string): TronWeb {
    const apiKey = typeof process !== 'undefined' ? process.env?.TRON_GRID_API_KEY : undefined;
    const headers = apiKey ? { 'TRON-PRO-API-KEY': apiKey } : undefined;
    // TronWeb needs a private key for initialization, use a dummy key for read-only operations
    const dummyKey = '0000000000000000000000000000000000000000000000000000000000000001';
    return new TronWebClass({ fullHost, privateKey: dummyKey, headers }) as unknown as TronWeb;
  }

  getAddress(): string {
    return this.address;
  }

  getEvmAddress(): Hex {
    return toEvmHex(this.address);
  }

  async signMessage(message: Uint8Array): Promise<string> {
    return this.wallet.signMessage(message);
  }

  /**
   * Sign EIP-712 typed data using Wallet abstraction
   */
  async signTypedData(
    domain: Record<string, unknown>,
    types: Record<string, unknown>,
    message: Record<string, unknown>
  ): Promise<string> {
    const fullData = {
      types: { EIP712Domain: [], ...types },
      domain,
      primaryType: types.PaymentPermitDetails
        ? 'PaymentPermitDetails'
        : Object.keys(types).pop(),
      message,
    };

    return this.wallet.signTypedData(fullData);
  }

  async checkBalance(token: string, network: string): Promise<bigint> {
    try {
      const ownerHex = toEvmHex(this.address);

      const tw = this.getTronWeb(network);
      const result = await tw.transactionBuilder.triggerConstantContract(
        token,
        'balanceOf(address)',
        {},
        [{ type: 'address', value: ownerHex }],
        this.address
      );

      if (result.result?.result && result.constant_result?.length) {
        return BigInt('0x' + result.constant_result[0]);
      }
    } catch (error) {
      console.error(`[TronClientSigner] Failed to check balance: ${error}`);
    }

    return BigInt(0);
  }

  async checkAllowance(token: string, _amount: bigint, network: string): Promise<bigint> {
    const spender = getPaymentPermitAddress(network);
    
    try {
      const ownerHex = toEvmHex(this.address);
      const spenderHex = toEvmHex(spender);

      const tw = this.getTronWeb(network);
      const result = await tw.transactionBuilder.triggerConstantContract(
        token,
        ERC20_ALLOWANCE_SELECTOR,
        {},
        [
          { type: 'address', value: ownerHex },
          { type: 'address', value: spenderHex },
        ],
        this.address
      );

      if (result.result?.result && result.constant_result?.length) {
        return BigInt('0x' + result.constant_result[0]);
      }
    } catch (error) {
      console.error(`[TronClientSigner] Failed to check allowance: ${error}`);
    }

    return BigInt(0);
  }

  async ensureAllowance(
    token: string,
    amount: bigint,
    network: string,
    mode: 'auto' | 'interactive' | 'skip' = 'auto'
  ): Promise<boolean> {
    if (mode === 'skip') {
      return true;
    }

    const currentAllowance = await this.checkAllowance(token, amount, network);
    if (currentAllowance >= amount) {
      console.log(`[ALLOWANCE] Sufficient allowance: ${currentAllowance} >= ${amount}`);
      return true;
    }

    if (mode === 'interactive') {
      throw new InsufficientAllowanceError('Interactive approval not implemented - use wallet UI');
    }

    // Auto mode: send approve transaction
    console.log(`[ALLOWANCE] Insufficient allowance: ${currentAllowance} < ${amount}, sending approve...`);
    
    const spender = getPaymentPermitAddress(network);
    const spenderHex = toEvmHex(spender);
    
    // Use maxUint160 (2^160 - 1) to avoid repeated approvals
    const maxUint160 = (BigInt(2) ** BigInt(160)) - BigInt(1);
    
    try {
      // Build approve transaction
      const tw = this.getTronWeb(network);
      const tx = await tw.transactionBuilder.triggerSmartContract(
        token,
        ERC20_APPROVE_SELECTOR,
        {
          feeLimit: 100_000_000,
          callValue: 0,
        },
        [
          { type: 'address', value: spenderHex },
          { type: 'uint256', value: maxUint160.toString() },
        ],
        this.address
      );

      if (!tx.result?.result) {
        throw new InsufficientAllowanceError('Failed to build approve transaction');
      }

      // Sign transaction via wallet (returns signature hex without 0x)
      const sigHex = await this.wallet.signTransaction(tx.transaction as Record<string, unknown>);
      const signedTx = { ...(tx.transaction as Record<string, unknown>), signature: [sigHex] };

      // Broadcast transaction
      const broadcast = await tw.trx.sendRawTransaction(signedTx);
      
      if (!broadcast.result) {
        throw new InsufficientAllowanceError(
          `Failed to broadcast approve transaction: ${JSON.stringify(broadcast)}`,
        );
      }

      console.log(`[ALLOWANCE] Approve transaction sent: ${broadcast.txid}`);
      
      // Wait for confirmation (poll for ~30 seconds)
      const txid = broadcast.txid;
      for (let i = 0; i < 10; i++) {
        await new Promise(resolve => setTimeout(resolve, 3000));
        try {
          const info = await tw.trx.getTransactionInfo(txid);
          if (info && info.blockNumber) {
            const success = info.receipt?.result === 'SUCCESS';
            console.log(`[ALLOWANCE] Approve confirmed: ${success ? 'SUCCESS' : 'FAILED'}`);
            return success;
          }
        } catch {
          // Not confirmed yet, continue polling
        }
      }

      console.log('[ALLOWANCE] Approve transaction not confirmed within timeout, assuming success');
      return true;
    } catch (error) {
      if (error instanceof InsufficientAllowanceError) throw error;
      throw new InsufficientAllowanceError(
        `Approve transaction failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

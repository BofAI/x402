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

/** ERC20 function selectors */
const ERC20_ALLOWANCE_SELECTOR = 'allowance(address,address)';
const ERC20_APPROVE_SELECTOR = 'approve(address,uint256)';

/**
 * TRON client signer implementation using TronWeb's signTypedData
 */
export class TronClientSigner implements ClientSigner {
  private privateKey: string;
  private address: string; // Base58 format
  private tronWebInstances: Map<string, TronWeb> = new Map();

  constructor(privateKey: string) {
    const cleanKey = privateKey.startsWith('0x') ? privateKey.slice(2) : privateKey;
    this.privateKey = cleanKey;
    // Derive address using a temporary TronWeb instance (pure crypto, no network needed)
    const tw = this.createTronWeb('https://nile.trongrid.io');
    this.address = tw.address.fromPrivateKey(cleanKey);
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
    return new TronWebClass({ fullHost, privateKey: this.privateKey, headers }) as unknown as TronWeb;
  }

  getAddress(): string {
    return this.address;
  }

  getEvmAddress(): Hex {
    return toEvmHex(this.address);
  }

  async signMessage(message: Uint8Array): Promise<string> {
    const messageHex = Array.from(message)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    // Signing is pure crypto — any TronWeb instance works
    const tw = this.getDefaultTronWeb();
    return tw.trx.signMessageV2(messageHex, this.privateKey);
  }

  /**
   * Sign EIP-712 typed data using TronWeb's signTypedData (TIP-712)
   */
  async signTypedData(
    domain: Record<string, unknown>,
    types: Record<string, unknown>,
    message: Record<string, unknown>,
    _primaryType: string
  ): Promise<string> {
    // Signing is pure crypto — any TronWeb instance works
    const tw = this.getDefaultTronWeb();
    // Use signTypedData (stable API) or fall back to _signTypedData (legacy)
    const signFn = tw.trx.signTypedData || tw.trx._signTypedData;
    if (!signFn) {
      throw new SignatureCreationError('TronWeb does not support signTypedData. Please upgrade to TronWeb >= 5.0');
    }

    // Pure Passthrough: Let TronWeb handle the domain and types as-is.
    return signFn.call(
      tw.trx,
      domain as any,
      types as any,
      message,
      this.privateKey
    );
  }

  async checkBalance(token: string, network: string, address?: string): Promise<bigint> {
    try {
      const targetAddress = address || this.address;
      const ownerHex = toEvmHex(targetAddress);

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

      // Sign transaction
      const signedTx = await tw.trx.sign(tx.transaction, this.privateKey);

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

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

/**
 * Minimal wallet interface expected by signers.
 * Compatible with agent-wallet's BaseWallet + Eip712Capable.
 */
export interface AgentWallet {
  getAddress(): Promise<string>;
  signMessage(msg: Uint8Array): Promise<string>;
  signTypedData(data: Record<string, unknown>): Promise<string>;
  signTransaction(payload: Record<string, unknown>): Promise<string>;
}

/** ERC20 function selectors */
const ERC20_ALLOWANCE_SELECTOR = 'allowance(address,address)';
const ERC20_APPROVE_SELECTOR = 'approve(address,uint256)';

/**
 * TRON client signer implementation.
 *
 * Accepts any wallet conforming to the AgentWallet interface.
 * The signer is agnostic about how the wallet was created
 * (private key, hosted, etc.).
 */
export class TronClientSigner implements ClientSigner {
  private wallet: AgentWallet;
  private address: string; // Base58 format
  private tronWebInstances: Map<string, TronWeb> = new Map();

  /**
   * Create signer from a wallet and its pre-resolved address.
   *
   * Prefer the async factory `TronClientSigner.create()` which resolves
   * the address automatically.
   */
  constructor(wallet: AgentWallet, address: string) {
    this.wallet = wallet;
    this.address = address;
  }

  /** Async factory: resolve address from wallet and create signer. */
  static async create(wallet: AgentWallet): Promise<TronClientSigner> {
    const address = await wallet.getAddress();
    return new TronClientSigner(wallet, address);
  }

  /**
   * Extract signature hex from agent-wallet's signTransaction result.
   * agent-wallet's TronWallet returns a JSON string with the full signed tx.
   */
  private extractTronSignature(result: string): string {
    if (typeof result === 'string' && result.trim().startsWith('{')) {
      const signed = JSON.parse(result);
      const sigs = signed.signature;
      if (!Array.isArray(sigs) || sigs.length === 0) {
        throw new Error('Wallet returned signed tx without signature');
      }
      return sigs[0];
    }
    return result;
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
    message: Record<string, unknown>,
    _primaryType: string
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

      // Sign transaction via wallet and extract signature
      const rawResult = await this.wallet.signTransaction(tx.transaction as Record<string, unknown>);
      const sigHex = this.extractTronSignature(rawResult);
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

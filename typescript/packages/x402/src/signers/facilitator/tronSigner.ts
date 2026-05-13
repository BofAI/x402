/**
 * TronFacilitatorSigner — TRON facilitator signer (TIP-712 verify + contract write).
 *
 * Mirrors Python `bankofai.x402.signers.facilitator.tron_signer.TronFacilitatorSigner`.
 *
 * Uses:
 * - `tronweb` v6 for transaction building, signing wrap, broadcasting, receipt polling
 * - `viem` for cross-chain EIP-712 signature recovery (TRON TIP-712 is structurally
 *   identical to EIP-712 once addresses are normalized to 0x hex)
 * - `@bankofai/agent-wallet` for the signing wallet abstraction
 */

import { recoverTypedDataAddress } from 'viem';
import type { TypedDataDomain as ViemTypedDataDomain } from 'viem';
import { resolveWalletProvider } from '@bankofai/agent-wallet';
import { TronWeb as TronWebClass } from 'tronweb';

import {
  FacilitatorSigner,
  type TypedDataDomain,
  type TypedDataTypes,
  type TransactionReceipt,
} from './base.js';
import type { TronWeb } from '../types.js';
import { toEvmHex } from '../../address.js';
import { getTronRpcUrl } from '../../config.js';
import type { AgentWallet } from '../signer.js';

/**
 * Buffer-like check that works in both Node and bundled environments without
 * requiring `Buffer` to be in the global scope.
 */
function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) {
    throw new Error(`Invalid hex string length: ${clean.length}`);
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/**
 * TRON facilitator signer.
 *
 * The wallet is responsible for signing transactions; the signer wraps tronweb
 * for building and broadcasting them. For verify, we use viem's typed-data
 * recovery directly — it does not need the wallet.
 */
export class TronFacilitatorSigner extends FacilitatorSigner {
  private wallet: AgentWallet;
  private address: string = ''; // Base58 format
  private tronWebInstances: Map<string, TronWeb> = new Map();
  /**
   * Raw private key (hex, no `0x`) read from `TRON_FACILITATOR_PRIVATE_KEY`
   * or `TRON_PRIVATE_KEY`. When present, signs transactions directly via
   * `tronweb.trx.sign(tx, privateKey)` — mirrors Python's tronpy direct-sign
   * path that bypasses agent-wallet (because agent-wallet's TRON sign_transaction
   * round-trip can drift the tx's raw_data and invalidate the txID/signature).
   */
  private privateKey: string | null = null;
  /**
   * TRON permission id used when building transactions.
   * Default `2` = active permission (required for multi-sig facilitator
   * accounts with owner threshold > 1). Override via `TRON_PERMISSION_ID` env.
   */
  private permissionId: number = 2;

  constructor(wallet: AgentWallet) {
    super();
    this.wallet = wallet;
    if (typeof process !== 'undefined') {
      const pk =
        process.env?.TRON_FACILITATOR_PRIVATE_KEY ??
        process.env?.TRON_PRIVATE_KEY ??
        null;
      if (pk) {
        this.privateKey = pk.startsWith('0x') ? pk.slice(2) : pk;
      }
      const permId = process.env?.TRON_PERMISSION_ID;
      if (permId) {
        const parsed = parseInt(permId, 10);
        if (!isNaN(parsed)) this.permissionId = parsed;
      }
    }
  }

  /** Async factory: resolve active agent wallet and create signer. */
  static async create(): Promise<TronFacilitatorSigner> {
    const provider = resolveWalletProvider({ network: 'tron' });
    const wallet = await provider.getActiveWallet();
    const signer = new TronFacilitatorSigner(wallet as unknown as AgentWallet);
    signer.setAddress(await wallet.getAddress());
    return signer;
  }

  setAddress(address: string): void {
    this.address = address;
  }

  getAddress(): string {
    if (!this.address) {
      throw new Error('TronFacilitatorSigner address has not been initialized');
    }
    return this.address;
  }

  /**
   * Extract signature hex from agent-wallet's signTransaction result.
   * agent-wallet TronWallet returns a JSON string with the full signed tx.
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

  /** Get or create a TronWeb instance for the given network. */
  private getTronWeb(network: string): TronWeb {
    const host = getTronRpcUrl(network);
    if (!host) {
      throw new Error(`No TRON RPC URL configured for network: ${network}`);
    }
    let tw = this.tronWebInstances.get(host);
    if (!tw) {
      const apiKey =
        typeof process !== 'undefined' ? process.env?.TRON_GRID_API_KEY : undefined;
      const headers = apiKey ? { 'TRON-PRO-API-KEY': apiKey } : undefined;
      // Dummy private key — facilitator signing routes via wallet.signTransaction,
      // not via TronWeb's defaultPrivateKey.
      const dummyKey =
        '0000000000000000000000000000000000000000000000000000000000000001';
      tw = new TronWebClass({
        fullHost: host,
        privateKey: dummyKey,
        headers,
      }) as unknown as TronWeb;
      this.tronWebInstances.set(host, tw);
    }
    return tw;
  }

  /**
   * Verify EIP-712 / TIP-712 signature.
   *
   * Strategy: convert all TRON Base58 addresses in domain.verifyingContract
   * and the message to 0x EVM hex, then use viem's `recoverTypedDataAddress`
   * to recover the signer. Compare against the expected address (also
   * converted to hex).
   *
   * Domain types are NOT included in the `types` arg here — viem injects
   * `EIP712Domain` automatically.
   */
  async verifyTypedData(
    address: string,
    domain: TypedDataDomain,
    types: TypedDataTypes,
    message: Record<string, unknown>,
    signature: string,
    primaryType: string,
  ): Promise<boolean> {
    try {
      // viem expects hex domain and hex addresses; convert anything Base58.
      const viemDomain: ViemTypedDataDomain = {
        name: domain.name,
        version: domain.version,
        chainId: domain.chainId,
        verifyingContract: domain.verifyingContract
          ? (toEvmHex(domain.verifyingContract) as `0x${string}`)
          : undefined,
        ...(domain.salt ? { salt: domain.salt as `0x${string}` } : {}),
      };

      // Strip an `EIP712Domain` entry if a caller mistakenly added it; viem
      // injects this from the domain object.
      const typesNoDomain: TypedDataTypes = { ...types };
      delete (typesNoDomain as Record<string, unknown>)['EIP712Domain'];

      const sigBytes = signature.startsWith('0x')
        ? (signature as `0x${string}`)
        : (`0x${signature}` as `0x${string}`);

      const recovered = await recoverTypedDataAddress({
        domain: viemDomain,
        types: typesNoDomain as Record<string, ReadonlyArray<{ name: string; type: string }>>,
        primaryType,
        message,
        signature: sigBytes,
      });

      const expectedHex = toEvmHex(address).toLowerCase();
      return recovered.toLowerCase() === expectedHex;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[TronFacilitatorSigner] verifyTypedData failed:', err);
      return false;
    }
  }

  /**
   * Write contract on TRON: build via tronweb's `triggerSmartContract`, sign
   * via the wallet, broadcast.
   *
   * The function selector must match the on-chain ABI exactly, including
   * tuple bracket types. Example for PaymentPermit:
   *
   *   permitTransferFrom(((uint8,bytes16,uint256,uint256,uint256),
   *                       address,address,(address,uint256,address),(address,uint256)),
   *                      address,bytes)
   *
   * @param contractAddress Base58 (T...) or hex (41...) contract address.
   * @param _abi Unused for TRON (we use function selector directly); kept for interface parity.
   * @param method Method signature string with full type bracket layout (see note above).
   * @param args Parameter array shaped per tronweb's `triggerSmartContract` schema:
   *             `[{ type: 'address', value: '0x...' }, { type: 'tuple(...)', value: [...] }, ...]`.
   */
  async writeContract(
    contractAddress: string,
    _abi: string | unknown[],
    method: string,
    args: unknown[],
    network: string,
  ): Promise<string | null> {
    try {
      const tw = this.getTronWeb(network);

      const tx = await tw.transactionBuilder.triggerSmartContract(
        contractAddress,
        method,
        {
          feeLimit: 1_000_000_000, // 1000 TRX cap
          callValue: 0,
          // Active permission (id=2) required for multi-sig facilitator
          // accounts whose owner threshold is > 1.
          permissionId: this.permissionId,
        },
        args,
        this.getAddress(),
      );

      if (!tx.result?.result) {
        // eslint-disable-next-line no-console
        console.error(
          `[TronFacilitatorSigner] triggerSmartContract failed: ${JSON.stringify(tx)}`,
        );
        return null;
      }

      // Sign: prefer direct private-key signing via tronweb (matches Python's
      // tronpy direct-sign path). agent-wallet's TRON signTransaction can
      // round-trip the raw_data and produce an invalid signature.
      let signedTx: unknown;
      if (this.privateKey) {
        signedTx = await (tw.trx as unknown as {
          sign: (txObj: unknown, pk: string) => Promise<unknown>;
        }).sign(tx.transaction, this.privateKey);
      } else {
        const rawResult = await this.wallet.signTransaction(
          tx.transaction as Record<string, unknown>,
        );
        const sigHex = this.extractTronSignature(rawResult);
        signedTx = {
          ...(tx.transaction as Record<string, unknown>),
          signature: [sigHex],
        };
      }

      // Broadcast
      const broadcast = await tw.trx.sendRawTransaction(signedTx);
      if (!broadcast.result) {
        // eslint-disable-next-line no-console
        console.error(
          `[TronFacilitatorSigner] sendRawTransaction failed: ${JSON.stringify(broadcast)}`,
        );
        return null;
      }
      return broadcast.txid;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[TronFacilitatorSigner] writeContract error:', err);
      return null;
    }
  }

  /**
   * Check TRC20 balance via `triggerConstantContract` (read-only call).
   */
  async checkBalance(
    token: string,
    network: string,
    address?: string,
  ): Promise<bigint> {
    try {
      const targetAddress = address ?? this.getAddress();
      const ownerHex = toEvmHex(targetAddress);

      const tw = this.getTronWeb(network);
      const result = await tw.transactionBuilder.triggerConstantContract(
        token,
        'balanceOf(address)',
        {},
        [{ type: 'address', value: ownerHex }],
        this.getAddress(),
      );

      if (result.result?.result && result.constant_result?.length) {
        return BigInt('0x' + result.constant_result[0]);
      }
      // Suppress unused vars from helper imports
      void hexToBytes;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[TronFacilitatorSigner] checkBalance failed for ${token}:`, err);
    }
    return BigInt(0);
  }

  /**
   * Poll tronpy `getTransactionInfo` until the tx has a blockNumber.
   *
   * Returns `{status: 'confirmed' | 'failed'}` based on `receipt.result`.
   */
  async waitForTransactionReceipt(
    txHash: string,
    network: string,
    timeoutMs: number = 120_000,
  ): Promise<TransactionReceipt> {
    const tw = this.getTronWeb(network);
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      try {
        const info = await tw.trx.getTransactionInfo(txHash);
        if (info && info.blockNumber) {
          const success = info.receipt?.result === 'SUCCESS';
          return {
            hash: txHash,
            blockNumber: String(info.blockNumber),
            status: success ? 'confirmed' : 'failed',
          };
        }
      } catch {
        // Not yet propagated to the queried node — keep polling.
      }
      await new Promise((resolve) => setTimeout(resolve, 3_000));
    }

    throw new Error(
      `Transaction ${txHash} not confirmed within ${Math.round(timeoutMs / 1000)}s`,
    );
  }
}

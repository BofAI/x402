/**
 * EvmFacilitatorSigner — EVM facilitator signer (EIP-712 verify + contract write).
 *
 * Mirrors Python `bankofai.x402.signers.facilitator.evm_signer.EvmFacilitatorSigner`.
 *
 * Uses `viem` for everything:
 * - `recoverTypedDataAddress` for verify
 * - `PublicClient.simulateContract` + `wallet.signTransaction` + `sendRawTransaction` for write
 * - `PublicClient.waitForTransactionReceipt` for receipt polling
 */

import {
  createPublicClient,
  encodeFunctionData,
  http,
  recoverTypedDataAddress,
} from 'viem';
import type {
  Abi,
  Hex,
  PublicClient,
  TypedDataDomain as ViemTypedDataDomain,
} from 'viem';
import { resolveWalletProvider } from '@bankofai/agent-wallet';

import {
  FacilitatorSigner,
  type TypedDataDomain,
  type TypedDataTypes,
  type TransactionReceipt,
} from './base.js';
import { ERC20_ABI } from '../../abi.js';
import { getChainId, resolveRpcUrl } from '../../config.js';
import type { AgentWallet } from '../signer.js';

export class EvmFacilitatorSigner extends FacilitatorSigner {
  private wallet: AgentWallet;
  private address: Hex = '0x0000000000000000000000000000000000000000';
  private clients: Map<number, PublicClient> = new Map();

  constructor(wallet: AgentWallet) {
    super();
    this.wallet = wallet;
  }

  static async create(): Promise<EvmFacilitatorSigner> {
    const provider = resolveWalletProvider({ network: 'eip155' });
    const wallet = await provider.getActiveWallet();
    const signer = new EvmFacilitatorSigner(wallet as unknown as AgentWallet);
    signer.setAddress((await wallet.getAddress()) as Hex);
    return signer;
  }

  setAddress(address: Hex): void {
    this.address = address;
  }

  getAddress(): string {
    return this.address;
  }

  private getPublicClient(network: string): PublicClient {
    const chainId = getChainId(network);
    let client = this.clients.get(chainId);
    if (!client) {
      const rpcUrl = resolveRpcUrl(network);
      if (!rpcUrl) {
        throw new Error(`No RPC URL configured for ${network}`);
      }
      client = createPublicClient({ transport: http(rpcUrl) });
      this.clients.set(chainId, client);
    }
    return client;
  }

  async verifyTypedData(
    address: string,
    domain: TypedDataDomain,
    types: TypedDataTypes,
    message: Record<string, unknown>,
    signature: string,
    primaryType: string,
  ): Promise<boolean> {
    try {
      const viemDomain: ViemTypedDataDomain = {
        name: domain.name,
        version: domain.version,
        chainId: domain.chainId,
        verifyingContract: domain.verifyingContract as Hex | undefined,
        ...(domain.salt ? { salt: domain.salt as `0x${string}` } : {}),
      };
      const typesNoDomain: TypedDataTypes = { ...types };
      delete (typesNoDomain as Record<string, unknown>)['EIP712Domain'];

      const sigBytes = signature.startsWith('0x')
        ? (signature as Hex)
        : (`0x${signature}` as Hex);

      const recovered = await recoverTypedDataAddress({
        domain: viemDomain,
        types: typesNoDomain as Record<
          string,
          ReadonlyArray<{ name: string; type: string }>
        >,
        primaryType,
        message,
        signature: sigBytes,
      });
      return recovered.toLowerCase() === address.toLowerCase();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[EvmFacilitatorSigner] verifyTypedData failed:', err);
      return false;
    }
  }

  async writeContract(
    contractAddress: string,
    abi: string | unknown[],
    method: string,
    args: unknown[],
    network: string,
  ): Promise<string | null> {
    try {
      const client = this.getPublicClient(network);
      const chainId = getChainId(network);

      const abiArray = (typeof abi === 'string' ? JSON.parse(abi) : abi) as Abi;

      const data = encodeFunctionData({
        abi: abiArray,
        functionName: method,
        args,
      });

      const nonce = await client.getTransactionCount({ address: this.address });
      const gasPrice = await client.getGasPrice();
      const gas = await client.estimateGas({
        account: this.address,
        to: contractAddress as Hex,
        data,
      });

      const tx = {
        from: this.address,
        to: contractAddress,
        data,
        nonce,
        gas: Number(gas),
        gasPrice: Number(gasPrice),
        chainId,
      };

      const signedTxHex = await this.wallet.signTransaction(tx);
      const hash = await client.sendRawTransaction({
        serializedTransaction: `0x${signedTxHex.replace(/^0x/, '')}` as Hex,
      });
      return hash;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[EvmFacilitatorSigner] writeContract failed:', err);
      return null;
    }
  }

  async checkBalance(
    token: string,
    network: string,
    address?: string,
  ): Promise<bigint> {
    try {
      const client = this.getPublicClient(network);
      const target = (address ?? this.address) as Hex;
      const balance = await client.readContract({
        address: token as Hex,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [target],
      });
      return BigInt(balance as bigint);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[EvmFacilitatorSigner] checkBalance failed for ${token}:`, err);
      return BigInt(0);
    }
  }

  async waitForTransactionReceipt(
    txHash: string,
    network: string,
    timeoutMs: number = 120_000,
  ): Promise<TransactionReceipt> {
    const client = this.getPublicClient(network);
    const receipt = await client.waitForTransactionReceipt({
      hash: txHash as Hex,
      timeout: timeoutMs,
    });
    return {
      hash: txHash,
      blockNumber: String(receipt.blockNumber),
      status: receipt.status === 'success' ? 'confirmed' : 'failed',
    };
  }
}

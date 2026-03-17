/**
 * EvmClientSigner - EVM client signer for x402 protocol
 */

import {
  createPublicClient,
  http,
  type PublicClient,
  type Hex,
  parseAbi,
  encodeFunctionData,
  type Chain,
} from 'viem';
import { mainnet, sepolia, bsc, bscTestnet } from 'viem/chains';
import type { ClientSigner } from '../client/x402Client.js';
import {
  getPaymentPermitAddress,
  resolveRpcUrl,
  InsufficientAllowanceError,
  UnsupportedNetworkError,
} from '../index.js';

import type { AgentWallet } from './signer.js';

const ERC20_ABI = parseAbi([
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
]);

/**
 * EVM client signer implementation.
 *
 * Accepts any wallet conforming to the AgentWallet interface.
 * The signer is agnostic about how the wallet was created
 * (private key, hosted, etc.).
 */
export class EvmClientSigner implements ClientSigner {
  private wallet: AgentWallet;
  private _address: string;
  private publicClients: Map<number, PublicClient> = new Map();

  /**
   * Create signer from a wallet and its pre-resolved address.
   *
   * Prefer the async factory `EvmClientSigner.create()` which resolves
   * the address automatically.
   */
  constructor(wallet: AgentWallet, address: string) {
    this.wallet = wallet;
    this._address = address;
  }

  /** Async factory: resolve address from wallet and create signer. */
  static async create(wallet: AgentWallet): Promise<EvmClientSigner> {
    const address = await wallet.getAddress();
    return new EvmClientSigner(wallet, address);
  }

  getAddress(): string {
    return this._address;
  }

  getEvmAddress(): Hex {
    return this._address as Hex;
  }

  async signMessage(message: Uint8Array): Promise<string> {
    return this.wallet.signMessage(message);
  }

  async signTypedData(
    domain: Record<string, unknown>,
    types: Record<string, unknown>,
    message: Record<string, unknown>,
    primaryType: string
  ): Promise<string> {
    const fullData = {
      types: { EIP712Domain: [], ...types },
      domain,
      primaryType,
      message,
    };

    return this.wallet.signTypedData(fullData);
  }

  async checkBalance(token: string, network: string, address?: string): Promise<bigint> {
    const chainId = this.parseNetworkToChainId(network);
    const client = this.getPublicClient(chainId, network);
    try {
      return await client.readContract({
        address: token as Hex,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [(address ?? this._address) as Hex],
      });
    } catch (error) {
      console.error(
        `[EvmClientSigner] checkBalance failed for ${token} on ${network}:`,
        error,
      );
      return 0n;
    }
  }

  async checkAllowance(
    token: string,
    _amount: bigint,
    network: string,
  ): Promise<bigint> {
    const chainId = this.parseNetworkToChainId(network);
    const client = this.getPublicClient(chainId, network);
    const spender = getPaymentPermitAddress(network) as Hex;

    try {
      return await client.readContract({
        address: token as Hex,
        abi: ERC20_ABI,
        functionName: 'allowance',
        args: [this._address as Hex, spender],
      });
    } catch (error) {
      console.error(
        `[EvmClientSigner] checkAllowance failed for ${token} on ${network}:`,
        error,
      );
      return 0n;
    }
  }

  async ensureAllowance(
    token: string,
    amount: bigint,
    network: string,
    mode: 'auto' | 'interactive' | 'skip' = 'auto',
  ): Promise<boolean> {
    if (mode === 'skip') return true;

    const currentAllowance = await this.checkAllowance(token, amount, network);
    if (currentAllowance >= amount) return true;

    if (mode === 'interactive') {
      throw new InsufficientAllowanceError('Interactive approval required');
    }

    const chainId = this.parseNetworkToChainId(network);
    const client = this.getPublicClient(chainId, network);
    const spender = getPaymentPermitAddress(network) as Hex;

    try {
      // Build approve calldata
      const data = encodeFunctionData({
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [spender, BigInt(2) ** BigInt(256) - BigInt(1)],
      });

      // Prepare transaction via public client
      const nonce = await client.getTransactionCount({ address: this._address as Hex });
      const gasPrice = await client.getGasPrice();
      const gas = await client.estimateGas({
        account: this._address as Hex,
        to: token as Hex,
        data,
      });

      const tx = {
        from: this._address,
        to: token,
        data,
        nonce,
        gas: Number(gas),
        gasPrice: Number(gasPrice),
        chainId,
      };

      // Sign via wallet and broadcast
      const signedTxHex = await this.wallet.signTransaction(tx);
      const hash = await client.sendRawTransaction({
        serializedTransaction: `0x${signedTxHex.replace(/^0x/, '')}` as Hex,
      });

      const receipt = await client.waitForTransactionReceipt({ hash });

      const success = receipt.status === 'success';
      if (success) {
        console.info(
          `[EvmClientSigner] ERC20 approval confirmed for ${token}, tx: ${hash}`,
        );
      }
      return success;
    } catch (error) {
      console.error(
        `[EvmClientSigner] ERC20 approval failed for ${token}:`,
        error,
      );
      throw new InsufficientAllowanceError(
        `ERC20 approval transaction failed for ${token}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private getPublicClient(chainId: number, network: string): PublicClient {
    let client = this.publicClients.get(chainId);
    if (!client) {
      const rpcUrl = resolveRpcUrl(network);
      client = createPublicClient({
        chain: this.getChain(chainId),
        transport: http(rpcUrl),
      });
      this.publicClients.set(chainId, client);
    }
    return client;
  }

  private getChain(chainId: number): Chain {
    const chains: Record<number, Chain> = {
      1: mainnet,
      11155111: sepolia,
      56: bsc,
      97: bscTestnet,
    };

    const chain = chains[chainId];
    if (!chain) {
      throw new UnsupportedNetworkError(`Unsupported EVM chain ID: ${chainId}`);
    }
    return chain;
  }

  private parseNetworkToChainId(network: string): number {
    if (!network.startsWith('eip155:')) {
      throw new UnsupportedNetworkError(
        `Invalid EVM network format: ${network}`,
      );
    }
    const chainId = parseInt(network.split(':')[1], 10);
    if (isNaN(chainId)) {
      throw new UnsupportedNetworkError(`Invalid EVM chain ID in: ${network}`);
    }
    return chainId;
  }
}

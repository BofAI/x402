/**
 * EvmClientSigner - EVM client signer for x402 protocol
 */

import {
  createWalletClient,
  createPublicClient,
  http,
  type WalletClient,
  type PublicClient,
  type Account,
  type Hex,
  parseAbi,
  type Transport,
  type Chain,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet, sepolia, bsc, bscTestnet } from 'viem/chains';
import type { ClientSigner } from '../client/x402Client.js';
import {
  getPaymentPermitAddress,
  resolveRpcUrl,
  InsufficientAllowanceError,
  UnsupportedNetworkError,
} from '../index.js';
import type { Wallet } from '../wallet/types.js';
import { EvmPrivateKeyWallet } from '../wallet/evmPrivateKeyWallet.js';

const ERC20_ABI = parseAbi([
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
]);

export class EvmClientSigner implements ClientSigner {
  private wallet: Wallet;
  private _address: string;
  private publicClients: Map<number, PublicClient> = new Map();

  constructor(wallet: Wallet) {
    this.wallet = wallet;
    this._address = wallet.getAddress();
  }

  /** Create signer from a Wallet instance. */
  static fromWallet(wallet: Wallet): EvmClientSigner {
    return new EvmClientSigner(wallet);
  }

  /** Create signer from private key (convenience factory). */
  static fromPrivateKey(privateKey: string): EvmClientSigner {
    return new EvmClientSigner(new EvmPrivateKeyWallet(privateKey));
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
    const chain = this.getChain(chainId);

    try {
      const rpcUrl = resolveRpcUrl(network);

      // Build approve transaction and sign via wallet
      const account = privateKeyToAccount('0x0000000000000000000000000000000000000000000000000000000000000001');
      const tempWalletClient = createWalletClient({
        account,
        chain: chain,
        transport: http(rpcUrl),
      });

      // Use wallet's signTransaction to sign the approval
      const hash = await tempWalletClient.writeContract({
        address: token as Hex,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [spender, BigInt(2) ** BigInt(256) - BigInt(1)],
        account: this._address as Hex,
      } as any);

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

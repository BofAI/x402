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

const ERC20_ABI = parseAbi([
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
]);

export class EvmClientSigner implements ClientSigner {
  private walletClient: WalletClient<Transport, Chain, Account>;
  private publicClients: Map<number, PublicClient> = new Map();
  private account: Account;

  constructor(privateKey: string) {
    const hexKey = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
    this.account = privateKeyToAccount(hexKey as Hex);
    this.walletClient = createWalletClient({
      account: this.account,
      chain: mainnet,
      transport: http(),
    });
  }

  getAddress(): string {
    return this.account.address;
  }

  getEvmAddress(): Hex {
    return this.account.address;
  }

  async signMessage(message: Uint8Array): Promise<string> {
    return this.walletClient.signMessage({
      message: { raw: message },
    });
  }

  async signTypedData(
    domain: Record<string, unknown>,
    types: Record<string, unknown>,
    message: Record<string, unknown>,
    primaryType: string
  ): Promise<string> {
    return this.walletClient.signTypedData({
      domain: domain as any,
      types: types as any,
      primaryType,
      message: message as any,
    });
  }

  async checkBalance(token: string, network: string, address?: string): Promise<bigint> {
    const chainId = this.parseNetworkToChainId(network);
    const client = this.getPublicClient(chainId, network);
    const targetAddress = (address || this.account.address) as Hex;

    try {
      return await client.readContract({
        address: token as Hex,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [targetAddress],
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
        args: [this.account.address, spender],
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
      const walletClient = createWalletClient({
        account: this.account,
        chain: chain,
        transport: http(rpcUrl),
      });

      const hash = await walletClient.writeContract({
        address: token as Hex,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [spender, BigInt(2) ** BigInt(256) - BigInt(1)],
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

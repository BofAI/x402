/**
 * AgentWalletAdapter — Adapts agent-wallet's BaseWallet to x402 Wallet interface.
 *
 * Usage:
 *   import { WalletFactory } from "agent-wallet";
 *   const provider = WalletFactory({ secretsDir: "~/.agent-wallet", password: "..." });
 *   const agentWallet = await provider.getWallet("my-wallet");
 *   const wallet = await AgentWalletAdapter.create(agentWallet);
 *   const signer = EvmClientSigner.fromWallet(wallet);
 */

import type { Wallet } from './types.js';

/** Minimal interface expected from agent-wallet's BaseWallet + Eip712Capable. */
interface AgentWallet {
  getAddress(): Promise<string>;
  signMessage(msg: Uint8Array): Promise<string>;
  signTypedData(data: Record<string, unknown>): Promise<string>;
  signTransaction(payload: Record<string, unknown>): Promise<string>;
}

export class AgentWalletAdapter implements Wallet {
  private agentWallet: AgentWallet;
  private _address: string;

  private constructor(agentWallet: AgentWallet, address: string) {
    this.agentWallet = agentWallet;
    this._address = address;
  }

  /** Create adapter by eagerly resolving the async address. */
  static async create(agentWallet: AgentWallet): Promise<AgentWalletAdapter> {
    const address = await agentWallet.getAddress();
    return new AgentWalletAdapter(agentWallet, address);
  }

  getAddress(): string {
    return this._address;
  }

  async signMessage(message: Uint8Array): Promise<string> {
    return this.agentWallet.signMessage(message);
  }

  async signTypedData(data: Record<string, unknown>): Promise<string> {
    return this.agentWallet.signTypedData(data);
  }

  async signTransaction(tx: Record<string, unknown>): Promise<string> {
    let result = await this.agentWallet.signTransaction(tx);

    // TRON case: agent-wallet may return JSON with embedded signature
    if (result.trimStart().startsWith('{')) {
      const signed = JSON.parse(result);
      const sigs: string[] = signed.signature ?? [];
      if (!sigs.length) throw new Error('agent-wallet returned signed tx JSON without signature');
      result = sigs[0];
    }

    // Normalize: strip 0x prefix to match Wallet contract
    return result.startsWith('0x') ? result.slice(2) : result;
  }
}

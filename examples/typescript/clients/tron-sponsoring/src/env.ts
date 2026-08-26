/** Wallet resolution for the standalone TRON Sponsoring Client. */
import { resolveWallet, type Wallet } from '@bankofai/agent-wallet'
import { TRON_NILE, type ClientTronWallet } from '@bankofai/x402-tron'

type TronClientWallet = Wallet & ClientTronWallet

/**
 * Resolves the TRON wallet with the signing capabilities used by the client.
 *
 * `agent-wallet` exposes its chain-neutral base type, while the resolved TRON
 * implementation also supports typed-data and transaction signing.
 *
 * @returns A TRON client wallet for Nile.
 */
export async function resolveTronClientWallet(): Promise<TronClientWallet> {
  return (await resolveWallet({ network: TRON_NILE })) as TronClientWallet
}

/** Wallet resolution for the standalone TRON Sponsoring Facilitator. */
import { resolveWallet, type Wallet } from '@bankofai/agent-wallet'
import { TRON_NILE, type FacilitatorTronWallet } from '@bankofai/x402-tron'

type TronFacilitatorWallet = Wallet & FacilitatorTronWallet

/**
 * Resolves the TRON wallet that signs settlement and resource transactions.
 *
 * `agent-wallet` exposes its chain-neutral base type, while the resolved TRON
 * implementation also supports transaction signing.
 *
 * @returns A TRON facilitator wallet for Nile.
 */
export async function resolveTronFacilitatorWallet(): Promise<TronFacilitatorWallet> {
  const walletId = process.env.TRON_SPONSORING_RESOURCE_OWNER_WALLET_ID?.trim()
  if (!walletId) throw new Error('TRON_SPONSORING_RESOURCE_OWNER_WALLET_ID is required')
  return (await resolveWallet({
    network: TRON_NILE,
    walletId,
  })) as TronFacilitatorWallet
}

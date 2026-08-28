/**
 * TRON Approval Resource Sponsoring payer on Nile.
 *
 * The Server declaration makes the exact Client attach a signed, unbroadcast
 * TRC-20 Approval. The Facilitator supplies Energy/Bandwidth and broadcasts it.
 */
import { x402Client, wrapFetchWithPayment } from '@bankofai/x402-fetch'
import { createClientTronSigner, TRON_NILE } from '@bankofai/x402-tron'
import { ExactTronScheme } from '@bankofai/x402-tron/exact/client'

import { resolveTronClientWallet } from './env.js'

const resourceUrl = process.env.RESOURCE_URL || 'http://localhost:4041/weather'
const rpcUrl = process.env.TRON_NILE_RPC_URL?.trim() || undefined
const wallet = await resolveTronClientWallet()
const signer = await createClientTronSigner(wallet, {
  network: TRON_NILE,
  apiKey: process.env.TRON_GRID_API_KEY,
  ...(rpcUrl ? { rpcUrl } : {}),
})
const client = new x402Client().register(TRON_NILE, new ExactTronScheme(signer))
const fetchWithPayment = wrapFetchWithPayment(fetch, client)

console.info(`[tron-sponsoring] payer ${signer.address}`)
console.info(`→ GET ${resourceUrl}`)
const response = await fetchWithPayment(resourceUrl)
const body = await response.json()
console.info(`← ${response.status} ${response.statusText}`)
console.info(JSON.stringify(body, null, 2))
if (!response.ok) throw new Error(`request failed with HTTP ${response.status}`)

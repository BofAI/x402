/** Standalone TRON Approval Resource Sponsoring Facilitator on Nile. */
import express from 'express'
import { x402Facilitator } from '@bankofai/x402-core/facilitator'
import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  VerifyResponse,
} from '@bankofai/x402-core/types'
import { createTrc20ApprovalResourceSponsoringExtension } from '@bankofai/x402-extensions'
import {
  createFacilitatorTronSigner,
  createTrc20ResourceSponsoringRuntime,
  InMemoryTrc20SponsoringCoordinator,
  TRON_NILE,
} from '@bankofai/x402-tron'
import { ExactTronScheme } from '@bankofai/x402-tron/exact/facilitator'

import { resolveTronFacilitatorWallet } from './env.js'

const USDT_NILE = 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf'
const RECOVERY_INTERVAL_MS = 15_000
const SPONSOR_ENERGY_STAKE_SUN_CAPACITY = 2_000_000_000n
const SPONSOR_BANDWIDTH_STAKE_SUN_CAPACITY = 2_000_000_000n
const SPONSOR_BUDGET_CAPACITY = 100_000_000n
const MANAGEMENT_BANDWIDTH_CAPACITY = 10_000n

const port = Number.parseInt(process.env.FACILITATOR_PORT || '4042', 10)
const permissionId = Number.parseInt(process.env.TRON_PERMISSION_ID || '0', 10)
if (permissionId <= 0) {
  throw new Error('TRON_PERMISSION_ID must select a restricted Active Permission')
}
const rpcUrl = process.env.TRON_NILE_RPC_URL?.trim() || undefined
const wallet = await resolveTronFacilitatorWallet()
const owner = await wallet.getAddress()
const signer = await createFacilitatorTronSigner(wallet, {
  network: TRON_NILE,
  apiKey: process.env.TRON_GRID_API_KEY,
  ...(rpcUrl ? { rpcUrl } : {}),
})
const coordinator = new InMemoryTrc20SponsoringCoordinator({
  energyStakeSunCapacity: SPONSOR_ENERGY_STAKE_SUN_CAPACITY,
  bandwidthStakeSunCapacity: SPONSOR_BANDWIDTH_STAKE_SUN_CAPACITY,
  budgetCapacity: SPONSOR_BUDGET_CAPACITY,
  managementBandwidthCapacity: MANAGEMENT_BANDWIDTH_CAPACITY,
})
const runtime = await createTrc20ResourceSponsoringRuntime({
  network: TRON_NILE,
  resourceOwnerSigner: {
    getAddress: () => wallet.getAddress(),
    signResourceTransaction: ({ transaction }) => wallet.signTransaction(transaction),
  },
  coordinator,
  allowedAssets: [USDT_NILE],
  confirmationMode: 'packed',
  apiKey: process.env.TRON_GRID_API_KEY,
  ...(rpcUrl ? { rpcUrl } : {}),
  permissionId,
})
const facilitator = new x402Facilitator()
  .register(TRON_NILE, new ExactTronScheme(signer))
  .registerExtension(createTrc20ApprovalResourceSponsoringExtension(runtime))

const recoveryWorker = setInterval(() => {
  void runtime.reconcile().catch((error) => console.error('[recovery]', error))
}, RECOVERY_INTERVAL_MS)
recoveryWorker.unref()

const app = express()
app.use(express.json())
app.post('/verify', async (request, response) => {
  try {
    const { paymentPayload, paymentRequirements } = request.body as {
      paymentPayload?: PaymentPayload
      paymentRequirements?: PaymentRequirements
    }
    if (!paymentPayload || !paymentRequirements) {
      return response.status(400).json({ error: 'Missing payment payload or requirements' })
    }
    const result: VerifyResponse = await facilitator.verify(paymentPayload, paymentRequirements)
    response.json(result)
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' })
  }
})
app.post('/settle', async (request, response) => {
  try {
    const { paymentPayload, paymentRequirements } = request.body as {
      paymentPayload?: PaymentPayload
      paymentRequirements?: PaymentRequirements
    }
    if (!paymentPayload || !paymentRequirements) {
      return response.status(400).json({ error: 'Missing payment payload or requirements' })
    }
    const result: SettleResponse = await facilitator.settle(paymentPayload, paymentRequirements)
    response.json(result)
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' })
  }
})
app.get('/supported', (_request, response) => response.json(facilitator.getSupported()))
app.listen(port, () => {
  console.info(`TRON Sponsoring Facilitator: http://localhost:${port}`)
  console.info(`Resource Owner: ${owner}; Active Permission: ${permissionId}`)
})

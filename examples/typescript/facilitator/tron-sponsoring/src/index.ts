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

import { facilitatorConfig as config } from './config.js'
import { resolveTronFacilitatorWallet } from './env.js'

const wallet = await resolveTronFacilitatorWallet()
const owner = await wallet.getAddress()
const signer = await createFacilitatorTronSigner(wallet, {
  network: TRON_NILE,
  apiKey: config.apiKey,
  ...(config.rpcUrl ? { rpcUrl: config.rpcUrl } : {}),
})
const coordinator = new InMemoryTrc20SponsoringCoordinator({
  energyStakeSunCapacity: config.energyStakeSunCapacity,
  bandwidthStakeSunCapacity: config.bandwidthStakeSunCapacity,
  budgetCapacity: config.budgetCapacity,
  managementBandwidthCapacity: config.managementBandwidthCapacity,
})
const runtime = await createTrc20ResourceSponsoringRuntime({
  network: TRON_NILE,
  resourceOwnerSigner: {
    getAddress: () => wallet.getAddress(),
    signResourceTransaction: ({ transaction }) => wallet.signTransaction(transaction),
  },
  coordinator,
  allowedAssets: [config.allowedAsset],
  confirmationMode: 'packed',
  apiKey: config.apiKey,
  ...(config.rpcUrl ? { rpcUrl: config.rpcUrl } : {}),
  permissionId: config.permissionId,
})
const facilitator = new x402Facilitator()
  .register(TRON_NILE, new ExactTronScheme(signer))
  .registerExtension(createTrc20ApprovalResourceSponsoringExtension(runtime))

const reconcile = () => {
  void runtime.reconcile().catch((error) => console.error('[recovery]', error))
}
reconcile()
const recoveryWorker = setInterval(reconcile, config.recoveryIntervalMs)
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
app.listen(config.port, () => {
  console.info(`TRON Sponsoring Facilitator: http://localhost:${config.port}`)
  console.info(`Resource Owner: ${owner}; Active Permission: ${config.permissionId}`)
})

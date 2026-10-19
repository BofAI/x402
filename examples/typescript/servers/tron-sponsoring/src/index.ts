/** TRON Approval Resource Sponsoring resource server on Nile. */
import express from 'express'
import { x402ResourceServer } from "@x402/core/server";
import type { RoutesConfig } from '@x402/core/http'
import { HTTPFacilitatorClient } from '@x402/core/server'
import { x402HTTPResourceServer } from "@x402/core/http";
import { paymentMiddlewareFromHTTPServer } from "@x402/express";
import { declareTrc20ApprovalResourceSponsoringExtension } from '@bankofai/x402-tron-extensions'
import { TRON_NILE } from '@bankofai/x402-tron'
import { ExactTronScheme } from '@bankofai/x402-tron/exact/server'

const port = Number.parseInt(process.env.SERVER_PORT || '4041', 10)
const facilitatorUrl = process.env.FACILITATOR_URL || 'http://localhost:4042'
const payTo = process.env.TRON_ADDRESS?.trim()
if (!payTo) throw new Error('TRON_ADDRESS is required')

const resourceServer = new x402ResourceServer(new HTTPFacilitatorClient({ url: facilitatorUrl, timeoutMs: 120_000 }))
resourceServer.register(TRON_NILE, new ExactTronScheme())
const routes: RoutesConfig = {
  'GET /weather': {
    accepts: [
      {
        scheme: 'exact',
        network: TRON_NILE,
        payTo,
        price: '0.001 USDT',
      },
    ],
    extensions: declareTrc20ApprovalResourceSponsoringExtension(),
    description: 'Current weather paid with a resource-sponsored TRC-20 Approval',
    mimeType: 'application/json',
  },
}
const httpServer = new x402HTTPResourceServer(resourceServer, routes)
const app = express()
app.use(paymentMiddlewareFromHTTPServer(httpServer))
app.get('/weather', (_request, response) => {
  response.json({ report: { weather: 'sunny', temperature: 70 } })
})
app.listen(port, () => {
  console.info(`TRON Sponsoring Server: http://localhost:${port}`)
  console.info(`Facilitator: ${facilitatorUrl}`)
})

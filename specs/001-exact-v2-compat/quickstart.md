# Quickstart: Exact Scheme V2 Compatibility

## Goal

Verify that the repository's `exact` implementation is aligned closely enough with Coinbase x402 v2 for both interoperability directions:

- Coinbase-style v2 client -> our server
- our client -> v2-compatible server

## Local Verification Steps

1. Install Python dependencies in the repository virtual environment.
2. Install TypeScript dependencies for `typescript/packages/x402`.
3. Run the targeted Python tests covering:
   - exact client payload generation
   - exact facilitator verification
   - server-side signature and payload validation
4. Run the targeted TypeScript tests covering:
   - native exact payload generation
   - exact mechanism regression checks
5. Confirm that `exact` payloads now place transfer authorization data in `payload.authorization`.
6. Confirm that Python server-side validation accepts `exact` without requiring `paymentPermit`.

## Expected Interoperability Signals

- A v2-style `exact` payment payload serializes with `payload.authorization`.
- The server and facilitator can still read the old extension-based authorization as a fallback during migration.
- Non-`exact` schemes continue to use their existing permit-centric payload paths.

## Notes

- If live Coinbase integration is unavailable locally, use spec-faithful fixtures and request/response snapshots to validate wire compatibility.
- The current migration keeps an extension fallback for `exact` authorization to reduce breakage while the standard payload path becomes primary.

## Live Verification Runbook

Validated on 2026-04-03 against Coinbase official TypeScript x402 workspace code and the local BankOfAI BSC testnet demo wallets.

### BSC Contract Notes

- BSC `exact` compatibility is based on ERC-3009 token behavior, not on sharing a Coinbase-specific settlement contract.
- Our BSC `exact_permit` spender / payment-permit address remains:
  - `eip155:97`: `0x1825bB32db3443dEc2cc7508b2D818fc13EaD878`
- The smoke-tested BSC `exact` asset is:
  - `DHLU`
  - `0x375cADdd2cB68cE82e3D9B075D551067a7b4B816`
- If `exact` is advertised on a token that does not implement `transferWithAuthorization`, settlement will revert even if the payload shape is otherwise spec-compliant.

### Prerequisites

1. Start the local BankOfAI facilitator on a free port with BSC enabled.
2. Start the local BankOfAI demo server against that facilitator.
3. Install and build the Coinbase official TypeScript workspace packages needed for `@x402/core`, `@x402/evm`, `@x402/fetch`, and `@x402/fastify`.

### Coinbase Official Client -> Our Server

Start local services:

```bash
cd ../x402-demo
FACILITATOR_PORT=8013 ./start.sh facilitator
BSC_PAY_TO=0x6d361463Ad6Df90bC34aF65f4970d3271aa83535 SERVER_PORT=8012 SERVER_URL=http://127.0.0.1:8012 FACILITATOR_URL=http://127.0.0.1:8013 ./start.sh server
```

Run the Coinbase official client from its workspace against our BSC `exact` endpoint:

```bash
cd <coinbase-x402-workspace>/e2e
pnpm exec tsx ./coinbase-official-client-bsc.ts
```

Observed result:

- HTTP status: `200`
- Network: `eip155:97`
- Payer: `0x0f2AA81140BAC3E9A4a7f6212c1B4eC005ea4C14`
- Asset: `DHLU` (`0x375cADdd2cB68cE82e3D9B075D551067a7b4B816`)
- Settlement tx: `0xe6784ca32fa7df9e123b6ead2319f0c16dd7602577c58a085619b2c675e6ed28`

### Our Client -> Coinbase Official Server

Start the Coinbase official server fixture against the local BankOfAI facilitator:

```bash
cd <coinbase-x402-workspace>/e2e
pnpm exec tsx ./coinbase-official-server-bsc.ts
```

Run the local BankOfAI demo client against the official server:

```bash
cd ../x402-demo
SERVER_URL=http://127.0.0.1:4026 ENDPOINT=/exact/evm/bsc-eip3009 PREFERRED_NETWORK=eip155:97 ./start.sh client-ts
```

Observed result:

- HTTP status: `200 OK`
- Network: `eip155:97`
- Asset: `DHLU` (`0x375cADdd2cB68cE82e3D9B075D551067a7b4B816`)
- Settlement tx: `0xdb06e09fd721c19709c697421c171e79fc3f5bdcb6bd41d822b64df8b455422e`
- Response body: `{"ok": true, "source": "coinbase-official-server"}`

### Additional Compatibility Note

During live validation, the Coinbase official Fastify middleware returned the x402 challenge in the standard `payment-required` header while leaving the response body empty. Any local test client used for this path must parse the challenge from the header, not only from a JSON body fixture.

### Temporary Helper Script Note

The `coinbase-official-client-bsc.ts` helper should target the dedicated `exact` route (`/protected-bsc-testnet-coinbase`) instead of the mixed demo route. This isolates the BSC `exact` path and avoids accidentally selecting `exact_permit`.

## Rollout Note: Hosted Facilitator

The live interoperability proof in this spec used a locally upgraded facilitator, not the currently hosted production facilitator.

On 2026-04-03, the hosted facilitator at `https://facilitator.bankofai.io` was tested behind the local BSC `exact` server path:

- `/supported` advertised `exact` for `eip155:97` and `eip155:56`
- actual settlement failed with `missing_transfer_authorization`

Interpretation:

- the hosted facilitator has not yet been upgraded to the Coinbase-v2-compatible BSC `exact` settlement path
- rollout requires a facilitator deployment, not just SDK/server publication

Deployment implication:

1. Deploy upgraded facilitator code first.
2. Re-run Coinbase official client -> our server against the hosted facilitator.
3. Only after that succeeds should hosted services claim Coinbase v2 BSC `exact` support.

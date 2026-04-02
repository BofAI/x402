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

Validated on 2026-04-02 against Coinbase official TypeScript x402 workspace code and the local BankOfAI BSC testnet demo wallets.

### Prerequisites

1. Start the local BankOfAI facilitator on a free port with BSC enabled.
2. Start the local BankOfAI demo server against that facilitator.
3. Install and build the Coinbase official TypeScript workspace packages needed for `@x402/core`, `@x402/evm`, `@x402/fetch`, and `@x402/fastify`.

### Coinbase Official Client -> Our Server

Start local services:

```bash
cd /Users/bobo/code/x402/x402-demo
BSC_PAY_TO=0x6d361463Ad6Df90bC34aF65f4970d3271aa83535 FACILITATOR_PORT=8013 ./start.sh ts-facilitator
BSC_PAY_TO=0x6d361463Ad6Df90bC34aF65f4970d3271aa83535 SERVER_PORT=8012 SERVER_URL=http://127.0.0.1:8012 FACILITATOR_URL=http://127.0.0.1:8013 ./start.sh ts-server
```

Run the Coinbase official client from its workspace against our BSC endpoint:

```bash
cd /Users/bobo/code/tmp/coinbase-x402/e2e
pnpm exec tsx /Users/bobo/code/tmp/coinbase-x402/e2e/coinbase-official-client-bsc.ts
```

Observed result:

- HTTP status: `200`
- Network: `eip155:97`
- Payer: `0x0f2AA81140BAC3E9A4a7f6212c1B4eC005ea4C14`
- Settlement tx: `0x29d452bced7870ee8b4cfc159b250a22e87db66f3af5bbb9e9c7d5cef7d752e2`

### Our Client -> Coinbase Official Server

Start the Coinbase official server fixture against the local BankOfAI facilitator:

```bash
cd /Users/bobo/code/tmp/coinbase-x402/e2e
pnpm exec tsx /Users/bobo/code/tmp/coinbase-x402/e2e/coinbase-official-server-bsc.ts
```

Run the local BankOfAI demo client against the official server:

```bash
cd /Users/bobo/code/x402/x402-demo
SERVER_URL=http://127.0.0.1:4026 ENDPOINT=/exact/evm/bsc-eip3009 PREFERRED_NETWORK=eip155:97 ./start.sh ts-client
```

Observed result:

- HTTP status: `200 OK`
- Network: `eip155:97`
- Settlement tx: `0xb8d9233a875ede13c1e69b8a0515f01b09a2be4645beba3a0805f54f93061771`
- Response body: `{"ok": true, "source": "coinbase-official-server"}`

### Additional Compatibility Note

During live validation, the Coinbase official Fastify middleware returned the x402 challenge in the standard `payment-required` header while leaving the response body empty. Any local test client used for this path must parse the challenge from the header, not only from a JSON body fixture.

# Fetch client (EVM + TRON)

Wraps `fetch` so HTTP `402 Payment Required` challenges are paid automatically.
`src/index.ts` is **chain-agnostic**; each chain's signer setup lives in
`src/chains/`.

## Wallet model — agent-wallet, never a raw key

Both chains sign via `@bankofai/agent-wallet` (`resolveWallet({ network })`):

- EVM: `createClientEvmSigner(wallet, publicClient)` — adapts the wallet
  (async address + `0x`-normalized signatures) and wires `readContract` for
  permit2 enrichment.
- TRON: `createClientTronSigner(tronWeb, agentWallet)` — the SDK takes its
  `AgentWallet` shape, so `chains/tron.ts` adapts the raw wallet inline.

A chain registers only if its wallet resolves, so you can pay from EVM-only,
TRON-only, or both.

## Balance guard (TRON)

`chains/tron.ts` registers a `beforePaymentCreation` hook that checks the payer
can cover `amount + fee` before signing, aborting with a clear error otherwise —
the new-SDK equivalent of the demo's `SufficientBalancePolicy`. Because core's
payment selection is synchronous, the (async) on-chain balance read runs as this
hook; it guards the chosen requirement rather than re-selecting among
alternatives. EVM has no client-side `checkBalance` yet, so it isn't guarded.

## Run

```bash
# Start a resource server + facilitator first (see ../../servers/express,
# ../../facilitator/basic), then:
pnpm install            # from examples_new/typescript
pnpm dev                # or: pnpm --filter @bankofai/x402-example-client-fetch dev
```

Set `RESOURCE_URL` to the protected endpoint. Configure the wallet via
agent-wallet (`AGENT_WALLET_PRIVATE_KEY` for EVM, `TRON_PRIVATE_KEY` for TRON).

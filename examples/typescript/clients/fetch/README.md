# Fetch client (EVM + TRON)

Wraps `fetch` so HTTP `402 Payment Required` challenges are paid automatically.
`src/index.ts` is **chain-agnostic**; each chain's signer setup lives in
`src/chains/`.

## Wallet model — agent-wallet, never a raw key

Both chains sign via `@bankofai/agent-wallet` (`resolveWallet({ network })`):

- EVM: `createClientEvmSigner(wallet, { network, rpcUrl })` — adapts the wallet
  (async address + `0x`-normalized signatures); the factory builds the viem
  `publicClient` internally and wires `readContract` for permit2 enrichment.
- TRON: `createClientTronSigner(wallet, { network, apiKey })` — the factory
  builds TronWeb internally from the network. Normally it auto-broadcasts a
  one-time Permit2 Approval; when the Server declares
  `trc20ApprovalResourceSponsoring`, it only signs the Approval and attaches it
  to the x402 payload for the Facilitator to sponsor.

A chain registers only if its wallet resolves, so you can pay from EVM-only,
TRON-only, or both.

## Run

```bash
# Start a resource server + facilitator first (see ../../servers/express,
# ../../facilitator/basic), then:
pnpm install            # from examples/typescript
pnpm dev                # or: pnpm --filter @bankofai/x402-example-client-fetch dev
```

Set `RESOURCE_URL` to the protected endpoint. Configure the wallet via
agent-wallet — a single `AGENT_WALLET_PRIVATE_KEY` serves both chains.

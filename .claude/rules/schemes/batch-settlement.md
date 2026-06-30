# Scheme: `batch-settlement`

Code: `mechanisms/{evm,tron}/src/batch-settlement/{client,facilitator,server}`. Classes `BatchSettlementEvmScheme` / `BatchSettlementTronScheme`. No register helper — use `new + register`. The aggregate entry (`@bankofai/x402-<chain>/batch-settlement`) re-exports the **client** scheme plus helpers (`signVoucher`, `InMemoryClientChannelStorage`, `computeChannelId`); server/facilitator classes come from their role subpaths only.

`batch-settlement` uses **payment channels**: the payer deposits once on-chain, then pays many requests with off-chain **vouchers**; the server's channel manager claims a batch and settles to `payTo`. A **refund** path returns the remaining channel balance.

## When to use

- Many small payments to the same server (deposit once, amortize gas across N requests).
- The payer wants to reclaim the unspent deposit afterward (refund).

## Key invariants

- Deposit/channel state is read from chain (allowance, channel balance), so the EVM path **needs a working RPC** ([networks/evm.md](../networks/evm.md)).
- Vouchers are signed off-chain and accumulate; the facilitator claims the batch on-chain.

## Common gotchas

- **Refund must select its own VM family's accept** (commit `d667b9e`). A route can advertise `accepts[]` for multiple networks; the refund probe must filter by chain family (`a.network.startsWith("tron:")` / `"eip155:"`) before picking the channel — taking the first scheme match can hand an `eip155:*` accept to the TRON refund (or vice-versa) and crash in the chain-id helper. Both the TRON and EVM refund probes were fixed; the EVM file is upstream-derived and the same latent bug exists upstream.

## Testing

`mechanisms/evm/test/unit/batch-settlement/**` (incl. `refund-network.test.ts`), `mechanisms/tron/test/unit/batch-settlement/**` and `batch-refund-network.test.ts` — the network tests mock a multi-network 402 (foreign family first) + a `readContract` sentinel to prove the correct family is selected.

## Safety

Channel deposit / claim / refund + signing — **security-reviewer territory**.

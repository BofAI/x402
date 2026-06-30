# Scheme: `exact_gasfree`

Code: `mechanisms/tron/src/gasfree/{client,facilitator,server}`. Class `ExactGasFreeTronScheme`. **TRON-only.** Wire it with `registerExactGasFreeTronScheme` (it assembles the GasFree relayer API clients — `createGasFreeApiClients`, base-URL registry — that callers shouldn't build by hand).

`exact_gasfree` enables **gasless payments on TRON**. Users hold tokens in a GasFree custodial wallet and sign TIP-712 permits. A service provider (relayer) submits the transaction on-chain, paying TRX gas and collecting a `maxFee`.

## When to use

- TRON, user does not hold TRX for gas.
- Token held in the user's GasFree custodial wallet (NOT the main wallet).
- A trusted relayer (service provider) is available.

## Key invariants

- Domain is `{"name": "GasFreeController", "version": "V1.0.0", "chainId": <tron_chain_id>, "verifyingContract": <GasFreeController EVM hex>}`.
- All address fields — `verifyingContract`, `token`, `serviceProvider`, `user`, `receiver` — are **EVM hex**, not Base58 ([networks/tron.md](../networks/tron.md)).
- Funds are in `gasFreeAddress`, not the main wallet.
- **`feeTo` is the relayer's registered service provider.** Verify rejects any other `feeTo` with `gasfree_fee_to_mismatch`. The facilitator must not advertise its own wallet as `feeTo` — only emit `feeTo` when it is an actual registered provider (commit `c4472cc`). The client resolves the provider from `fee.feeTo` if present, else picks from the providers endpoint.

## Common gotchas — all caught in production already, do not repeat

- **Address format**: TIP-712 requires 0x-prefixed hex for every address field. Base58 → a signature that verifies to the wrong address.
- **Deadline bounds**: mainnet enforces `[50, 600]`s, testnets `[50, 3600]`s. Clamp per-network with 5s padding: mainnet `[55, 595]`, testnet `[55, 3595]`. Warn when clamping.
- **Balance source**: balance checks must query `gasFreeAddress` via the GasFree API, **not** the main wallet (which may be empty while the GasFree wallet has funds).

## Testing

`mechanisms/tron/test/unit/gasfree-*.test.ts` (`gasfree-api`, `gasfree-digest`, `gasfree-feeto`, `gasfree-flow`). Mock the GasFree API for deadline-clamping and feeTo tests.

## Safety

Payment-path + signing code in this scheme is **security-reviewer territory**. Route changes through `.claude/agents/security-reviewer.md`.

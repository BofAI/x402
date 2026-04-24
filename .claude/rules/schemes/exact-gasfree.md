# Scheme: `exact_gasfree`

**Spec**: [specs/schemes/exact-gasfree.md](../../../specs/schemes/exact-gasfree.md)

`exact_gasfree` enables **gasless payments on TRON**. Users hold tokens in a GasFree custodial wallet and sign TIP-712 permits. A service provider (relayer) submits the transaction on-chain, paying TRX gas and collecting a `maxFee`. **TRON-only.**

## When to use

- TRON, user does not hold TRX for gas.
- Token held in the user's GasFree custodial wallet (NOT the main wallet).
- A trusted relayer (service provider) is available.

## Key invariants

- Domain is `{"name": "GasFreeController", "version": "V1.0.0", "chainId": <tron_chain_id>, "verifyingContract": <GasFreeController EVM hex>}`.
- All address fields — `verifyingContract`, `token`, `serviceProvider`, `user`, `receiver` — are **EVM hex**, not Base58. See [docs/solutions.md entry #1](../../../docs/solutions.md).
- Funds are in `gasFreeAddress`, not the main wallet.

## Common gotchas — all caught in production already, do not repeat

- **Address format** ([solutions.md #1](../../../docs/solutions.md)): TIP-712 requires 0x-prefixed hex for every address field. Passing Base58 produces a signature that looks valid but verifies to the wrong address. `PR #53` fixed this.
- **Deadline bounds** ([solutions.md #2](../../../docs/solutions.md)): mainnet enforces `[50, 600]` seconds, testnets `[50, 3600]`. Clamp per-network with 5s padding on each side: mainnet `[55, 595]`, testnet `[55, 3595]`. Warn when clamping. `PR #56` fixed this.
- **Balance source** ([solutions.md #3](../../../docs/solutions.md)): `SufficientBalancePolicy` must call `mechanism.checkBalance()` (which queries `gasFreeAddress` via GasFree API), **not** `signer.checkBalance()` (which queries the main wallet). Main wallet may be empty while GasFree wallet has funds. `PR #59` fixed this.
- **`raw_data_hex` preservation** (commit `e6f4cb7`): when constructing TRON approval transactions, preserve `raw_data_hex` as-is on the payload; do not recompute.

## Testing

`python/x402/tests/exact/test_tron_client.py`, `test_tron_facilitator.py`. GasFree-specific:

- Mock the GasFree API for deadline clamping tests.
- Use TRON zero-address fallback in config.

## Safety

Payment-path + signing code in this scheme is **security-reviewer territory**. Route changes through `.claude/agents/security-reviewer.md`.

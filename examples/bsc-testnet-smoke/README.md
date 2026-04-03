# BSC Testnet Smoke Examples

These examples document the BSC testnet (`eip155:97`) interoperability path that was smoke-tested on 2026-04-03.

Validated directions:

- Coinbase official client -> BankOfAI server
- BankOfAI client -> Coinbase official server

Observed settlement transactions:

- Official client -> our server: `0xe6784ca32fa7df9e123b6ead2319f0c16dd7602577c58a085619b2c675e6ed28`
- Our client -> official server: `0xdb06e09fd721c19709c697421c171e79fc3f5bdcb6bd41d822b64df8b455422e`

## Important Notes

- For BSC `exact`, use an ERC-3009-compatible asset. The local testnet smoke path uses `DHLU` at `0x375cADdd2cB68cE82e3D9B075D551067a7b4B816`.
- `exact_permit` and `exact` are different paths. Do not advertise `exact` with a token that only works for `exact_permit`.
- The `x402` SDK branch used for these examples is `001-exact-v2-compat`.

## Environment

Set these before running the examples:

```bash
export BSC_TESTNET_RPC_URL=https://data-seed-prebsc-1-s1.binance.org:8545
export BSC_CLIENT_PRIVATE_KEY=0x...
export BSC_PAY_TO=0x...
export FACILITATOR_URL=http://127.0.0.1:8013
export SERVER_URL=http://127.0.0.1:8012
```

## Example Files

- [`bsc_exact_client.ts`](bsc_exact_client.ts): BankOfAI TypeScript client paying a BSC `exact` endpoint
- [`bsc_exact_client.py`](bsc_exact_client.py): BankOfAI Python client paying a BSC `exact` endpoint
- [`bsc_exact_server.py`](bsc_exact_server.py): FastAPI server advertising both `exact_permit` and `exact` correctly on BSC testnet

## Typical Local Flow

1. Start a facilitator that can settle BSC testnet `exact`.
2. Start the sample server from [`bsc_exact_server.py`](bsc_exact_server.py).
3. Run either client example against `http://127.0.0.1:8012/protected-bsc-testnet-coinbase`.
4. For Coinbase interoperability, pair these examples with the runbook in [`../../specs/001-exact-v2-compat/quickstart.md`](../../specs/001-exact-v2-compat/quickstart.md).

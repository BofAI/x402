# Network: EVM

**Config**: [docs/specs/config.md](../../../docs/specs/config.md)

Identifier: CAIP-2 `eip155:<chainId>`. Chain ID is a decimal integer after the colon.

| Identifier | Chain | Type |
|---|---|---|
| `eip155:1` | Ethereum Mainnet | Production |
| `eip155:11155111` | Sepolia Testnet | Testnet |
| `eip155:56` | BSC Mainnet | Production |
| `eip155:97` | BSC Testnet | Testnet |

## Signing rules

- EIP-712 typed data signing.
- All address fields lowercase-normalized (except within the signature payload where they must be checksummed only if the contract expects checksummed).
- Default tooling: `viem` + `viem/accounts` in TS, `eth_account` in Python. No new wrappers — use existing helpers in `typescript/packages/x402/src/mechanisms/` and `python/x402/src/bankofai/x402/mechanisms/evm/`.

## Contracts

| Role | Fallback if unconfigured |
|---|---|
| `PaymentPermit` | EVM zero address |
| Facilitator | required — no implicit fallback |

BSC has a deployed `PaymentPermit` at `0x1825bB32db3443dEc2cc7508b2D818fc13EaD878` on both mainnet and testnet. See `docs/specs/config.md` for the authoritative registry.

## Token support

- **ERC-3009** (`transferWithAuthorization`): prefer `exact` scheme.
- **EIP-2612** (`permit`): use `exact_permit`.
- Neither: not yet supported; a new scheme is needed (likely `exact_approve` with a separate approval step).

## Smoke tests

`examples/bsc-testnet-smoke/` validated bidirectional compatibility with Coinbase upstream on 2026-04-03. See [specs/001-exact-v2-compat/spec.md](../../../specs/001-exact-v2-compat/spec.md).

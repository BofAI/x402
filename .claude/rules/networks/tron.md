# Network: TRON

**Config**: [specs/config.md](../../../specs/config.md)

Identifier: `tron:<name>` where `<name>` ∈ {`mainnet`, `shasta`, `nile`}.

| Identifier | Chain ID (decimal) | Chain ID (hex) |
|---|---|---|
| `tron:mainnet` | 728126428 | 0x2b6653dc |
| `tron:shasta` | 2494104990 | 0x94a9059e |
| `tron:nile` | 3448148188 | 0xcd8690dc |

## Signing rules

- TIP-712 is TRON's EIP-712 analogue. Structurally identical; same struct-hash / domain-separator algorithm.
- **Every `address` field** — domain and message — must be **0x-prefixed EVM hex**. Passing Base58 produces a valid-looking but wrong signature.
- Convert Base58 ↔ hex via existing helpers (`tron-utils.addressToHex` in TS, `bankofai.x402.utils.tron.to_hex_address` in Python). Do not reimplement.

## Gas & fees

- Native token: TRX. 1 TRX = 1,000,000 SUN.
- Energy/Bandwidth: TRON has a dual-resource fee model; consuming contracts charges energy, consuming bandwidth charges bandwidth. For x402 purposes, the facilitator pays these resources; clients only care about the token transfer.

## GasFree integration

See [.claude/rules/schemes/exact-gasfree.md](../schemes/exact-gasfree.md).

## RPC

- Default RPC: TronGrid when `TRON_GRID_API_KEY` is set. Otherwise the BankofAI-operated fallback `https://hptg.bankofai.io` (set in the client transparently).
- Node client: `tronweb` for JS, `tronpy` / in-house `bankofai.x402.mechanisms.tron.*` for Python.

## Contracts

See `specs/config.md` for the live registry. Mainnet `PaymentPermit` is `TT8rEWbCoNX7vpEUauxb7rWJsTgs8vDLAn`; Nile is `TFxDcGvS7zfQrS1YzcCMp673ta2NHHzsiH`. TronScan verify all deployed contracts.

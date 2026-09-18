# Network: TRON

Mechanisms: `typescript/packages/mechanisms/tron` (`@bankofai/x402-tron`). **In-house, no upstream** — edit directly.

Identifier: `tron:<decimalChainId>` per CAIP-2. Canonical constants: `TRON_MAINNET`, `TRON_NILE`, `TRON_SHASTA` exported from `@bankofai/x402-tron`. Deprecated `tron:0x...` identifiers are accepted as input aliases but must not be emitted by new code.

| Constant | Canonical identifier | TIP-712 chain ID | Deprecated hex alias |
|---|---|---|---|
| `TRON_MAINNET` | `tron:728126428` | 728126428 | 0x2b6653dc |
| `TRON_SHASTA` | `tron:2494104990` | 2494104990 | 0x94a9059e |
| `TRON_NILE` | `tron:3448148188` | 3448148188 | 0xcd8690dc |

Chain id helper: `getTronChainId(network)` in `mechanisms/tron/src/utils.ts`.

## Signing rules

- TIP-712 is TRON's EIP-712 analogue. Structurally identical; same struct-hash / domain-separator algorithm. Uses the in-tree TIP-712 signer — do not add a new lib.
- **Every `address` field** — domain and message — must be **0x-prefixed EVM hex**. Passing Base58 produces a valid-looking but wrong signature.
- Convert Base58 → hex via `tronAddressToEvm` / `normalizeAddressForSigning` (`mechanisms/tron/src/utils.ts`). Do not reimplement.
- Signer factories: `createClientTronSigner` / `createFacilitatorTronSigner` / `createAuthorizerTronSigner` from `@bankofai/x402-tron`. `createClientTronSigner` / `createFacilitatorTronSigner` take `{ network, apiKey? }` and build TronWeb internally; `createAuthorizerTronSigner` takes only a wallet (no network — it signs offline).

## Gas & fees

- Native token: TRX. 1 TRX = 1,000,000 SUN.
- TRON has a dual-resource fee model (energy for contract calls, bandwidth for transfers). For x402 the facilitator (or, in GasFree, the relayer) pays these; clients only care about the token transfer.

## Schemes

- `exact`, `upto`, `batch-settlement`, and `exact_gasfree` (TRON-only gasless). See [schemes/exact-gasfree.md](../schemes/exact-gasfree.md).

## RPC

- Default RPC: TronGrid when `TRON_GRID_API_KEY` is set; otherwise the BankofAI-operated fallback `https://hptg.bankofai.io` (wired transparently). Node client: `tronweb`.

## Contracts

Contract addresses come from the in-tree config registry; TronScan-verify all deployed contracts before referencing a new one.

# `x402-tools`

One-shot BankofAI x402 CLI. Two commands:

- **`server`** — start a local x402 payment server (advertises payment terms, accepts a signed payload, settles).
- **`client <url>`** — pay an x402-protected URL when the server returns `402 Payment Required`.

Spec: [`specs/002-bankofai-cli/bankofai-cli.md`](../../../specs/002-bankofai-cli/bankofai-cli.md). Decisions: [`specs/002-bankofai-cli/notes/decisions.md`](../../../specs/002-bankofai-cli/notes/decisions.md). Full flag matrix and example output: [`FEATURES.md`](FEATURES.md).

## Install

```bash
pnpm --filter @bankofai/x402-cli build
node typescript/packages/cli/dist/index.js --help

# once published
npm install -g @bankofai/x402-cli
x402-tools --help
```

## Quick start

```bash
# Start a server that charges 1.25 USDT on TRON Nile, paid to the address you own
x402-tools server --pay-to TJWdoJk8KyrfxZ2iDUqz7fwpXaMkNqPehx \
  --decimal 1.25 --network tron:nile

# In another shell — pay it
x402-tools client http://127.0.0.1:4020/pay \
  --max-decimal 1.25 --network tron:nile --token USDT
```

## Amount conventions

Both `server` and `client` accept either form, never both:

| Flag | Meaning | Example |
|---|---|---|
| `--decimal <decimal>` | human-readable; resolved against the token's `decimals` | `1.25` |
| `--raw-amount <integer>` | smallest-unit BigInt-able string, fed straight into `PaymentRequirements.amount` | `1250000` for 1.25 USDT |

JSON output always reports both as `decimal` and `raw_amount`.

## Wallet

The CLI never accepts a private key as a flag. Two sources, picked via `--wallet <source>`:

- `agent-wallet` (default) — uses `@bankofai/agent-wallet`'s active wallet for the target network.
- `env` — reads `TRON_PRIVATE_KEY` (for `tron:*` networks) or `EVM_PRIVATE_KEY` (for `eip155:*`).

Resolution order: agent-wallet → env-key fallback → `WALLET_NOT_AVAILABLE`. The fallback is logged to stderr so misconfigurations are visible.

## Output

Every command emits the same wrapped JSON envelope under `--json` (or `X402_OUTPUT=json`):

```json
{ "ok": true,  "command": "...", "result": { ... } }
{ "ok": false, "command": "...", "error": { "code": "...", "message": "...", "hint": "..." } }
```

15 standardized error codes are documented in [`src/error.ts`](src/error.ts). Result fields use `snake_case` (`pay_url`, `resource_url`, `pay_to`, `raw_amount`).

## Schemes

The CLI auto-picks per `(network, token)` in [`src/schemes.ts`](src/schemes.ts) when `--scheme` is omitted:

| Network | Token | Auto scheme | User fee |
|---|---|---|---|
| BSC testnet (`eip155:97`) | DHLU | `exact` | 0 |
| BSC testnet (`eip155:97`) | USDT/USDC | `exact_permit` | 0 |
| TRON Nile (`tron:nile`) | USDT | `exact_permit` | 0 |
| TRON Nile (`tron:nile`) | USDD | `exact_gasfree` | 0.1 USDT |
| TRON mainnet | USDT | `exact_permit` | 0 |

Settlement paths:

- `exact` / `exact_permit` (TRON or EVM) → BankofAI root facilitator (`https://facilitator.bankofai.io`) `/fee/quote → /verify → /settle`. Facilitator pays chain gas; user pays the principal only.
- `exact_gasfree` (TRON only) → in-process GasFree submit (`/<network>/api/v1/gasfree/submit`). Provider deducts a flat ~0.1 USDT relayer fee.

## Environment variables

| Var | Purpose |
|---|---|
| `TRON_PRIVATE_KEY` | TRON wallet key for `--wallet env` |
| `EVM_PRIVATE_KEY` | EVM wallet key for `--wallet env` |
| `TRON_GRID_API_KEY` | Optional, forwarded to SDK for TronGrid |
| `X402_OUTPUT` | `human` (default) or `json` |
| `X402_FACILITATOR_URL_OVERRIDE` | **e2e only**; emits a stderr warning when active |

## Development

```bash
pnpm --filter @bankofai/x402-cli build
pnpm --filter @bankofai/x402-cli test
node typescript/packages/cli/dist/index.js server --help
```

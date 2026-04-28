# @bankofai/x402-cli

BankofAI x402 command-line tool.

> **Status:** MVP implemented for BankofAI TRON/BSC `exact_permit`, BSC `exact`, and TRON GasFree fallback/server flows.

Source spec: [`specs/002-bankofai-cli/bankofai-cli.md`](../../../specs/002-bankofai-cli/bankofai-cli.md). Implementation decisions: [`specs/002-bankofai-cli/notes/decisions.md`](../../../specs/002-bankofai-cli/notes/decisions.md).

## Install

```bash
pnpm --filter @bankofai/x402-cli build
pnpm --filter @bankofai/x402-cli x402 -- --help
```

Once published:

```bash
npm install -g @bankofai/x402-cli
x402 --help
```

## First-run flow

```bash
# 1. Create the default profile (nile / TRON / exact_permit, with mainnet preset)
x402 config init

# 2. Wire a wallet + verify our facilitator is reachable
export TRON_PRIVATE_KEY=0x...   # for tron:* networks
export EVM_PRIVATE_KEY=0x...    # for eip155:* networks
x402 doctor

# 3. Inspect chain balance + GasFree state (chain-truthed; --verbose unmasks)
x402 balance --json

# 4. Preview a transfer (no signing, no chain spend)
x402 transfer --to <addr> --amount 1.25 --token USDT --dry-run --json
```

**Recommended fee-free network: BSC testnet (`eip155:97`).** We've
verified `exact_permit` settlement on BSC USDT with `feeAmount=0` —
users sign once, the facilitator pays gas. Pass `--network eip155:97`
or switch profiles.

## Commands

### `x402 config`

```bash
x402 config init [--profile <name>] [--network <id>] [--scheme <s>] [--force]
x402 config use <name>
x402 config get [name]
x402 config set <key> <value>          # e.g. nile.network tron:nile, defaultProfile mainnet
x402 config list
```

The config lives at `~/.x402/config.json` (override via `X402_CONFIG_FILE`).

### `x402 doctor`

```bash
x402 doctor [--profile <name>] [--network <id>] [--json]
```

Runs five checks: Node version, wallet env var, facilitator endpoint reachability, GasFree address info, and token registry sanity. Each check reports `ok` / `warn` / `fail` / `skipped`. Non-fatal: a single failure flips `overall` but the others still run.

### `x402 balance`

```bash
x402 balance [--profile <name>] [--network <id>] [--token <sym>] [--verbose] [--json]
```

Queries the GasFree API for the wallet's account info: main address, derived `gasFreeAddress`, per-asset balance, transfer fee, activation fee, and active flag. Address fields are masked by default; pass `--verbose` for full strings.

The wallet's `gasFreeAddress` is read directly from the API response. Per [`docs/solutions.md` #9](../../../docs/solutions.md), do **not** recursively query that address again — its further `gasFreeAddress` is a different account.

### `x402 transfer`

```bash
x402 transfer --to <address> --amount <decimal> [--token USDT] [--dry-run] [--yes] [--json]
```

Builds local `PaymentRequirements` and signs with the SDK. TRON/BSC `exact_permit` and BSC `exact` call facilitator `verify`/`settle`; the user signs authorization while the settler pays chain gas. If TRON `exact_permit` needs an on-chain approval and that approval fails because the wallet has no TRX/energy, the CLI automatically falls back to `exact_gasfree`. Successful transfers append a local receipt.

### `x402 pay`

```bash
x402 pay <url> [--method GET] [--header 'Key: value'] [--body '{}'] [--dry-run] [--json]
```

Fetches a 402-protected URL. In `--dry-run` mode it only reports the server's `accepts[]`. Without `--dry-run`, the SDK handles the 402 challenge/response and the CLI saves a receipt when settlement succeeds.

### `x402 server`

```bash
x402 server --pay-to <address> --amount <decimal> [--token USDT] [--port 4020]
```

Starts a temporary collection server with `GET /health`, `GET /.well-known/x402-transfer`, and `POST /pay`.

### `x402 request`

```bash
x402 request --to <address> --amount <decimal> [--token USDT] [--format uri|json]
```

Generates an offline transfer request. This command does not sign, read a wallet, or call the facilitator.
If `~/.x402/config.json` does not exist, it falls back to the built-in `nile` defaults. QR output is intentionally post-MVP; use `uri` or `json`.

### `x402 receipt`

```bash
x402 receipt list [--json]
x402 receipt show <payment-id-or-tx>
x402 receipt export --format json|csv
```

Reads the local append-only receipt store at `~/.x402/receipts.jsonl` (override with `X402_RECEIPT_FILE`).

## Schemes & fees — pick the cheapest path for your case

The CLI auto-selects the scheme per `(network, token)` from
[`src/schemes.ts`](src/schemes.ts) when `--scheme` isn't passed. Three
options, in cost order from a user's perspective:

| Scheme | Fee paid by user | Pros | Cons |
|---|---|---|---|
| **`exact`** (ERC-3009) | 0 (facilitator pays chain gas) | Single signature; no allowance setup | Token must implement `transferWithAuthorization` (ERC-3009) |
| **`exact_permit`** (EIP/TIP-712 + transferFrom) | 0 (facilitator pays chain gas) | Works for any EIP-2612 token; one-time approve covers all subsequent transfers | Two-call settlement; first-time approve costs gas |
| **`exact_gasfree`** (TRON only) | 0.1 USDT flat per tx | Works on TRON without a token-side EIP-2612 nor user-side TRX | Fee scales with tx count, not amount; uneconomical for sub-$1 payments |

**Verified live on testnets (2026-04-28):**

- BSC Testnet `exact_permit` USDT, tx `0xe6458fcbf1da1da9a0c638cf68b357982781ae932b6742a02331d2371bfeaf30` — feeAmount=0, user paid only the principal.
- TRON Nile `exact_gasfree` USDT, prior session txs (see git log) — feeAmount=0.1 USDT.

**Known issue: TRON `exact_permit` returns `transaction_failed`** when the BankofAI-hosted facilitator's TRON signer wallet is under-funded on TRX/energy. Verify and signing pass; only the facilitator's broadcast step fails. **This is an ops issue, not SDK / protocol** — TRC-20 USDT's `transferFrom` is fully ERC-20-compliant on Nile (verified). Workaround until facilitator funding is restored: pin `--scheme exact_gasfree` for TRON, or use BSC `exact_permit`. See [`docs/solutions.md` #13](../../../docs/solutions.md).

### GasFree fee details (when actually using `exact_gasfree`)

The hosted GasFree relayer (`facilitator.bankofai.io/<network>`) has two cost components — see [`docs/solutions.md` #11 + #12](../../../docs/solutions.md):

- **`transferFee`** — flat per-tx, ~0.1 USDT on Nile USDT, paid to the GasFree service provider as compensation for the TRX gas they spend broadcasting your settlement. Does **not** scale with the payment amount, so very small payments have a high fee/amount ratio.
- **`activateFee`** — one-time ~1 USDT charged the first time a custodial address is used.

`x402 transfer --dry-run` now reports `feeAsPercentageOfAmount` and warns when the fee is ≥10% of the payment. Below that threshold GasFree is fine; far above it (e.g. an agent paying $0.001 per API call) you are mostly paying the relayer, not the recipient. For those cases, use a network/token that supports `exact_permit` or `exact` settlement, such as BSC testnet USDT/USDC for `exact_permit` or DHLU for `exact`.

`x402 balance` queries the TRC-20 contract directly for the canonical balance (the GasFree API's `assets[].balance` field can lag minutes behind the chain). The output surfaces both `chainBalance` and `apiBalance` so cache lag is visible; trust the chain figure.

## Configuration sources & precedence

| Source | Example |
|---|---|
| CLI flag | `--network tron:nile` |
| Env var | `X402_NETWORK=tron:nile` |
| Profile | `~/.x402/config.json` |
| SDK default | from `@bankofai/x402` config |

CLI flag wins, then env var, then profile, then SDK default.

| Env var | Purpose |
|---|---|
| `X402_PROFILE` | Profile to load (default: `nile`) |
| `X402_NETWORK` | Network override |
| `X402_SCHEME` | Scheme override |
| `X402_TOKEN` | Token symbol override |
| `X402_OUTPUT` | `json` or `human` (default) |
| `X402_CONFIG_FILE` | Path to the config JSON |
| `TRON_PRIVATE_KEY` | TRON wallet key (0x-prefixed hex) |
| `EVM_PRIVATE_KEY` | EVM wallet key for `eip155:*` exact/exact_permit payments |
| `X402_FACILITATOR_URL_OVERRIDE` | **e2e only.** Forces every command onto a non-default facilitator and emits a warning to stderr. |

The CLI never accepts a wallet key as a flag — that would expose it via shell history.

## JSON output envelope

Every command emits the same wrapped shape under `--json` (or `X402_OUTPUT=json`):

```json
{
  "ok": true,
  "command": "balance",
  "network": "tron:nile",
  "result": { /* command-specific */ }
}
```

Failures:

```json
{
  "ok": false,
  "command": "balance",
  "error": {
    "code": "FACILITATOR_UNAVAILABLE",
    "message": "Failed to query GasFree API at https://...",
    "hint": "Check your network or X402_FACILITATOR_URL_OVERRIDE."
  }
}
```

Standardized error codes are listed in [`src/error.ts`](src/error.ts).

## Development

```bash
pnpm --filter @bankofai/x402-cli build
pnpm --filter @bankofai/x402-cli test
node typescript/packages/cli/dist/index.js doctor --json
```

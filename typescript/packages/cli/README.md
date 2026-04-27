# @bankofai/x402-cli

BankofAI x402 command-line tool.

> **Status:** read-only commands first (`config`, `doctor`, `balance`). Signing commands (`transfer`, `pay`, `serve transfer`, `receipt`) ship in subsequent iterations.

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
# 1. Create the default profile (nile / TRON / exact_gasfree)
x402 config init

# 2. Make sure your wallet is wired and our facilitator is reachable
export TRON_PRIVATE_KEY=0x...
x402 doctor

# 3. Inspect your GasFree wallet balance
x402 balance --json
```

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

## GasFree economics — read this before paying

The default `nile` profile uses `exact_gasfree` on TRON. GasFree has two cost components users should know about (see [`docs/solutions.md` #11 + #12](../../../docs/solutions.md)):

- **`transferFee`** — flat per-tx, ~0.1 USDT on Nile USDT, paid to the GasFree service provider as compensation for the TRX gas they spend broadcasting your settlement. Does **not** scale with the payment amount, so very small payments have a high fee/amount ratio.
- **`activateFee`** — one-time ~1 USDT charged the first time a custodial address is used.

`x402 transfer --dry-run` now reports `feeAsPercentageOfAmount` and warns when the fee is ≥10% of the payment. Below that threshold GasFree is fine; far above it (e.g. an agent paying $0.001 per API call) you are mostly paying the relayer, not the recipient. For those cases, fall back to `exact` (ERC-3009) where the user pays their own TRX gas but there is no flat relayer fee.

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
| `EVM_PRIVATE_KEY` | EVM wallet key (post-MVP) |
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

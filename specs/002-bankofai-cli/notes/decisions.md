# Decisions — `002-bankofai-cli`

Open items in [`bankofai-cli.md`](../bankofai-cli.md) that block coding. Each entry: **Decision** (what we'll do for MVP) + **Rationale** + **Revisit when** (the trigger that would push us off MVP). The spec stays untouched; this file is the working log.

## D1. Wallet source for MVP — **env var**

**Decision.** MVP reads the signer key from environment variables, **not** from a config file, keychain, or `@bankofai/agent-wallet`:

```text
TRON_PRIVATE_KEY  — 0x-prefixed hex, used when network starts with "tron:"
EVM_PRIVATE_KEY   — 0x-prefixed hex, used when network starts with "eip155:"
```

If the relevant variable is unset, the command fails with `WALLET_NOT_AVAILABLE` (already enumerated in `bankofai-cli.md` § "标准错误码").

**Rationale.**
- Matches existing SDK env conventions (`FACILITATOR_TRON_PRIVATE_KEY`, `BSC_TESTNET_CLIENT_KEY`, etc. — same naming family).
- No platform-specific code (Keychain on macOS, libsecret on Linux, DPAPI on Windows are three different things; `keytar` adds a native dep).
- `@bankofai/agent-wallet` integration is unspecified at the package level; pulling it in blocks MVP on another package's API.
- Encrypted JSON keystore needs a password-derivation design we don't have yet.

**Mitigations carried into the spec.**
- The CLI **rejects** `--private-key` (already in spec § "安全边界"). Env var is the only path.
- `x402 doctor` reports `wallet: <address> ok` only after a successful signer derivation, so misconfig is loud.
- README will warn that env var leaks via shell history (e.g. inline `TRON_PRIVATE_KEY=0x... x402 transfer …`); recommend `direnv`, a sourced `.env`, or `read -s` into the env.

**Revisit when.** Any of: (a) we get a real `@bankofai/agent-wallet` package; (b) a user reports a leaked key from shell history; (c) we ship for non-developer end-users.

## D2. `--json` envelope — **wrapped, single shape**

**Decision.** All commands emit the **wrapped envelope** described in `bankofai-cli.md` § "输出格式":

```json
{
  "ok": true,
  "command": "transfer",
  "network": "tron:nile",
  "scheme": "exact_gasfree",
  "result": {
    /* command-specific payload */
  }
}
```

Failure shape stays as the spec already defines:

```json
{
  "ok": false,
  "command": "transfer",
  "error": { "code": "...", "message": "...", "hint": "..." }
}
```

**Specifically supersedes** the flat `pay` shape illustrated mid-spec (`{ "ok": true, "status": 200, "scheme": "...", … }`). The HTTP status, scheme, network, and `paymentResponse` all move under `result`:

```json
{
  "ok": true,
  "command": "pay",
  "network": "tron:nile",
  "scheme": "exact_gasfree",
  "result": {
    "status": 200,
    "token": "USDT",
    "amount": "100000",
    "amountDisplay": "0.1 USDT",
    "paymentResponse": { "success": true, "transaction": "..." },
    "responseBody": "..."
  }
}
```

**Rationale.** One envelope means one parser for Agent / shell consumers. `command` discriminator lets a generic Agent route results without sniffing fields. `network` and `scheme` always at envelope level so they're greppable / jq-friendly across all command types. The "flat" shape was just an early example; consolidating now is cheaper than later.

**Revisit when.** Never expected — but if the wrapped envelope ever has more than ~5 top-level fields beyond `result`, we should split.

## D3. Environment-variable namespace — **`X402_*` for config, native for secrets**

**Decision.** Two tiers:

**Tier A — `X402_*` for non-secret configuration overrides** (parallels CLI flags, lower precedence than flags, higher than the profile):

```text
X402_PROFILE             — name of the profile to load (default: "nile")
X402_NETWORK             — network override, e.g. "tron:nile"
X402_SCHEME              — scheme override, e.g. "exact_gasfree"
X402_FACILITATOR_URL     — facilitator base URL override
X402_GASFREE_API_URL     — GasFree API base URL override
X402_TOKEN               — default token symbol
X402_MAX_AMOUNT          — smallest-unit cap for `pay`
X402_OUTPUT              — "human" (default) or "json"; equivalent to --json
X402_RECEIPT_FILE        — receipt JSONL path (default: ~/.x402/receipts.jsonl)
X402_CONFIG_FILE         — config JSON path (default: ~/.x402/config.json)
```

**Tier B — native names for secrets** (matches existing SDK / e2e conventions, intentionally NOT under `X402_*`):

```text
TRON_PRIVATE_KEY         — wallet key for tron:* networks
EVM_PRIVATE_KEY          — wallet key for eip155:* networks
TRON_GRID_API_KEY        — optional, forwarded to SDK for TronGrid RPC
```

**Precedence (re-affirmed).** CLI flag → env var → profile → SDK default. CLI flags always win; env vars override the profile; profile overrides SDK defaults.

**Rationale.**
- `X402_*` namespace prevents accidental collision with third-party tools and signals "this is x402 CLI's own setting".
- Keeping wallet keys under their native names (`TRON_PRIVATE_KEY`, `EVM_PRIVATE_KEY`) means a single `.env` works across SDK, e2e harness, and CLI. Forcing a rename to `X402_TRON_PRIVATE_KEY` would create three places to set the same secret.
- `X402_OUTPUT` lets non-interactive runs pin JSON output without a flag, useful for systemd / cron / CI.

**Revisit when.** If we ever support a non-x402 protocol from the same CLI binary, we'd need to revisit — but that's out of MVP scope.

## Open items deferred (NOT blocking MVP)

These can be answered while implementing:

| Item | Where | Default for MVP |
|---|---|---|
| `x402 inspect transfer` semantics | spec § "x402 inspect" | Same as `transfer --dry-run`: print resolved requirements + facilitator fee_quote + GasFree balance check, **never** sign/settle |
| Receipt file rotation | spec § "receipt" | None for MVP. JSONL grows unbounded. Document in README; revisit when file > 10 MB |
| Non-GasFree `doctor` (BSC profile) | spec § "x402 doctor" | Skip the GasFree-specific checks and warn-not-fail when profile.scheme ≠ `exact_gasfree`. Still verify wallet, facilitator, RPC |
| `pay --body @file` 402 retry replay | spec § "x402 pay" | Read body fully into memory before first request; replay from buffer on retry. Document `--body @-` (stdin) as not supported in MVP |
| `serve transfer` graceful shutdown | spec § "x402 serve transfer" | `SIGINT` / `SIGTERM` → flush in-flight settle calls, then exit 0. Outstanding (issued but not paid) challenges are dropped (memory-only by design) |

## Next step

With D1 / D2 / D3 fixed, implementation can start. Suggested commit boundary for the first PR (no wallet signing yet): `config init/use/get` + `doctor` (read-only against BankofAI Nile) + `balance --gasfree` (read-only). That demonstrates the CLI shell, profile loader, output envelope, and SDK-import path — without touching anything that needs a private key. `transfer`, `pay`, `serve transfer`, `receipt` follow once the read-only path is solid.

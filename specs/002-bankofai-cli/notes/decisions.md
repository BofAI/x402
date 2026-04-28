# Decisions — `002-bankofai-cli`

Open items in [`bankofai-cli.md`](../bankofai-cli.md) that block coding. Each entry: **Decision** (what we'll do for MVP) + **Rationale** + **Revisit when** (the trigger that would push us off MVP). The spec stays untouched; this file is the working log.

## D1. Wallet source — **agent-wallet first, env fallback**

**Decision.** Product-facing CLI design uses BankofAI `agent-wallet` as the primary wallet source. The CLI resolves the active wallet for the target network and wraps it in the SDK signer:

```text
tron:*   -> agent-wallet active TRON wallet -> TronClientSigner
eip155:* -> agent-wallet active EVM wallet  -> EvmClientSigner
```

Developer fallback remains environment variables, **not** config file fields and never CLI flags:

```text
TRON_PRIVATE_KEY  — 0x-prefixed hex, used when network starts with "tron:"
EVM_PRIVATE_KEY   — 0x-prefixed hex, used when network starts with "eip155:"
```

Resolution order:

```text
agent-wallet active wallet -> env private key fallback -> WALLET_NOT_AVAILABLE
```

If neither source is available, the command fails with `WALLET_NOT_AVAILABLE` (already enumerated in `bankofai-cli.md` § "标准错误码").

**Rationale.**
- `agent-wallet` is the correct product abstraction: keys are not copied into CLI config and users do not have to export raw secrets for normal use.
- Env fallback keeps local development, CI, and e2e flows simple and matches existing SDK env conventions (`FACILITATOR_TRON_PRIVATE_KEY`, `BSC_TESTNET_CLIENT_KEY`, etc.).
- No platform-specific code (Keychain on macOS, libsecret on Linux, DPAPI on Windows are three different things; `keytar` adds a native dep).
- Encrypted JSON keystore needs a password-derivation design we don't have yet.

**Mitigations carried into the spec.**
- The CLI **rejects** `--private-key` (already in spec § "安全边界"). Env var is the only path.
- `x402 doctor` reports `wallet: <address> ok` only after a successful signer derivation, so misconfig is loud.
- README will warn that env var leaks via shell history (e.g. inline `TRON_PRIVATE_KEY=0x... x402 transfer …`); recommend `direnv`, a sourced `.env`, or `read -s` into the env.

**Revisit when.** Any of: (a) `agent-wallet` active wallet semantics change; (b) we need multiple wallets per network / account selection; (c) we ship non-developer UX that needs keychain-backed fallback instead of env vars.

## D2. `--json` envelope — **wrapped, single shape**

**Decision.** All commands emit the **wrapped envelope** described in `bankofai-cli.md` § "输出格式":

```json
{
  "ok": true,
  "command": "transfer",
  "network": "tron:nile",
  "scheme": "exact_permit",
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
  "scheme": "exact_permit",
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

**Endpoint exception.** Facilitator/GasFree endpoints do **not** use normal user-facing env overrides. D4 locks them to BankofAI-hosted URLs derived from `network`, with the internal-only `X402_FACILITATOR_URL_OVERRIDE` escape hatch for e2e.

**Rationale.**
- `X402_*` namespace prevents accidental collision with third-party tools and signals "this is x402 CLI's own setting".
- Keeping wallet keys under their native names (`TRON_PRIVATE_KEY`, `EVM_PRIVATE_KEY`) means a single `.env` works across SDK, e2e harness, and CLI. Forcing a rename to `X402_TRON_PRIVATE_KEY` would create three places to set the same secret.
- `X402_OUTPUT` lets non-interactive runs pin JSON output without a flag, useful for systemd / cron / CI.

**Revisit when.** If we ever support a non-x402 protocol from the same CLI binary, we'd need to revisit — but that's out of MVP scope.

## D4. Facilitator endpoint — **locked to BankofAI hosted**

**Decision.** The CLI talks to **BankofAI's hosted facilitator only**. The URL is derived from the chosen `network`, not configured per-profile and not surfaced as a CLI flag in normal help:

```text
tron:mainnet  → https://facilitator.bankofai.io/mainnet
tron:shasta   → https://facilitator.bankofai.io/shasta
tron:nile     → https://facilitator.bankofai.io/nile
eip155:*      → https://facilitator.bankofai.io  (root URL; no per-chain slug)
```

**Specifically supersedes** the spec's profile example which shows `"facilitatorUrl": "..."` per profile and the per-command `--facilitator-url <url>` flag listed under `pay` / `transfer` flags. Both are dropped from the user-facing surface.

**Mechanism in code.** Add a `getFacilitatorBaseUrl(network)` helper in the CLI (or hoist into `@bankofai/x402` config like the existing `getGasFreeApiBaseUrl`). All commands resolve the facilitator URL from `network` alone — no manual override path in normal use.

**Escape hatch — internal only.** A single env var, `X402_FACILITATOR_URL_OVERRIDE`, lets the e2e harness (and only the e2e harness) point the CLI at a local `examples/facilitator/` instance. Not advertised in `--help`, mentioned only in `e2e/CLAUDE.md` and the CLI README's troubleshooting section. If set, every command logs a one-line warning to stderr ("CLI facilitator override active: <url>") so it's never silent.

**Rationale.**
- Brand & product cohesion: BankofAI x402 CLI talks to BankofAI's facilitator. Letting users swap in Coinbase / Cloudflare / self-hosted dilutes the product story and shifts support burden to us for endpoints we don't run.
- Reliability story is concrete: we know exactly which facilitator the CLI hits, so SLAs and runbooks have one target.
- Less to teach: zero `--facilitator-url` in the docs, in `pay --help`, in the profile schema. Users learn one thing — `network` — and the rest follows.
- Backward path: adding an override flag later is cheap. Removing one (after users depend on it) is hard. Lock first; expand later only if real demand surfaces.

**What we lose.** Power users running their own facilitator can't use the CLI without the env-var workaround. That's accepted; the CLI is for the BankofAI default flow, not for facilitator-operator self-service.

**Revisit when.** Any of: (a) we publish a facilitator-operator product / SDK and need first-party support; (b) Linux Foundation x402 spec mandates client-side facilitator selection (currently it doesn't); (c) repeated user requests for non-BankofAI facilitator support in standard flows.

## Open items deferred (NOT blocking MVP)

These can be answered while implementing:

| Item | Where | Default for MVP |
|---|---|---|
| `x402 inspect transfer` semantics | spec § "x402 inspect" | Same as `transfer --dry-run`: print resolved requirements + facilitator fee_quote + GasFree balance check, **never** sign/settle |
| Receipt file rotation | spec § "receipt" | None for MVP. JSONL grows unbounded. Document in README; revisit when file > 10 MB |
| Non-GasFree `doctor` (BSC profile) | spec § "x402 doctor" | Skip the GasFree-specific checks and warn-not-fail when profile.scheme ≠ `exact_gasfree`. Still verify wallet, facilitator, RPC |
| `pay --body @file` 402 retry replay | spec § "x402 pay" | Read body fully into memory before first request; replay from buffer on retry. Document `--body @-` (stdin) as not supported in MVP |
| `server` graceful shutdown | spec § "x402 server" | `SIGINT` / `SIGTERM` → flush in-flight settle calls, then exit 0. Outstanding (issued but not paid) challenges are dropped (memory-only by design) |

## Implementation status as of 2026-04-27

Implemented in `typescript/packages/cli`:

- `config init/use/get/set/list`
- `doctor`
- `balance`
- `transfer`
  - TRON `exact_permit` via facilitator verify/settle
  - TRON `exact_permit` approval failure auto-falls back to `exact_gasfree`
  - TRON `exact_gasfree` fallback via GasFree submit/poll
  - BSC/EVM `exact_permit` / `exact` via facilitator verify/settle
- `pay`
  - TRON `exact_permit` and `exact_gasfree`
  - BSC/EVM `exact_permit` / `exact`
- temporary collection server implementation; public command target is `x402 server`
- `request`
- `receipt list/show/export`

Validation trajectory:

- `pnpm --filter @bankofai/x402-cli test` passes (`111` tests).
- `pnpm --filter @bankofai/x402-cli build` passes.
- Built CLI smoke-tested with `x402 --help` and `x402 request --json`.
- Live `x402 transfer` on TRON Nile passed with tx
  `9782fa046af5fcb8e2704a7a5cf08340729d85f2660bf99db58311cb9d09be0d`.
- Live `x402 pay` passed against local `x402 server` example flow with tx
  `8427efa56b5ef311f4125a886df40b6a6415707dc0a57cc8ab780d09d91777d0`.

Remaining before a release PR:

- QR rendering stays post-MVP. `x402 request` supports only `--format uri|json`.

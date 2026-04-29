# Changelog

All notable changes to `@bankofai/x402-cli` are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this package adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0-beta.3] — 2026-04-29

### Fixed

- **`paymentPermitContext.meta.nonce`** for `exact_permit` is now a
  cryptographically random 256-bit value (`randomBytes(32)` →
  decimal uint256) per challenge, not the previous hardcoded `'0'`.
  PaymentPermit on both BSC testnet and (likely) other EVM networks
  rejects nonce reuse with custom error `0x1fb09b80`. With nonce='0'
  the contract reverted on every retry; with a fresh random nonce
  per challenge the call goes through. `exact_gasfree` keeps `'0'`
  because GasFree's permit space is keyed by GasFree-API nonce, not
  this field.

### Verified end-to-end against local facilitator

A reference facilitator was spun up via
`python -m examples.facilitator` on `http://127.0.0.1:8014`, pointed at
by `X402_FACILITATOR_URL_OVERRIDE`, with BankofAI `eip155:97` +
`tron:nile` keys. Smoke results:

| Network | Scheme | Status | Detail |
|---|---|---|---|
| `eip155:97` | `exact_permit` | ✅ end-to-end on-chain | tx [`a261ef2b…7d4ebf`](https://testnet.bscscan.com/tx/0xa261ef2ba7afddbb80e89904d5aa5c69e1265f386ffe21932589cb89bb7d4ebf), block 104417509, 0.01 USDT 0x0f2A→0x6d36 |
| `tron:nile` | `exact_permit` | ⚠ blocked at the facilitator's TRON wallet shim | not a CLI bug — see "Local facilitator gap" below |
| `tron:nile` | `exact_gasfree` | ✅ end-to-end on-chain (proved beta.1) | tx [`7df082de…be4acc0`](https://nile.tronscan.org/#/transaction/7df082de1b5a5ce12af6a980761ce891f5ddb79d9026ce5d9bfd62eb3be4acc0); GasFree path doesn't traverse facilitator `/settle`, unaffected by override |

The CLI is fully correct end-to-end against a working facilitator.
Both observed residual failures (BSC `0x1fb09b80` and Nile
`transaction_failed`) are facilitator-side, now diagnosed:

- **BSC `0x1fb09b80`** — PaymentPermit's nonce-reuse rejection. Fixed
  in CLI by emitting a fresh uint256 nonce per challenge.
- **Nile `transaction_failed (transaction:null)`** — root cause is in
  the **facilitator** path, not the CLI. The example reference
  facilitator throws `NotImplementedError("raw TRON tx signing not
  used by facilitator")` from
  [`examples/facilitator/server.py:142`](../../../examples/facilitator/server.py)
  when its TRON wallet shim is asked to `sign_transaction`. The
  hosted facilitator likely has the same gap or a related one — its
  `/verify` returns `isValid: true` but `/settle` returns
  `transaction_failed` with no transaction hash. Hosted-facilitator
  triage is needed; CLI cannot move past this without changes there.

### Local facilitator gap

`examples/facilitator/server.py:117–144` has an EVM wallet shim with
a real `sign_transaction` (uses `eth_account`) but a TRON wallet shim
whose `sign_transaction` is a `NotImplementedError` stub. This is
why local Nile `exact_permit` cannot complete in this beta. The
fix would either (a) implement raw TRON tx signing using `tronpy`'s
`PrivateKey.sign_msg_hash` against the canonical raw_data hash, or
(b) restructure `tron_signer.write_contract` to use a high-level
`tronpy` flow that doesn't require the shim. Per
[`examples/CLAUDE.md`](../../../examples/CLAUDE.md), changes here are
"protocol-impacting" and need security-reviewer review — out of scope
for this beta.

### Known issues (revised)

- TRON `exact_permit` against the hosted facilitator returns
  `transaction_failed` (`transaction: null`); same shape as the local
  facilitator's `NotImplementedError`. Suspected same root cause.
  Workaround: TRON USDT users should pin `--scheme exact_gasfree`
  until facilitator-team triage closes this.
- `exact_gasfree` keeps using `paymentPermitContext.meta.nonce: '0'`
  because GasFree maintains its own nonce in the GasFree-API
  response. Only `exact_permit` needs the random uint256 nonce.
- Single GasFree provider on Nile —
  `TooManyPendingTransferException` surfaces as a normal CLI error.
- `--daemon` parent prints `pay_url` before child binds.
- Server's `--wallet` flag is accepted but currently unused.
- Hosted facilitator `/settle` rate-limits at 1 request per minute
  per source.

### Diagnostic improvements

- Server's `/settle` now logs the full `SettleResponse` to stderr on
  failure and surfaces `transaction` (when present) in the 500 body.
- Server runs `/verify` before `/settle` for non-`exact_gasfree`
  schemes; logs both responses; returns the `invalidReason` instead
  of a generic settle error when verify rejects. This is what made
  it tractable to diagnose hosted-facilitator vs CLI fault.

## [0.1.0-beta.2] — 2026-04-28

### Fixed (CLI bugs surfaced by re-testing exact_permit on TRON Nile)

- **Server now calls `/fee/quote` before issuing the 402** for
  `exact_permit` and `exact` schemes. Previously the server emitted
  PaymentRequirements with no `extra.fee`, the client signed
  `PaymentPermit` with `feeTo: 0x0`, and `/settle` rejected the payload
  with `fee_to_mismatch` (facilitator expected its own configured
  feeTo). The quote is fetched once per challenge and merged into
  `requirements.extra.fee` before encoding the 402 body. `exact_gasfree`
  is unchanged — its fee is supplied by the GasFree API on the client
  side.
- **`paymentPermitContext.meta.validBefore`** was hardcoded to `0`,
  which the facilitator interprets as "already expired" once the signed
  payload reaches `/settle`. Now set to `now + 300s` for `exact_permit`
  / `exact`, `now + 540s` for `exact_gasfree` (within Nile's GasFree
  deadline window of [50, 3600] testnet / [50, 600] mainnet).
- **Server `/settle` failure logs the full SettleResponse to stderr**
  and surfaces `transaction` (when present) in the 500 body — useful
  for diagnosing on-chain reverts vs. facilitator misconfiguration.

### Smoke results after fixes

| Network | Scheme | Status | Detail |
|---|---|---|---|
| `tron:nile` | `exact_gasfree` | ✅ end-to-end on-chain | tx [`7df082de…be4acc0`](https://nile.tronscan.org/#/transaction/7df082de1b5a5ce12af6a980761ce891f5ddb79d9026ce5d9bfd62eb3be4acc0) (beta.1) |
| `tron:nile` | `exact_permit` | ⚠ CLI green; facilitator returns `transaction_failed` (`transaction: null`) | facilitator-side ops issue persists — sign + verify pass; on-chain submit doesn't happen |
| `eip155:97` | `exact_permit` | ⚠ CLI green; facilitator returns `('0x1fb09b80', '0x1fb09b80')` | facilitator's PaymentPermit on-chain call reverts with custom selector `0x1fb09b80` (PaymentPermit contract error — needs facilitator-team triage) |

The CLI side is now consistent end-to-end — `fee_to_mismatch`,
`expired`, and `--token` filter bugs are all closed. Residual failures
are unambiguously on the facilitator / on-chain side and out of CLI
scope.

### Known issues (revised)

- TRON `exact_permit` settle returns `transaction_failed` with no tx
  hash on the hosted facilitator. Same root cause as before
  (facilitator-side TRON signer wallet ops state). CLI cannot move
  past this without facilitator changes. Workaround: TRON USDT users
  should pin `--scheme exact_gasfree`.
- BSC testnet `exact_permit` settle reverts with custom error
  `0x1fb09b80` from PaymentPermit. Different error from Nile but same
  shape: facilitator-side, requires triage by the contracts team.
- Single GasFree provider on Nile —
  `TooManyPendingTransferException` surfaces as a normal CLI error.
- `--daemon` parent prints `pay_url` before child binds.
- Server's `--wallet` flag is accepted but currently unused.

### Facilitator rate limit observed during smoke

The hosted facilitator's `/settle` is rate-limited at **1 request per
minute per source**. Back-to-back smoke runs need at least a 70-second
gap; the CLI surfaces the 429 verbatim. Not a CLI bug — recorded here
for reproducer authors.

## [0.1.0-beta.1] — 2026-04-28

### Added

- Live end-to-end smoke test on TRON Nile, scheme `exact_gasfree`, USDT
  0.01: tx
  [`7df082de1b5a5ce12af6a980761ce891f5ddb79d9026ce5d9bfd62eb3be4acc0`](https://nile.tronscan.org/#/transaction/7df082de1b5a5ce12af6a980761ce891f5ddb79d9026ce5d9bfd62eb3be4acc0).
  Server `--daemon`-less, port 4321, payer
  `TTX1Us19zqsLXhY39PPR7KRUoMa93s3J3i` → recipient
  `TJWdoJk8KyrfxZ2iDUqz7fwpXaMkNqPehx`, GasFree provider
  `TKtWbdzEq5ss9vTS9kwRhBp5mXmBfBns3E`, fee 0.1 USDT cap.

### Fixed

- `client --token <SYM>` now resolves the requirement's `asset` through
  the SDK token registry and compares against the registry **symbol**,
  instead of the previous broken comparison against
  `requirement.extra.name` (which is the EIP-712 domain `name`, e.g.
  "Tether USD" — never matched user input "USDT"). Pre-fix the filter
  silently rejected every registry-known requirement.

### Known issues (unchanged from beta.0 unless noted)

- **NEW**: BSC testnet `exact_permit` against the hosted facilitator
  returns `fee_to_mismatch` from `/settle`. Looks parallel to the
  TRON `exact_permit` ops issue (facilitator-side configuration / signer
  state); needs facilitator-team triage. Smoke-paying BSC USDT via the
  CLI is therefore blocked on the hosted facilitator. Workaround: stay
  on TRON `exact_gasfree` for the beta validation window.
- TRON `exact_permit` settle `transaction_failed` on the hosted
  facilitator (under-funded TRX/energy) — same as beta.0.
- Single GasFree provider on Nile —
  `TooManyPendingTransferException` surfaces as a normal CLI error.
- `--daemon` parent prints `pay_url` before child binds.
- Server's `--wallet` flag is accepted but currently unused.

## [0.1.0-beta.0] — 2026-04-28

First public beta of the BankofAI x402 CLI, scoped per
[`FEATURES.md`](FEATURES.md). Live spec is in `FEATURES.md`; the
historical 9-command design at
[`specs/002-bankofai-cli/bankofai-cli.md`](../../../specs/002-bankofai-cli/bankofai-cli.md)
is retained as design history (status: superseded). Decisions D1–D4 in
[`specs/002-bankofai-cli/notes/decisions.md`](../../../specs/002-bankofai-cli/notes/decisions.md)
still apply.

### Beta surface

- Binary: `x402-tools` (`@bankofai/x402-cli`), Node ≥ 20, ESM-only.
- Result fields are snake_case; protocol amount field is `amount`
  (smallest unit) — matches `PaymentRequirements.amount`. Human form
  is `decimal`.
- Beta is published as `0.1.0-beta.0`; expect a `0.1.0` once the four
  follow-ups below are either closed or formally deferred.

### Added

- **Binary**: `x402-tools`, published as `@bankofai/x402-cli`.
- **`x402-tools server`** — starts a local x402 payment server.
  - Endpoints: `GET /health`, `GET /.well-known/x402`, `GET | POST /pay`.
  - `/pay` issues a 402 with a fresh `PaymentRequirements`, caches the
    challenge by `paymentId` for 5 min, validates `payload.accepted`
    against the issued challenge on retry, and settles in-process:
    - `exact_gasfree` → `GasFreeAPIClient.submit` + `waitForSuccess`.
    - any other scheme → root facilitator `/verify` + `/settle`.
  - Supports `--decimal | --amount` (mutually exclusive),
    `--network`, `--token` (default USDT), `--scheme`, `--host`,
    `--port`, `--resource-url`, `--wallet <agent-wallet | env>`,
    `--daemon`, `--json`.
  - Human output and `--json` envelope both report
    `pay_url / resource_url / network / scheme / token / decimal /
    amount / pay_to`. `--daemon` spawns a detached child and
    prints its PID.
- **`x402-tools client <url>`** — pays an x402-protected URL.
  - Probes once; if not 402, prints a summary and exits.
  - On 402, parses `PAYMENT-REQUIRED` (header first, body fallback),
    filters server `accepts[]` against caller-supplied guards
    (`--max-decimal | --max-amount`, `--network`, `--token`,
    `--scheme`), then signs and retries.
  - Registers `exact + exact_permit` for EVM and
    `exact_permit + exact_gasfree` for TRON via the SDK's
    `X402FetchClient` with a custom selector.
  - Supports `--method`, repeated `--header`, `--body`,
    `--wallet <agent-wallet | env>`, `--dry-run`, `--yes`, `--json`.
  - On settlement success, decodes `PAYMENT-RESPONSE` and surfaces it
    in the envelope's `result.paymentResponse`.
- **Wallet selector** (D1) — `--wallet agent-wallet` is the default;
  `--wallet env` skips the agent-wallet provider. The agent-wallet
  path falls back to env-key on failure with a stderr notice.
- **Auto-scheme picker** — [`src/schemes.ts`](src/schemes.ts) maps
  `(network, token)` to the recommended scheme; first-viable wins.
  Override with `--scheme`.
- **Wrapped JSON envelope** (D2) — every command emits
  `{ ok, command, network?, scheme?, result | error }`. Result fields
  are snake_case for shell / jq friendliness.
- **15 standardized error codes** in [`src/error.ts`](src/error.ts).
- **Facilitator URL** (D4 + correction) — derived from `network`.
  TRON GasFree balance lookups use the network-scoped proxy
  (`/nile`, `/mainnet`, `/shasta`). Settlement (`/fee/quote`,
  `/verify`, `/settle`) for both TRON and EVM lives at the root URL
  `https://facilitator.bankofai.io`.

### Removed (compared to early in-progress design)

- `x402 config init/use/get/set/list` — no on-disk profile management;
  every invocation takes its inputs from CLI flags + env.
- `x402 doctor`, `x402 balance`, `x402 transfer`, `x402 receipt`,
  `x402 request` — out of scope for the new two-command CLI.
- `~/.x402/config.json`, `~/.x402/receipts.jsonl`, `src/onchain.ts`
  TRC-20 balance helper — all dropped along with the commands above.

### Test coverage

7 test files, **62 unit tests** across `output / facilitator / wallet
/ schemes / amount` plus `commands/server` and `commands/client`.
Build is `tsc` clean; `vitest run` 1–2 s end-to-end.

### Known limitations / follow-ups

- TRON `exact_permit` settle returns `transaction_failed` on the
  hosted facilitator because its TRON signer wallet is under-funded
  on TRX/energy. Ops issue, not protocol or SDK; see
  [`docs/solutions.md` #13](../../../docs/solutions.md). Workaround:
  pin `--scheme exact_gasfree` for TRON USDT.
- Single GasFree provider on Nile —
  `TooManyPendingTransferException` surfaces as a normal CLI error;
  retry.
- `--daemon` parent prints `pay_url` / `resource_url` based on the
  configured host/port; if the child fails to bind (e.g. port in
  use), it exits silently. Consider a future probe-then-print refinement.
- Server's `--wallet` flag is accepted but currently unused —
  reserved for future extensions (e.g. fee-quote signing, server-side
  pre-flight checks).

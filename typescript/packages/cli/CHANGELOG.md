# Changelog

All notable changes to `@bankofai/x402-cli` are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this package adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-04-28 (unreleased)

First public iteration of the BankofAI x402 CLI. Spec:
[`specs/002-bankofai-cli/bankofai-cli.md`](../../../specs/002-bankofai-cli/bankofai-cli.md).

### Added

- **CLI shell** built on `commander`, single-binary `x402` published as
  `@bankofai/x402-cli`. Wrapped JSON envelope (`{ ok, command, network,
  scheme, result | error }`) on every command via `--json` or
  `X402_OUTPUT=json`.
- **Profile management**: `x402 config init / use / get / set / list`.
  Default config at `~/.x402/config.json` (override with
  `X402_CONFIG_FILE`). Default profile is `nile` (TRON Nile / USDT /
  `exact_permit`); a `mainnet` preset is shipped alongside.
- **Read-only diagnostics**:
  - `x402 doctor` — Node version + wallet env + facilitator reachability
    + GasFree address info + token registry sanity. Each check independent;
    a single failure flips `overall` but the others still run.
  - `x402 balance` — main address + derived `gasFreeAddress` + per-asset
    on-chain balance (queried via TRC-20 `balanceOf`, not the GasFree API
    `assets[].balance` which can lag), plus transferFee/activateFee.
    Surfaces an `apiBalanceStale` flag and a stderr warning when chain
    and API disagree.
- **Direct payment**:
  - `x402 transfer` — builds `PaymentRequirements` locally and routes:
    - **BSC + EVM** (`exact`, `exact_permit`) → root facilitator
      `/fee/quote /verify /settle`. **Zero relayer fee.** Verified live
      on BSC Testnet (`exact_permit`, USDT, tx
      `e6458fcbf1da1da9a0c638cf68b357982781ae932b6742a02331d2371bfeaf30`,
      feeAmount=0).
    - **TRON GasFree** (`exact_gasfree`) → in-process GasFree submit
      (`GasFreeAPIClient.submit` + `waitForSuccess`). 0.1 USDT relayer
      fee per tx (set by GasFree contract, not us).
    - **TRON `exact_permit`** is the new default for tron:* USDT but
      currently fails at on-chain settle (TRC-20 USDT `transferFrom`
      revert; documented in [solutions.md #13](../../../docs/solutions.md)).
      The CLI auto-falls-back to `exact_gasfree` when allowance approval
      fails.
  - `--dry-run` returns the resolved plan + live `feeAsPercentageOfAmount`
    and warns to stderr when fees ≥ 10% of the payment.
- **HTTP 402 client**:
  - `x402 pay <url>` — wraps SDK's `X402FetchClient`. Registers
    `exact + exact_permit` for EVM and `exact_permit + exact_gasfree`
    for TRON. Selector filters server `accepts[]` by network/scheme and
    optional `--max-amount`.
- **Temporary collection server**:
  - `x402 serve transfer` — Node `http`-based, no framework. Endpoints
    `GET /health`, `GET /.well-known/x402-transfer`, `GET|POST /pay`.
    Caches challenges by `paymentId` for 5 min; validates
    `payload.accepted` against the issued requirements before settle.
    Currently TRON `exact_gasfree` only.
- **Receipts**:
  - `x402 receipt list / show <id-or-tx> / export --format json|csv` —
    JSONL store at `~/.x402/receipts.jsonl` (override
    `X402_RECEIPT_FILE`). Filters: profile / network / scheme / token /
    from / to / limit. Tolerant to malformed lines.
- **Transfer request URI**:
  - `x402 request --to ... --amount ... [--token USDT] [--format
    uri|json]` — offline `x402://transfer?...` URI generator. Does not
    sign, does not read a wallet, does not call the facilitator.
- **Standardized error codes** (15 total) — `WALLET_NOT_AVAILABLE`,
  `PROFILE_NOT_FOUND`, `FACILITATOR_UNAVAILABLE`, `FEE_QUOTE_NOT_FOUND`,
  `VERIFY_FAILED`, `SETTLE_FAILED`, etc. Surfaced under `error.code` in
  the failure envelope.
- **Wallet**: env-var only (`TRON_PRIVATE_KEY` / `EVM_PRIVATE_KEY`). No
  `--private-key` flag, no `agent-wallet` config files, no platform
  keychain. See [decisions.md D1](../../../specs/002-bankofai-cli/notes/decisions.md).
- **Facilitator URL** (D4) — derived from `network`. Single override
  `X402_FACILITATOR_URL_OVERRIDE` for e2e harness; emits a stderr
  warning when active. EVM and TRON non-GasFree settlement both go
  through the root URL `https://facilitator.bankofai.io`.

### Test coverage

- 15 test files, **114 unit tests** across `output / error / config /
  schemes / amount / receipts / wallet / facilitator / onchain` and the
  7 command modules. Build is `tsc` clean; tests are `vitest run`.
- Live-chain validation: BSC Testnet `exact_permit` USDT transfer
  end-to-end (tx
  `0xe6458fcbf1da1da9a0c638cf68b357982781ae932b6742a02331d2371bfeaf30`).
  TRON GasFree end-to-end via `transfer` and `pay ↔ serve transfer`
  (txs in earlier commits' messages).

### Known limitations / follow-ups

- **TRON USDT `exact_permit` settle reverts** on Nile. The signature
  paths through fine; the TRC-20 USDT contract's `transferFrom` does
  not return a standard ERC-20 boolean and the PaymentPermit settler
  treats absence of return data as failure. Track via
  [solutions.md #13](../../../docs/solutions.md). Workaround: pin
  `--scheme exact_gasfree` for TRON USDT until the SDK ships a
  TRON-specific `transferFrom` adapter.
- **No hosted EVM facilitator slug** — the BankofAI facilitator serves
  EVM via the root URL only; per-chain slugs (`/bsc-testnet`, `/bsc`)
  do not exist. Reflected in `getFacilitatorBaseUrl` returning the root
  for any `eip155:*` network.
- **Single GasFree provider on Nile** — `TooManyPendingTransferException`
  surfaces as `SETTLE_FAILED`. Retry; user-side recovery is acceptable.
- **`pay` and `transfer` register only the schemes the CLI knows
  about.** A server offering an unknown scheme will be skipped. Adding
  new schemes ships with new SDK mechanism imports.

### Roadmap (next iteration, not in 0.1.0)

- `x402 inspect` and `x402 request --format qr` (post-MVP per spec).
- TRON `exact` (ERC-3009-equivalent) once an SDK adapter for
  TRC-20-quirks (USDT non-standard return values) lands.
- Receipt rotation / `--receipt-db sqlite:`.
- `serve transfer` for `exact_permit` on EVM (currently TRON GasFree
  only).

# Solutions

Hard-won knowledge from development and debugging. Read this before investigating bugs in related areas.

Use `/x402:compound` to add new entries after solving a problem.

---

### 1. TRON addresses must be converted to EVM hex before EIP-712/TIP-712 signing

- **Category**: signing
- **Severity**: critical
- **Module**: gasfree, mechanisms

**Symptom**: GasFree TIP-712 signatures were invalid on-chain, but no error was raised during signing. Verification silently failed.

**Root cause**: The GasFree SDK returned TRON Base58 addresses in domain and message fields. The TIP-712 spec requires all `address` type fields to be in EVM hex format (0x-prefixed). Passing Base58 addresses produced a valid-looking but wrong signature.

**Fix**: Convert every address field (verifyingContract, token, serviceProvider, user, receiver) to EVM hex format before signing. This applies to both the domain and the message.

**Rule**: Any time you construct an EIP-712/TIP-712 message on TRON, convert ALL address fields to 0x-prefixed EVM hex. Never pass Base58 addresses to signTypedData.

**Ref**: PR #53, commits f85d49c, efc5c54

---

### 2. GasFree deadline has different bounds on mainnet vs testnet

- **Category**: config
- **Severity**: high
- **Module**: gasfree

**Symptom**: GasFree transactions succeeded on Nile testnet but were rejected on mainnet with deadline errors.

**Root cause**: Mainnet providers enforce tighter deadline bounds (50-600s) than testnets (50-3600s). Code was using a single default (e.g., 3600s) across all networks.

**Fix**: Clamp the deadline to network-specific bounds: mainnet [55s, 595s], testnet [55s, 3595s] from current time (with 5s padding on each side). Warn when clamping occurs.

**Rule**: Always respect per-network deadline bounds. If adding a new GasFree-supported network, verify its provider deadline config before using defaults.

**Ref**: PR #56, commits 26afbda, 43989be, 0598035

---

### 3. GasFree balance check must use gasFreeAddress, not the user's main wallet

- **Category**: policy
- **Severity**: high
- **Module**: gasfree, client

**Symptom**: SufficientBalancePolicy filtered out GasFree payment options as "insufficient balance", even though the user had enough funds in their GasFree wallet.

**Root cause**: The policy called `signer.checkBalance()` which checks the user's main wallet. GasFree funds live in a separate custodial wallet (gasFreeAddress). The main wallet can be empty while gasFreeAddress has funds.

**Fix**: The balance check must go through the mechanism (not directly through the signer). The GasFree mechanism overrides `checkBalance` to query the gasFreeAddress balance via the GasFree API.

**Rule**: Never assume all schemes share the same balance source. Always check balance through the mechanism, which knows where the funds are for its scheme.

**Ref**: PR #59, commits b63290e, 91267c1

---

### 4. GasFree API returns null data during early polling

- **Category**: api
- **Severity**: high
- **Module**: gasfree

**Symptom**: Settlement crashed with AttributeError/TypeError immediately after submitting a GasFree transaction, even though the transaction later succeeded on-chain.

**Root cause**: The GasFree status API returns `{"code": 200, "data": null}` when polled too soon after submission. Code assumed `data` was always present when `code == 200`.

**Fix**: Treat null data as "not yet available" — skip and retry on the next poll interval. Also cap consecutive errors (default 3) to avoid infinite retry on persistent failures. Reset the error counter after each successful poll.

**Rule**: GasFree API responses can have `code: 200` with `data: null`. Always null-check `data` before accessing fields. Design polling loops to tolerate transient nulls and HTTP errors.

**Ref**: PR #57, commits 91cb156, 5151639

---

### 5. EIP-712 verify_typed_data requires explicit primary_type

- **Category**: signing
- **Severity**: critical
- **Module**: mechanisms

**Symptom**: Signature verification for the `exact` scheme (ERC-3009) always failed, even with correctly signed payloads.

**Root cause**: The `verify_typed_data` call was missing the `primary_type` parameter. Without it, the verification used the wrong type hash, producing a different digest than what was signed.

**Fix**: Always pass `primary_type` explicitly when calling `sign_typed_data` and `verify_typed_data`. For exact_permit it's `"PaymentPermitDetails"`, for exact it's `"TransferWithAuthorization"`, for GasFree it's `"PermitTransfer"`.

**Rule**: Never rely on defaults for primary_type in EIP-712 signing/verification. Always pass it explicitly — each scheme has a different primary type.

**Ref**: Commits a9dff87, 2b450da, 969b2fa

---

### 6. GasFreeController address differs per network — do not hardcode

- **Category**: config
- **Severity**: high
- **Module**: gasfree, config

**Symptom**: GasFree transactions failed on mainnet after working on Nile. The signed domain referenced the wrong contract address.

**Root cause**: The GasFreeController contract is deployed at different addresses on mainnet, shasta, and nile. Code was using a single hardcoded address.

**Fix**: Look up the controller address from the per-network config map. Add tests that verify mainnet addresses specifically.

**Rule**: All contract addresses (PaymentPermit, GasFreeController, GasFreeBeacon) are per-network. Always resolve from config, never hardcode.

**Ref**: PR #55, commits ed9d89d, b9f3f83

---

### 7. Permit / GasFree facilitator mechanisms need `base_fee` — unset means every token is "Unsupported"

- **Category**: config
- **Severity**: high
- **Module**: facilitator, mechanisms, examples

**Symptom**: `exact_permit_testnet` and `exact_gasfree_testnet` scenarios failed with HTTP 404 at the resource server. Facilitator log repeated `Unsupported token: asset=<addr>, network=<net>`. Route effectively not registered because fee_quote returned None for every token.

**Root cause**: The facilitator mechanisms that extend `BaseExactPermitFacilitatorMechanism` (EVM `exact_permit`, TRON `exact_permit`, TRON `exact_gasfree`) require a `base_fee: dict[str, int]` mapping token symbol → fee in smallest unit. Without it, `self._base_fee_map` is empty and `_get_base_fee()` returns None for every token, which propagates as an Unsupported-token skip. The reference `examples/facilitator/server.py` did not read this from the environment, so every testnet run of permit/gasfree silently skipped all tokens.

**Fix**: `examples/facilitator/server.py` now reads `FACILITATOR_BASE_FEE` as a JSON dict and passes it to every permit/gasfree mechanism at register time. Example: `FACILITATOR_BASE_FEE='{"USDT": 1000, "USDC": 1000, "DHLU": 1000}'` (smallest unit — 1000 at decimals=6 is 0.001 token).

**Rule**: Permit-family mechanisms are **allow-list by symbol**. A token appearing in `TokenRegistry` does NOT imply the facilitator will accept it — the facilitator must also have a `base_fee` entry for that symbol. When adding a new scheme that inherits `BaseExactPermitFacilitatorMechanism`, either (a) wire a base_fee env in your facilitator, or (b) the scheme silently becomes a no-op against every token.

**Ref**: fix on 2026-04-24, commit `<set at commit time>`. Verified live on BSC Testnet: permit tx `0xfc8b32decb99d02cdfc684d3f6f1c7c0a91c8b0ff1f632f98d86d9f334198a23` (block 103475005, USDT at `0x337610d27c682E347C9cD60BD4b3b107C9d34dDd`). BSC testnet USDT does implement EIP-2612 permit — earlier writeup in this entry was a misdiagnosis.

---

### 8. integration runner doesn't expand `${VAR:-default}` shell syntax

- **Category**: tooling
- **Severity**: high
- **Module**: integration, e2e

**Symptom**: Testnet scenarios failed at "wait for resource server" step with the resource server log showing `ValueError: could not convert string to float: '${BSC_TESTNET_PERMIT_PRICE:-0.0001'`. The environment variable default fallback was passed through as a literal string, then split on the space by shlex into an invalid token.

**Root cause**: `integration/commands.py:151` uses `os.path.expandvars()` to substitute `${VAR}` references in `@start_bg` arguments. Python's `expandvars` only recognizes `$VAR` and `${VAR}`; it leaves shell-specific forms like `${VAR:-default}`, `${VAR:+value}`, `${VAR?err}` unchanged. The literal `${VAR:-default}` then reaches shlex.quote → shell.

**Fix**: Drop the `:-default` fallback in scenario `config.json`. `run_testnet.sh` already checks every required env var before invoking the scenario, so the fallback was dead weight. If a default value is ever needed, put it in the calling script or `.env.example`, not in the config command string.

**Rule**: When authoring a new `@start_bg` or similar `config.json` command, use plain `${VAR}` references only. For optional variables, either guard in the runner script (as `run_testnet.sh` does) or default in `.env.example` and set unconditionally.

**Ref**: commit 8045ba1.

---

### 9. GasFree `gasFreeAddress` is per-query, not absolute — deposit target depends on the address you used to query

- **Category**: protocol
- **Severity**: high
- **Module**: gasfree, client

**Symptom**: `exact_gasfree_testnet` kept returning `insufficient balance in gasfree wallet <addr>` even after USDT was deposited to the `gasFreeAddress` reported by the GasFree API. Deposits were landing on-chain successfully but the facilitator still saw zero balance.

**Root cause**: The GasFree API's `gasFreeAddress` field is a **function of the query address**, not a property of the user. Calling `GET /api/v1/address/<X>` returns `{accountAddress: X, gasFreeAddress: Y}`. Critically, `Y` is a fresh mapping off `X` — so if you query the API with your *main wallet* `TTX1...`, you get one `gasFreeAddress` (say `TErc7...`), but if you then query with `TErc7...` you get a *different* `gasFreeAddress` (`TZDWr...`). Funds deposited to `TZDWr...` never reach the SDK's view because the SDK's client always queries with `signer.get_address()` (the main wallet) and writes that layer's `gasFreeAddress` into `extensions.gasfreeAddress`.

**Fix**: Always deposit to the `gasFreeAddress` returned when querying with your **main wallet address** — the same address `signer.get_address()` returns. In code: `api_client.get_address_info(main_wallet)["gasFreeAddress"]`. Do not recursively follow the mapping.

**Rule**: The GasFree API address endpoint is not idempotent across hops. One query, one deposit target. The SDK client and facilitator both use the main-wallet-derived `gasFreeAddress` as the canonical value for the payment; any other layer's `gasFreeAddress` is effectively a different account.

**Ref**: discovered 2026-04-24 running `exact_gasfree_testnet` against the BankofAI Nile proxy. Verified by tx `1d77f242b72293116e65c46b5ad756dd2f8355ebc625078aec0eb4ea54d148d2` on TRON Nile after depositing to the correct layer.

---

### 10. TRON witness / multi-sig accounts reject single-key tx signing unless `permission_id=2` (active0) is set

- **Category**: signing
- **Severity**: high
- **Module**: mechanisms, scripts, external tooling

**Symptom**: Signing and broadcasting any TRX or TRC-20 transaction from a specific TRON key via tronpy's default path (`tx.build().sign(key).broadcast()`) returned `"Validate signature error: sig error"` even though the key derived the correct address and signed message hashes correctly.

**Root cause**: The account had a **non-default permission scheme** — specifically, `owner_permission.threshold=2` with three weight-1 keys (a 2-of-3 multisig for owner-level operations) plus an `active_permission` id=2 "active0" with our key at threshold 1 (single-sig for active-level operations). tronpy defaults to signing under permission id 0 (owner), which requires two signatures and therefore fails with a single key.

**Fix**: Pass `.permission_id(2)` on the TransactionBuilder before building: `tx.with_owner(...).permission_id(2).fee_limit(...).build().sign(key).broadcast()`. The specific id to use comes from the account's `active_permission[].id` field where your key sits at sufficient weight.

**Rule**: Before scripting a TRON broadcast from a given key, inspect the account's permissions via `wallet/getaccount`. If `owner_permission.threshold > 1` or your key isn't in owner, you must sign under an active permission. This matters for any test key that has ever been used as a witness / SR / multisig participant — on Nile these are common because devnet keys get repurposed.

**Ref**: hit 2026-04-24 while funding the GasFree custodial wallet for `exact_gasfree_testnet`. Account on Nile (`TTX1Us19zqsLXhY39PPR7KRUoMa93s3J3i`) is a historical witness account with 2-of-3 owner permissions; active0 with id=2 resolved it. Successful tx: `55de4caa110b50ea7180549c3dd1f08b88d24b5fe0de7f5ea6e7590ab9e36739`.

---

### 11. GasFree API `assets[].balance` field can lag the chain by minutes

- **Category**: api
- **Severity**: medium
- **Module**: gasfree, cli, balance

**Symptom**: `GasFreeAPIClient.getAddressInfo(user)` returns
`assets[0].balance = "0"` for a custodial wallet that just received a
TRC-20 deposit and which the next `transfer` call settles successfully
out of. The `balance` field is not authoritative.

**Root cause**: GasFree maintains an internal index of custodial balances
and updates it asynchronously after observing on-chain Transfer events.
Indexing latency can be tens of seconds to minutes depending on load. The
field is best-effort metadata, not a live read.

**Fix**: For any user-facing balance display or pre-flight check, query
the TRC-20 contract directly via `triggerConstantContract balanceOf` (the
`getTrc20Balance` helper in `typescript/packages/cli/src/onchain.ts` does
this). The CLI's `balance` command now surfaces both `chainBalance` and
`apiBalance` and prints a stderr warning when they disagree.

**Rule**: Do not trust `getAddressInfo` for balances. Use it for
`active` / `allowSubmit` / `nonce` / `gasFreeAddress` (which are
deterministic) and read balance from the chain.

**Ref**: 2026-04-27 testnet session; CLI commit 5aa41b6 / follow-up adds
`onchain.ts` helper.

---

### 12. GasFree fee structure is flat-per-tx — micropayments are uneconomical

- **Category**: economic
- **Severity**: medium (design trade-off, not a bug)
- **Module**: gasfree, cli, transfer

**Symptom**: User runs `x402 transfer --amount 0.001 --token USDT` and
later notices their GasFree wallet decreased by ~0.101 USDT, not the
expected 0.001. The fee/amount ratio looks pathological for small
transfers.

**Root cause**: GasFree's `transferFee` is a flat per-tx amount (0.1 USDT
on Nile USDT) that compensates the service provider for the TRX gas they
spend broadcasting the on-chain settlement (typically 5-6 TRX per tx,
fixed regardless of amount). The fee scales with TRX cost, not with
payment size. Activation also costs ~1 USDT one-time. So:
- ~0.001 USDT payment → 0.1 USDT fee → 100x overhead.
- ~10 USDT payment → 0.1 USDT fee → 1% overhead.

The provider's economics are: pay TRX to broadcast, get reimbursed in
USDT. They are running a small TRX↔USDT relayer market.

**Fix**: There is no "fix" — this is GasFree's design. The CLI's
`transfer --dry-run` now computes `feeAsPercentageOfAmount` and emits a
stderr warning when fees are >=10% of the payment amount, so users know
what they are signing up for. For agent / micropayment use cases under
~$1, consider batching transfers, or skip GasFree entirely and use
ERC-3009 `exact` (where the user pays their own gas but no relayer fee).

**Rule**: GasFree is for human-pays-vendor flows where transfer amounts
are typically dollars+, not for sub-dollar agent calls. Document the
break-even amount in CLI / SDK consumer guides.

**Ref**: 2026-04-27 evaluation; transfer.ts now emits the warning.

---

<!-- Template for new entries:

### N. Short title

- **Category**: signing | config | api | policy | protocol | signer | client | server | facilitator
- **Severity**: critical | high | medium | low
- **Module**: gasfree, mechanisms, client, server, facilitator, config, signers

**Symptom**: What was observed (error message, unexpected behavior).

**Root cause**: Why it happened.

**Fix**: What was done to resolve it.

**Rule**: The general principle to avoid this class of bug in the future.

**Ref**: PR/commit/issue link (optional).

-->

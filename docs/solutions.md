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

### 7. BSC testnet has no EIP-2612 permit-compatible stablecoin in the registry

- **Category**: protocol
- **Severity**: medium
- **Module**: server, tokens

**Symptom**: `exact_permit_testnet` scenario failed with HTTP 404 at the resource server. Server log repeated "Unsupported scheme/token: network=eip155:97, scheme=exact_permit, asset=0x337610d27c682E347C9cD60BD4b3b107C9d34dDd (skipped)". Route effectively not registered because the facilitator fee_quote returned nothing for any supported token.

**Root cause**: BSC testnet USDT (`0x337610d27c682E347C9cD60BD4b3b107C9d34dDd`) does not implement EIP-2612 `permit`. All three tokens currently in the registry for `eip155:97` (USDT, USDC, DHLU) lack permit support; only DHLU has ERC-3009 `transferWithAuthorization`, which is used by the `exact` scheme but not by `exact_permit`.

**Fix**: Options, none yet taken — (a) migrate `exact_permit_testnet` to Ethereum Sepolia where testnet USDC does implement permit; (b) deploy a test permit token on BSC testnet and add to registry with explicit `exact_permit` support; (c) mark `exact_permit_testnet` as not meaningfully runnable on BSC testnet and rely on the 217 pytest + 51 vitest unit suites to validate the `exact_permit` path.

**Rule**: A token being in `TokenRegistry` does NOT imply it supports every scheme. Scheme support is decided by the facilitator via `fee_quote` based on the on-chain token's interface. When adding a testnet scenario for a new scheme, verify on-chain that at least one registry token actually implements the required capability.

**Ref**: scenario bug found 2026-04-24 while running `e2e/scenarios/run_testnet.sh`; blocked pending token strategy.

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

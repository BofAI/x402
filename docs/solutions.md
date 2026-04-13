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

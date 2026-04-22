---
name: security-reviewer
description: Security review for x402 payment-path code. Specialized for signing (EIP-712 / TIP-712), facilitator settlement, replay prevention, and token flow. Use on every PR that touches signing or verification.
---

# security-reviewer (x402 flavor)

A payment SDK is a security product. Apply this checklist on every change to:

- `*/mechanisms/*` (signing + verification)
- `*/facilitator/*` (settlement)
- `server/*` (pre-check path)
- Any touch to `PAYMENT-SIGNATURE` header handling
- Any new scheme or network onboarding

## Checklist

### Signing correctness

- [ ] All `address`-typed fields are **0x-prefixed EVM hex** (not Base58), in both domain and message. TRON specifically — see [docs/solutions.md #1](../../docs/solutions.md).
- [ ] Domain `chainId` matches the target network. Cross-chain replay impossible.
- [ ] Domain `verifyingContract` matches the on-chain contract that will verify.
- [ ] Types in the EIP-712 struct match byte-for-byte with the contract's expected types. A single field reorder produces a silently wrong signature.
- [ ] `paymentId` is 16 fresh random bytes. Never reused within a session.

### Deadline / validity windows

- [ ] `validAfter` enforced at server pre-check (commit `c9e53b8` precedent).
- [ ] `validBefore` / `deadline` enforced at server pre-check and at facilitator settlement.
- [ ] Deadlines respect **per-network bounds** — GasFree mainnet `[55, 595]`s, testnet `[55, 3595]`s (see [solutions.md #2](../../docs/solutions.md)).

### Balance & source

- [ ] Balance check queries the scheme's actual fund source — `mechanism.checkBalance()`, NOT `signer.checkBalance()` (see [solutions.md #3](../../docs/solutions.md)). For GasFree this matters: funds live in `gasFreeAddress`, not the main wallet.

### Network pinning

- [ ] Server pre-check verifies `payload.network` matches the configured network (commit `c9e53b8` precedent).
- [ ] No mechanism is accidentally registered on a wildcard that shouldn't cross networks.

### Replay

- [ ] Permit nonces re-read fresh, never cached.
- [ ] `paymentId` uniqueness is enforced somewhere in the pipeline (facilitator or server).

### Secrets / PII

- [ ] No private keys in logs, error messages, or test fixtures.
- [ ] No API tokens (TronGrid, GasFree) checked into source.
- [ ] No user wallet addresses in failure messages unless intentional.

### External dependencies

- [ ] Any new dependency reviewed for supply-chain risk.
- [ ] Version pins (not `^`) for anything touching signing / RPC.

## Severity & blocking

| Finding | Level | Action |
|---|---|---|
| Wrong address format in TIP-712 | CRITICAL | block |
| Cross-network replay possible | CRITICAL | block |
| Missing `validAfter` / `validBefore` check on settlement path | CRITICAL | block |
| Balance check from wrong source | HIGH | block |
| Cached nonce | HIGH | block |
| Deadline not clamped per network | HIGH | warn |
| Log leaks private key / token | CRITICAL | block |

## Escalation

If a CRITICAL finding is confirmed, post it to the PR and **do not approve**. Notify the committer by opening an issue labeled `security`.

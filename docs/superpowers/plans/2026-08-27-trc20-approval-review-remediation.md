# TRC-20 Approval Review Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve CR-001, CR-002, CR-003, CR-010, CR-013, and CR-020 with scheme-neutral safeguards and regression coverage for Exact, Upto, and Batch Settlement.

**Architecture:** Keep the public x402 schemes unchanged and place shared safety behavior at existing boundaries: token Approval policy in a shared module, network/lifetime capability on the Client signer, deadline and receipt semantics in the Extension bridge/runtime, and retry-safe permission validation in the TronWeb chain driver. Scheme implementations provide their authorization deadline and revalidation callback to the shared bridge and perform a final verification immediately before settlement broadcast.

**Tech Stack:** TypeScript 5.7, TronWeb 6, Vitest 3, tsup, ESLint, Prettier, pnpm workspace.

**Spec:** `docs/superpowers/specs/2026-08-27-trc20-approval-review-remediation-design.md`

## Global Constraints

- Do not change the Exact, Upto, or Batch Settlement scheme names or payment payload formats.
- Do not add an implicit `approve(0)` transaction.
- Reject unsafe requests before Resource Owner side effects whenever the required information is available.
- Keep signed transaction bytes, private keys, and wallet secrets out of errors and logs.
- Preserve `allowedAssets`; allowed assets default to the conservative `zero-first` strategy.
- Keep all new policy and safety logic shared across Exact, Upto, and Batch Settlement.
- Use tests first and observe each new regression test fail for the intended reason before changing production code.

---

### Task 1: Shared token Approval strategy and Client behavior

**Files:**

- Create: `typescript/packages/mechanisms/tron/src/approvalPolicy.ts`
- Modify: `typescript/packages/mechanisms/tron/src/signer.ts`
- Modify: `typescript/packages/mechanisms/tron/src/shared/extensions/resourceSponsoring.ts`
- Modify: `typescript/packages/mechanisms/tron/src/index.ts`
- Test: `typescript/packages/mechanisms/tron/test/unit/client-allowance.test.ts`
- Test: `typescript/packages/mechanisms/tron/test/unit/trc20-approval-resource-sponsoring-client.test.ts`

**Interfaces:**

- Produce `Trc20ApprovalUpdateStrategy = "zero-first" | "direct-overwrite" | "unsupported"`.
- Produce `Trc20ApprovalPolicy` with `strategyFor(network: string, token: string): Trc20ApprovalUpdateStrategy`.
- Produce `createTrc20ApprovalPolicy({ allowedAssets, strategies? })` that normalizes TRON addresses, defaults allowed assets to `zero-first`, and defaults unknown assets to `unsupported`.
- Add `readonly network?: string` and `readonly approvalPolicy?: Trc20ApprovalPolicy` to `ClientTronSigner`.
- Add optional `approvalPolicy` to `createClientTronSigner` options and use it for sponsored and self-funded Approval decisions.

- [ ] **Step 1: Write failing policy and allowance tests**

Add table-driven tests with literal results:

```ts
it.each([
  ["zero-first", 0n, "approve"],
  ["zero-first", 1n, "approval_reset_required"],
  ["direct-overwrite", 1n, "approve"],
  ["unsupported", 0n, "approval_asset_unsupported"],
] as const)("applies %s to allowance %s", async (strategy, allowance, expected) => {
  const harness = approvalHarness({ strategy, allowance });
  await expect(harness.ensure()).resolvesOrRejectsWith(expected);
});
```

Use separate ordinary Vitest assertions instead of adding `resolvesOrRejectsWith`; the fixture must exercise the real `ensurePermit2Allowance` boundary and only fake contract reads/signing/broadcast.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
pnpm exec vitest run test/unit/client-allowance.test.ts test/unit/trc20-approval-resource-sponsoring-client.test.ts
```

Expected: FAIL because policy types/options do not exist and partial self-funded allowance still broadcasts directly.

- [ ] **Step 3: Implement the minimal shared policy**

Create a normalized immutable map and one resolver. In both Client paths apply:

```ts
if (allowance >= requiredAllowance) return satisfied;
const strategy = policy.strategyFor(network, token);
if (strategy === "unsupported") throw new Error("approval_asset_unsupported");
if (allowance !== 0n && strategy === "zero-first") {
  throw new Error("approval_reset_required");
}
```

Do not construct a reset transaction.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: both files pass.

- [ ] **Step 5: Commit Task 1**

```bash
git add typescript/packages/mechanisms/tron/src/approvalPolicy.ts typescript/packages/mechanisms/tron/src/signer.ts typescript/packages/mechanisms/tron/src/shared/extensions/resourceSponsoring.ts typescript/packages/mechanisms/tron/src/index.ts typescript/packages/mechanisms/tron/test/unit/client-allowance.test.ts typescript/packages/mechanisms/tron/test/unit/trc20-approval-resource-sponsoring-client.test.ts
git commit -m "fix(tron): unify approval update policy"
```

### Task 2: Client signer network binding and exact registration

**Files:**

- Modify: `typescript/packages/mechanisms/tron/src/signer.ts`
- Modify: `typescript/packages/mechanisms/tron/src/shared/extensions/resourceSponsoring.ts`
- Modify: `typescript/packages/mechanisms/tron/src/exact/client/register.ts`
- Test: `typescript/packages/mechanisms/tron/test/unit/trc20-approval-resource-sponsoring-client.test.ts`
- Test: `typescript/packages/mechanisms/tron/test/unit/signer-wallet.test.ts`

**Interfaces:**

- Stock `createClientTronSigner` returns `network: opts.network`.
- Sponsoring requires an exact network match before Permit2 lookup, allowance read, or signing.
- Default Exact registration uses `config.signer.network` when present; explicit mismatched networks throw before registration.

- [ ] **Step 1: Write failing cross-network tests**

Add a test that supplies a Nile signer and Mainnet requirements and asserts:

```ts
await expect(trySignTrc20ApprovalExtension(signer, mainnetRequirements, context)).rejects.toThrow(
  "approval_signer_network_mismatch",
);
expect(readContract).not.toHaveBeenCalled();
expect(signPermit2Approval).not.toHaveBeenCalled();
```

Add registration tests asserting a network-bound signer defaults to `tron:0xcd8690dc` and rejects an explicit different network.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
pnpm exec vitest run test/unit/trc20-approval-resource-sponsoring-client.test.ts test/unit/signer-wallet.test.ts
```

Expected: FAIL because no immutable network capability is enforced and registration still uses `tron:*`.

- [ ] **Step 3: Implement network binding**

Set `network` on the stock signer and add the first guard in the shared Client helper:

```ts
if (!signer.network || signer.network !== requirements.network) {
  throw new Error("approval_signer_network_mismatch");
}
```

Change registration defaults only for network-bound signers. Keep wildcard behavior for legacy custom signers that do not advertise a network and are not using Sponsoring.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: pass.

- [ ] **Step 5: Commit Task 2**

```bash
git add typescript/packages/mechanisms/tron/src/signer.ts typescript/packages/mechanisms/tron/src/shared/extensions/resourceSponsoring.ts typescript/packages/mechanisms/tron/src/exact/client/register.ts typescript/packages/mechanisms/tron/test/unit/trc20-approval-resource-sponsoring-client.test.ts typescript/packages/mechanisms/tron/test/unit/signer-wallet.test.ts
git commit -m "fix(tron): bind sponsored approvals to signer network"
```

### Task 3: Fixed Approval lifetime and pre-delegation enforcement

**Files:**

- Modify: `typescript/packages/extensions/src/trc20-approval-resource-sponsoring/resourceService.ts`
- Modify: `typescript/packages/extensions/src/trc20-approval-resource-sponsoring/types.ts`
- Modify: `typescript/packages/mechanisms/tron/src/shared/extensions/trc20ApprovalContract.ts`
- Modify: `typescript/packages/mechanisms/tron/src/shared/extensions/resourceSponsoring.ts`
- Modify: `typescript/packages/mechanisms/tron/src/signer.ts`
- Modify: `typescript/packages/mechanisms/tron/src/resource-sponsoring/factory.ts`
- Modify: `typescript/packages/mechanisms/tron/src/resource-sponsoring/tronWebChain.ts`
- Test: `typescript/packages/extensions/test/trc20-approval-resource-sponsoring.test.ts`
- Test: `typescript/packages/mechanisms/tron/test/unit/trc20-approval-resource-sponsoring-client.test.ts`
- Test: `typescript/packages/mechanisms/tron/test/unit/trc20-resource-sponsoring-tronweb.test.ts`

**Interfaces:**

- The version 1 Server declaration remains limited to description and version.
- `signPermit2Approval` receives the fixed protocol value `minimumLifetimeSeconds: 300` from the Client SDK.
- Runtime/factory retains an authoritative `minimumApprovalBroadcastWindowMs` and enforces it independently before delegation.

- [ ] **Step 1: Write failing lifetime tests**

Cover three observable behaviors:

```ts
expect(declaration.trc20ApprovalResourceSponsoring.info).toEqual({ description, version: "1" });
expect(signPermit2Approval).toHaveBeenCalledWith({ token, network, minimumLifetimeSeconds: 300 });
await expect(chain.preflight(shortApprovalRequest)).rejects.toThrow(
  "approval_transaction_expiring",
);
```

Also build a stock signed transaction and assert its expiration is at least the fixed version 1 lifetime from the controlled clock.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
pnpm exec vitest run test/trc20-approval-resource-sponsoring.test.ts
pnpm exec vitest run test/unit/trc20-approval-resource-sponsoring-client.test.ts test/unit/trc20-resource-sponsoring-tronweb.test.ts
```

Run the first command in `typescript/packages/extensions` and the second in `typescript/packages/mechanisms/tron`. Expected: the old Server lifetime field, Server-controlled Client value, and short-lifetime behavior fail.

- [ ] **Step 3: Implement fixed Client lifetime and signer expiration**

Keep the Server declaration free of lifetime configuration. Pass the fixed version 1 value through the shared Client helper. After TronWeb builds the Approval, extend expiration only when required; reparse the result and fail if the resulting transaction remains too short.

The Facilitator continues to enforce its local millisecond minimum independently of Client data.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run both Step 2 commands. Expected: pass.

- [ ] **Step 5: Commit Task 3**

```bash
git add typescript/packages/extensions/src/trc20-approval-resource-sponsoring typescript/packages/extensions/test/trc20-approval-resource-sponsoring.test.ts typescript/packages/mechanisms/tron/src/shared/extensions typescript/packages/mechanisms/tron/src/signer.ts typescript/packages/mechanisms/tron/src/resource-sponsoring/factory.ts typescript/packages/mechanisms/tron/src/resource-sponsoring/tronWebChain.ts typescript/packages/mechanisms/tron/test/unit/trc20-approval-resource-sponsoring-client.test.ts typescript/packages/mechanisms/tron/test/unit/trc20-resource-sponsoring-tronweb.test.ts
git commit -m "fix(tron): negotiate sponsored approval lifetime"
```

### Task 4: Saga deadline admission and final revalidation

**Files:**

- Modify: `typescript/packages/extensions/src/trc20-approval-resource-sponsoring/types.ts`
- Modify: `typescript/packages/mechanisms/tron/src/shared/extensions/trc20ApprovalContract.ts`
- Modify: `typescript/packages/mechanisms/tron/src/shared/extensions/trc20ApprovalResourceSponsoring.ts`
- Modify: `typescript/packages/mechanisms/tron/src/resource-sponsoring/runtime.ts`
- Modify: `typescript/packages/mechanisms/tron/src/resource-sponsoring/types.ts`
- Modify: `typescript/packages/mechanisms/tron/src/exact/facilitator/permit2.ts`
- Modify: `typescript/packages/mechanisms/tron/src/upto/facilitator/permit2.ts`
- Modify: `typescript/packages/mechanisms/tron/src/batch-settlement/facilitator/deposit.ts`
- Test: `typescript/packages/mechanisms/tron/test/unit/trc20-resource-sponsoring-runtime.test.ts`
- Test: `typescript/packages/mechanisms/tron/test/unit/flow-integration.test.ts`
- Test: `typescript/packages/mechanisms/tron/test/unit/upto-flow.test.ts`
- Test: `typescript/packages/mechanisms/tron/test/unit/batch-settlement/lifecycle.test.ts`

**Interfaces:**

- `Trc20SponsorshipExecutionOptions` gains `paymentDeadlineMs: number` and retains `revalidate`.
- Runtime derives a safe minimum from `confirmationTimeoutMs * 3 + settlementSafetyMarginMs` and permits a larger configured floor.
- Runtime invokes revalidation before Approval and after Approval confirmation.
- Each Scheme revalidates once more directly before `writeContract`.

- [ ] **Step 1: Write failing deadline-stage tests**

Use fake timers and a real runtime harness to assert:

```ts
const result = await runtime.sponsor(request, {
  paymentDeadlineMs: now + sagaBudgetMs - 1,
  revalidate,
});
expect(result).toMatchObject({ success: false, errorReason: "payment_deadline_too_short" });
expect(chain.prepareDelegate).not.toHaveBeenCalled();
```

Add tests where the clock advances after delegation and after Approval confirmation. Assert resource recovery begins and settlement `writeContract` is never called after final revalidation fails.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
pnpm exec vitest run test/unit/trc20-resource-sponsoring-runtime.test.ts test/unit/flow-integration.test.ts test/unit/upto-flow.test.ts test/unit/batch-settlement/lifecycle.test.ts
```

Expected: missing execution deadline API, no pre-delegation budget check, or settlement proceeds after the final deadline.

- [ ] **Step 3: Implement deadline admission and three checks**

Reject non-safe/non-future deadline values. Perform admission before `coordinator.admit`, revalidate after resources become visible, revalidate after Approval allowance is observed, and make each Scheme call its authorization verifier immediately before contract write.

Do not treat resource recovery completion as a prerequisite for payment settlement.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: pass.

- [ ] **Step 5: Commit Task 4**

```bash
git add typescript/packages/extensions/src/trc20-approval-resource-sponsoring/types.ts typescript/packages/mechanisms/tron/src/shared/extensions typescript/packages/mechanisms/tron/src/resource-sponsoring typescript/packages/mechanisms/tron/src/exact/facilitator/permit2.ts typescript/packages/mechanisms/tron/src/upto/facilitator/permit2.ts typescript/packages/mechanisms/tron/src/batch-settlement/facilitator/deposit.ts typescript/packages/mechanisms/tron/test/unit/trc20-resource-sponsoring-runtime.test.ts typescript/packages/mechanisms/tron/test/unit/flow-integration.test.ts typescript/packages/mechanisms/tron/test/unit/upto-flow.test.ts typescript/packages/mechanisms/tron/test/unit/batch-settlement/lifecycle.test.ts
git commit -m "fix(tron): enforce sponsorship deadline budget"
```

### Task 5: Retry-safe permission validation cache

**Files:**

- Modify: `typescript/packages/mechanisms/tron/src/resource-sponsoring/tronWebChain.ts`
- Test: `typescript/packages/mechanisms/tron/test/unit/trc20-resource-sponsoring-tronweb.test.ts`

**Interfaces:**

- Concurrent callers share a single in-flight permission lookup.
- A fulfilled validation remains cached.
- A rejected validation clears only its own Promise and permits a fresh lookup.

- [ ] **Step 1: Write failing retry and concurrency tests**

Configure `getAccount` to reject once and return a complete Active Permission response on the second call. Assert the first preflight rejects and the second succeeds. Add a deferred Promise test proving two concurrent calls issue one RPC lookup.

- [ ] **Step 2: Run focused test and verify RED**

Run:

```bash
pnpm exec vitest run test/unit/trc20-resource-sponsoring-tronweb.test.ts
```

Expected: the second call rethrows the cached first rejection.

- [ ] **Step 3: Implement atomic rejection clearing**

Use a local Promise reference:

```ts
const validation = validatePermission();
permissionValidation = validation;
try {
  await validation;
} catch (error) {
  if (permissionValidation === validation) permissionValidation = undefined;
  throw error;
}
```

Return immediately when an already fulfilled/in-flight Promise exists.

- [ ] **Step 4: Run focused test and verify GREEN**

Run the Step 2 command. Expected: pass.

- [ ] **Step 5: Commit Task 5**

```bash
git add typescript/packages/mechanisms/tron/src/resource-sponsoring/tronWebChain.ts typescript/packages/mechanisms/tron/test/unit/trc20-resource-sponsoring-tronweb.test.ts
git commit -m "fix(tron): recover permission validation cache"
```

### Task 6: Correct sponsorship failure transaction semantics

**Files:**

- Modify: `typescript/packages/mechanisms/tron/src/resource-sponsoring/runtime.ts`
- Modify: `typescript/packages/mechanisms/tron/src/shared/extensions/trc20ApprovalResourceSponsoring.ts`
- Test: `typescript/packages/mechanisms/tron/test/unit/trc20-resource-sponsoring-runtime.test.ts`
- Test: `typescript/packages/mechanisms/tron/test/unit/trc20-approval-resource-sponsoring-validator.test.ts`

**Interfaces:**

- Runtime exposes `approvalTransaction` only when an Approval action is persisted as `submitted`, `unknown`, or `confirmed`.
- Extension settlement failures always set `transaction: ""`.

- [ ] **Step 1: Write failing pre-Approval response tests**

Force delegation and resource-visibility failures after operation creation. Assert:

```ts
expect(result).toMatchObject({ success: false });
expect(result.approvalTransaction).toBeUndefined();
expect(bridgeFailure.transaction).toBe("");
```

Add an unknown Approval broadcast case and assert only the Runtime internal result contains the persisted Approval identity.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
pnpm exec vitest run test/unit/trc20-resource-sponsoring-runtime.test.ts test/unit/trc20-approval-resource-sponsoring-validator.test.ts
```

Expected: precomputed Approval txID leaks from Runtime/bridge.

- [ ] **Step 3: Implement status-projected identity and empty settlement transaction**

Add a helper that returns `operation.approvalTxID` only when the Approval action status is `submitted`, `unknown`, or `confirmed`. Use it for Runtime failures. Ignore the internal identity when creating a failed `SettleResponse`.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: pass.

- [ ] **Step 5: Commit Task 6**

```bash
git add typescript/packages/mechanisms/tron/src/resource-sponsoring/runtime.ts typescript/packages/mechanisms/tron/src/shared/extensions/trc20ApprovalResourceSponsoring.ts typescript/packages/mechanisms/tron/test/unit/trc20-resource-sponsoring-runtime.test.ts typescript/packages/mechanisms/tron/test/unit/trc20-approval-resource-sponsoring-validator.test.ts
git commit -m "fix(tron): preserve settlement failure semantics"
```

### Task 7: Cross-scheme matrix, documentation, and full verification

**Files:**

- Modify: `typescript/packages/mechanisms/tron/test/unit/flow-integration.test.ts`
- Modify: `typescript/packages/mechanisms/tron/test/unit/upto-flow.test.ts`
- Modify: `typescript/packages/mechanisms/tron/test/unit/batch-settlement/lifecycle.test.ts`
- Modify: `typescript/packages/mechanisms/tron/test/integrations/trc20-approval-resource-sponsoring.nile.test.ts`
- Modify: `typescript/packages/extensions/src/trc20-approval-resource-sponsoring/README.md`
- Modify: `specs/extensions/trc20_approval_resource_sponsoring.md`

**Interfaces:**

- The matrix demonstrates identical admission, policy, response, and recovery behavior across all three schemes.
- The spec and package README document the new lifetime, network, and Approval policy rules.

- [ ] **Step 1: Add missing matrix cases**

Use `it.each` with literal expectations for `exact`, `upto`, and `batch-settlement`, both confirmation modes, and zero/partial/sufficient allowance. Each test must assert a consumer-visible result: no pre-admission delegate, successful settlement, stable failure reason, or zero residual recovery state.

- [ ] **Step 2: Run the TRON unit suite**

Run:

```bash
pnpm test
```

Expected: all TRON tests pass.

- [ ] **Step 3: Update protocol and package documentation**

Document the fixed 300-second Client Approval lifetime, exact signer network binding, saga deadline admission, strategy behavior, and empty settlement transaction failures. Keep examples free of private keys and environment values.

- [ ] **Step 4: Run relevant workspace checks**

Run in the appropriate packages:

```bash
pnpm test
pnpm build
pnpm lint:check
pnpm format:check
```

Run TRON, Extensions, and affected Core integration tests. Run `git diff --check` from the worktree root.

- [ ] **Step 5: Run Nile regression**

Load the existing secret environment without printing values. Run Exact, Upto, and Batch Settlement with fresh payers in packed mode. Assert settlement receipt `SUCCESS`, payer TRX unchanged, and zero residual delegated resources. Run one solidified Scheme when the negotiated Approval lifetime covers the finality window.

- [ ] **Step 6: Commit Task 7**

```bash
git add typescript/packages/mechanisms/tron/test typescript/packages/extensions/src/trc20-approval-resource-sponsoring/README.md specs/extensions/trc20_approval_resource_sponsoring.md
git commit -m "test(tron): cover approval sponsorship safety matrix"
```

- [ ] **Step 7: Final branch verification**

Confirm `git status --short` contains only the user's pre-existing untracked documents. Review `git diff origin/main...HEAD --check`, inspect the commit list, and push the feature branch only after every required check succeeds.

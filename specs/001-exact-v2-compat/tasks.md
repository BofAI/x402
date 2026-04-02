# Tasks: Exact Scheme V2 Compatibility

**Input**: Design documents from `/specs/001-exact-v2-compat/`
**Prerequisites**: plan.md, spec.md

**Tests**: Compatibility and regression tests are required by the feature spec and are included below.

**Organization**: Tasks are grouped by user story so each story can be implemented and validated independently after the shared protocol foundation is complete.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel
- **[Story]**: User story label (`US1`, `US2`, `US3`)
- Exact file paths are included in each task

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Establish the speckit implementation workspace and protocol baseline artifacts.

- [x] T001 Copy the full speckit support files needed for implementation validation into `/Users/bobo/code/x402/x402/.specify/`
- [x] T002 Document the Coinbase x402 v2 `exact` compatibility baseline and current repo deviations in `/Users/bobo/code/x402/x402/specs/001-exact-v2-compat/research.md`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Build the shared protocol foundation before changing individual flows.

**⚠️ CRITICAL**: No user story implementation begins until these tasks are complete.

- [x] T003 Update TypeScript shared payment and response models in `/Users/bobo/code/x402/x402/typescript/packages/x402/src/types/payment.ts` and `/Users/bobo/code/x402/x402/typescript/packages/x402/src/types/responses.ts` to represent v2-compatible `exact` payloads
- [x] T004 [P] Update Python shared protocol models in `/Users/bobo/code/x402/x402/python/x402/src/bankofai/x402/types.py` to represent v2-compatible `exact` payloads
- [x] T005 [P] Update wire encoding and transport assumptions in `/Users/bobo/code/x402/x402/typescript/packages/x402/src/http/client.ts`, `/Users/bobo/code/x402/x402/python/x402/src/bankofai/x402/clients/x402_http_client.py`, and `/Users/bobo/code/x402/x402/python/x402/src/bankofai/x402/fastapi/middleware.py` so they no longer assume permit-centric `exact` payloads
- [x] T006 Update exact shared helper types in `/Users/bobo/code/x402/x402/typescript/packages/x402/src/mechanisms/nativeExact.ts` and `/Users/bobo/code/x402/x402/python/x402/src/bankofai/x402/mechanisms/_exact_base/types.py`

**Checkpoint**: Shared protocol model is aligned enough for user-story implementation.

---

## Phase 3: User Story 1 - Coinbase v2 Client Can Pay Our Server (Priority: P1) 🎯 MVP

**Goal**: Our server accepts a standard v2 `exact` payment from an external client.

**Independent Test**: A v2-style `exact` payment payload sent to our protected endpoint is accepted and settled without custom translation.

### Tests for User Story 1

- [x] T007 [P] [US1] Add server-side regression tests for v2 `exact` payload parsing and validation in `/Users/bobo/code/x402/x402/python/x402/tests/server/test_evm_exact.py`
- [x] T008 [P] [US1] Add middleware/integration coverage for a v2 client paying our server in `/Users/bobo/code/x402/x402/specs/001-exact-v2-compat/quickstart.md` and live interoperability validation notes

### Implementation for User Story 1

- [x] T009 [US1] Update Python `exact` server validation in `/Users/bobo/code/x402/x402/python/x402/src/bankofai/x402/server/x402_server.py` so `exact` no longer depends on `paymentPermit`
- [x] T010 [US1] Update Python `exact` facilitator verification and settlement in `/Users/bobo/code/x402/x402/python/x402/src/bankofai/x402/mechanisms/_exact_base/base.py`
- [x] T011 [US1] Update facilitator request shaping in `/Users/bobo/code/x402/x402/python/x402/src/bankofai/x402/facilitator/facilitator_client.py`
- [x] T012 [US1] Update FastAPI payment middleware in `/Users/bobo/code/x402/x402/python/x402/src/bankofai/x402/fastapi/middleware.py` to accept the v2 `exact` path end-to-end

**Checkpoint**: A v2-compatible external client can pay our server for `exact`.

---

## Phase 4: User Story 2 - Our Client Can Pay a Coinbase v2 Server (Priority: P2)

**Goal**: Our SDK emits a standard v2 `exact` payment that a v2 server accepts.

**Independent Test**: Our client can answer a v2 `exact` challenge from a reference-compatible server fixture without payload rewriting.

### Tests for User Story 2

- [x] T013 [P] [US2] Add TypeScript tests for v2 `exact` payload generation in `/Users/bobo/code/x402/x402/typescript/packages/x402/src/mechanisms/exactEvm.test.ts` and related client tests
- [x] T014 [P] [US2] Add Python tests for v2 `exact` payload generation in `/Users/bobo/code/x402/x402/python/x402/tests/exact/test_client.py`

### Implementation for User Story 2

- [x] T015 [US2] Update the TypeScript `exact` client mechanism in `/Users/bobo/code/x402/x402/typescript/packages/x402/src/mechanisms/nativeExactEvm.ts`
- [x] T016 [US2] Update the Python `exact` client mechanism in `/Users/bobo/code/x402/x402/python/x402/src/bankofai/x402/mechanisms/_exact_base/base.py` and `/Users/bobo/code/x402/x402/python/x402/src/bankofai/x402/mechanisms/evm/exact/client.py`
- [x] T017 [US2] Update TypeScript client selection and retry flow in `/Users/bobo/code/x402/x402/typescript/packages/x402/src/client/x402Client.ts` and `/Users/bobo/code/x402/x402/typescript/packages/x402/src/http/client.ts`
- [x] T018 [US2] Update Python client selection and retry flow in `/Users/bobo/code/x402/x402/python/x402/src/bankofai/x402/clients/x402_client.py` and `/Users/bobo/code/x402/x402/python/x402/src/bankofai/x402/clients/x402_http_client.py`

**Checkpoint**: Our TypeScript and Python clients can produce v2-compatible `exact` payments.

---

## Phase 5: User Story 3 - Existing Users Have a Controlled Migration Path (Priority: P3)

**Goal**: The compatibility rollout is documented and regression-protected for adjacent flows.

**Independent Test**: Existing unaffected payment paths continue to pass regression tests, and documentation explains the compatibility shift.

### Tests for User Story 3

- [x] T019 [P] [US3] Run and update affected `exact_permit` and non-`exact` regression tests in `/Users/bobo/code/x402/x402/python/x402/tests/client/`, `/Users/bobo/code/x402/x402/python/x402/tests/facilitator/`, and `/Users/bobo/code/x402/x402/typescript/packages/x402/src/client/`

### Implementation for User Story 3

- [x] T020 [US3] Document migration and compatibility behavior in `/Users/bobo/code/x402/x402/README.md`, `/Users/bobo/code/x402/x402/typescript/packages/x402/README.md`, and `/Users/bobo/code/x402/x402/python/x402/README.md`
- [x] T021 [US3] Add quick verification steps and interoperability notes in `/Users/bobo/code/x402/x402/specs/001-exact-v2-compat/quickstart.md`

**Checkpoint**: Compatibility change is documented and regression-protected.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final verification across all stories.

- [x] T022 Run targeted TypeScript test suite from `/Users/bobo/code/x402/x402/typescript/packages/x402`
- [x] T023 Run targeted Python test suite from `/Users/bobo/code/x402/x402/python/x402`
- [x] T024 Reconcile any remaining protocol-field mismatches found during interoperability testing
- [x] T025 Update `/Users/bobo/code/x402/x402/specs/001-exact-v2-compat/plan.md` and `/Users/bobo/code/x402/x402/specs/001-exact-v2-compat/tasks.md` with final status notes if scope changes during implementation

---

## Dependencies & Execution Order

### Phase Dependencies

- Phase 1 has no dependencies.
- Phase 2 depends on Phase 1 and blocks all user-story work.
- Phase 3 depends on Phase 2.
- Phase 4 depends on Phase 2 and can proceed after the shared model is aligned.
- Phase 5 depends on Phases 3 and 4 reaching stable behavior.
- Phase 6 depends on all intended implementation tasks being complete.

### User Story Dependencies

- **US1** depends only on the foundational protocol alignment.
- **US2** depends only on the foundational protocol alignment.
- **US3** depends on US1 and US2 being stable enough to document and regress.

### Parallel Opportunities

- T004 and T005 can run in parallel after T003 starts the shared model refactor.
- T007 and T008 can run in parallel.
- T013 and T014 can run in parallel.
- Documentation and quickstart tasks can proceed while final regression tests are running.

## Implementation Strategy

### MVP First

1. Complete Setup and Foundational phases.
2. Complete US1 and verify a v2 client can pay our server.
3. Stop and validate the server-side compatibility path before expanding to client-side compatibility.

### Incremental Delivery

1. Align shared models.
2. Deliver server compatibility (US1).
3. Deliver client compatibility (US2).
4. Lock down migration docs and regression coverage (US3).

## Notes

- Tasks marked `[P]` should avoid writing the same files concurrently.
- The first implementation slice should focus on `exact` on the EVM path only.
- If live Coinbase integration is impractical in CI, use spec-faithful fixtures and request/response snapshots.

# Implementation Plan: Exact Scheme V2 Compatibility

**Branch**: `001-exact-v2-compat` | **Date**: 2026-04-02 | **Spec**: [/Users/bobo/code/x402/x402/specs/001-exact-v2-compat/spec.md](/Users/bobo/code/x402/x402/specs/001-exact-v2-compat/spec.md)
**Input**: Feature specification from `/specs/001-exact-v2-compat/spec.md`

## Summary

Align the repository's `exact` payment flow with the Coinbase x402 v2 specification so that a standard v2 client can pay our server and our client can pay a v2-compatible server without custom translation. The implementation will update shared protocol models, wire-format handling, `exact` client payload generation, `exact` server and facilitator validation, and end-to-end compatibility tests while preserving non-`exact` flows through regression coverage.

## Technical Context

**Language/Version**: Python >= 3.11 and TypeScript on Node >= 18  
**Primary Dependencies**: `httpx`, `pydantic`, optional `fastapi`, `viem`, `tronweb`, Vitest, pytest  
**Storage**: N/A for the compatibility change; protocol and SDK logic only  
**Testing**: `pytest`, `pytest-asyncio`, `vitest run`  
**Target Platform**: Python SDK/server environments and Node-based TypeScript SDK consumers  
**Project Type**: Multi-package SDK/library repository with server middleware and facilitator integrations  
**Performance Goals**: Preserve current request flow behavior; no additional compatibility round trips in the happy path  
**Constraints**: Must keep non-`exact` schemes working, must match Coinbase x402 v2 wire contract for `exact`, must support both TypeScript and Python stacks  
**Scale/Scope**: Bounded to `exact` compatibility on the current EVM path plus regression protection for adjacent protocol surfaces

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

No project constitution file is present in `.specify/memory`, so no additional custom gates apply.

Initial gate result:
- Spec exists and is complete.
- Scope is bounded to one protocol feature (`exact` compatibility).
- Changes are testable in both Python and TypeScript stacks.
- No expected violation requires special justification at planning time.

## Project Structure

### Documentation (this feature)

```text
specs/001-exact-v2-compat/
├── plan.md              # This file (/speckit.plan command output)
├── checklists/
│   └── requirements.md
├── research.md          # Optional follow-up design notes if needed
├── data-model.md        # Optional protocol shape notes if needed
├── quickstart.md        # Optional compatibility verification notes if needed
└── tasks.md             # Phase 2 output (/speckit.tasks command)
```

### Source Code (repository root)

```text
typescript/packages/x402/
├── src/
│   ├── client/
│   ├── http/
│   ├── mechanisms/
│   ├── signers/
│   ├── types/
│   └── utils/
└── package.json

python/x402/
├── src/bankofai/x402/
│   ├── clients/
│   ├── facilitator/
│   ├── fastapi/
│   ├── http/
│   ├── mechanisms/
│   │   ├── _base/
│   │   ├── _exact_base/
│   │   ├── _exact_permit_base/
│   │   ├── evm/
│   │   ├── svm/
│   │   └── tron/
│   ├── server/
│   ├── signers/
│   ├── tokens/
│   ├── types.py
│   └── utils/
└── tests/
    ├── client/
    ├── exact/
    ├── facilitator/
    ├── integrations/
    ├── server/
    ├── unit/
    └── utils/
```

**Structure Decision**: This feature spans two existing SDK implementations and their shared protocol surfaces. Work will be organized by protocol layer rather than by language alone: shared wire model changes first, then TypeScript client updates, then Python client/server/facilitator updates, followed by bidirectional compatibility tests in the existing test suites.

## Implementation Phases

### Phase 0 - Freeze Protocol Baseline

- Record the Coinbase x402 v2 `exact` wire contract as the normative compatibility target for this branch.
- Enumerate the current repository-specific deviations in header names, payload fields, challenge fields, and facilitator request shapes.
- Confirm the bounded scope: `exact` on the current EVM path, with regression protection for all other schemes.

### Phase 1 - Shared Protocol Model Alignment

- Update shared TypeScript and Python protocol types used by client, server, HTTP transport, and facilitator code to represent the v2-compatible `exact` challenge and payment shapes.
- Remove the assumption that all payment payloads are permit-centric.
- Ensure `exact` authorization data is represented in the canonical protocol location rather than only in extension fields.

### Phase 2 - Client Compatibility

- Update the TypeScript `exact` client mechanism to generate a v2-compatible payment payload.
- Update the Python `exact` client mechanism to generate the same v2-compatible payload shape.
- Ensure token metadata and signing context are derived consistently so that v2 servers can verify the signature.

### Phase 3 - Server and Facilitator Compatibility

- Update Python server-side validation to distinguish `exact` from `exact_permit` and validate `exact` against the challenged asset, amount, recipient, and authorization window.
- Update facilitator verify and settle flows to accept the v2-compatible `exact` payload and process authorization data directly.
- Update middleware and HTTP client adapters so challenge parsing and retry behavior match the shared protocol model.

### Phase 4 - Regression and Interoperability Verification

- Add or update automated tests for:
  - v2 client to our server
  - our client to v2-compatible server fixtures
  - malformed, expired, replayed, and mismatched `exact` payload rejection
  - unchanged behavior for unaffected schemes such as `exact_permit`
- Run targeted TypeScript and Python test suites that cover protocol models, `exact` mechanisms, server middleware, and facilitator behavior.

### Phase 5 - Documentation and Migration Notes

- Update repository docs to explain the spec-aligned `exact` behavior and interoperability target.
- Document any temporary backward-compatibility handling or migration expectations for current users of the repository-specific `exact` format.

## Current Status Notes

- Shared `exact` payload models now support `payload.authorization` in both TypeScript and Python.
- Python server-side validation no longer requires `paymentPermit` for the `exact` scheme.
- Python facilitator and transaction verification paths can consume `payload.authorization`, with fallback support for the legacy `extensions.transferAuthorization`.
- Targeted Python and TypeScript compatibility tests pass in the local development environment after installing dependencies.
- External live interoperability was executed on 2026-04-02 against the Coinbase official TypeScript workspace on BSC testnet.
- Coinbase official client -> our server succeeded with settlement transaction `0x29d452bced7870ee8b4cfc159b250a22e87db66f3af5bbb9e9c7d5cef7d752e2`.
- Our client -> Coinbase official server succeeded with settlement transaction `0xb8d9233a875ede13c1e69b8a0515f01b09a2be4645beba3a0805f54f93061771`.
- Live validation also confirmed an important transport assumption: Coinbase official Fastify middleware can deliver the challenge through the `payment-required` header with an empty JSON body, so local interop clients must support header-first challenge parsing.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| None | N/A | N/A |

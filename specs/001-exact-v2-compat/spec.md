# Feature Specification: Exact Scheme V2 Compatibility

**Feature Branch**: `001-exact-v2-compat`  
**Created**: 2026-04-02  
**Status**: Draft  
**Input**: User description: "把 exact scheme 对齐 coinbase x402 v2，使 v2 client 能访问我们的 server，我们的 client 能访问 v2 server，并将项目改造成按 spec 驱动的实现"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Coinbase v2 Client Can Pay Our Server (Priority: P1)

As an integrator using a Coinbase x402 v2 client, I can access a protected resource on our server without custom adapters so that our server is usable by standard v2 clients.

**Why this priority**: This is the primary compatibility goal and the fastest way to prove our server conforms to the external protocol contract.

**Independent Test**: Can be fully tested by pointing a stock Coinbase x402 v2 client at our protected endpoint and successfully completing a paid request.

**Acceptance Scenarios**:

1. **Given** our server exposes a protected resource using the `exact` scheme, **When** a Coinbase x402 v2 client requests the resource and receives a payment challenge, **Then** the client can construct a valid payment from the challenge without any project-specific translation.
2. **Given** the client retries with a valid v2 `exact` payment, **When** our server validates and settles the payment, **Then** the protected resource is returned and the payment response is reported in the v2-compatible format.
3. **Given** the client sends a malformed, expired, or mismatched `exact` payment, **When** our server processes the request, **Then** it rejects the payment with a protocol-consistent error and does not release the protected resource.

---

### User Story 2 - Our Client Can Pay a Coinbase v2 Server (Priority: P2)

As an integrator using our client SDK, I can access a Coinbase x402 v2 protected server so that our client remains interoperable with the ecosystem standard.

**Why this priority**: Server-side compliance alone is not enough; client-side interoperability is the second half of the compatibility promise.

**Independent Test**: Can be fully tested by using our client against a v2-compatible server fixture and observing a successful paid request without payload rewriting.

**Acceptance Scenarios**:

1. **Given** a Coinbase x402 v2 server returns a payment challenge for the `exact` scheme, **When** our client selects the payment option, **Then** it generates a payment payload that the v2 server accepts without custom compatibility flags.
2. **Given** the remote server expects protocol-standard `exact` semantics, **When** our client signs and submits the payment, **Then** the payment request uses the standard field layout and transport behavior required by the v2 spec.

---

### User Story 3 - Existing Users Have a Controlled Migration Path (Priority: P3)

As a maintainer of this repository, I can migrate the project toward spec-driven compatibility without unexpectedly breaking unrelated payment flows.

**Why this priority**: Compatibility work introduces risk to existing adopters; a bounded migration path reduces disruption and keeps the release shippable.

**Independent Test**: Can be fully tested by running regression coverage for existing non-`exact` flows and confirming the migration guidance describes what changed and what remains supported.

**Acceptance Scenarios**:

1. **Given** the repository already supports other payment schemes, **When** the `exact` compatibility changes are introduced, **Then** unrelated flows continue to behave as before unless explicitly documented otherwise.
2. **Given** existing users rely on the current custom `exact` format, **When** the compatibility release is prepared, **Then** the project documentation clearly states the supported compatibility path and any temporary fallback behavior.

---

### Edge Cases

- What happens when a payment challenge offers multiple schemes or networks and only the v2 `exact` option is interoperable?
- How does the system respond when a payment payload is structurally valid JSON but places `exact` authorization data in a non-standard field layout?
- What happens when the client and server disagree on token metadata required to validate an `exact` authorization?
- How does the system handle expired authorizations, replay attempts, or authorizations that do not match the challenged amount, asset, or recipient?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The project MUST treat the Coinbase x402 v2 specification as the normative contract for the `exact` payment scheme on EVM networks.
- **FR-002**: The server-facing payment challenge for `exact` MUST use the v2 field layout, naming, and transport semantics required for a standard v2 client to construct a payment without project-specific translation.
- **FR-003**: The client-facing payment submission for `exact` MUST use the v2 field layout, naming, and transport semantics required for a standard v2 server to validate the payment without project-specific translation.
- **FR-004**: The `exact` payment payload MUST represent transfer authorization data in the protocol-standard location and structure expected by the v2 spec rather than only in project-specific extension fields.
- **FR-005**: The server MUST validate that an incoming `exact` payment matches the challenged scheme, network, asset, amount, recipient, and authorization validity window before granting access to the protected resource.
- **FR-006**: The client MUST construct `exact` payments using token metadata and authorization semantics that are consistent with the challenged network and asset so that a v2-compliant server can verify the signature.
- **FR-007**: The facilitator-facing verification and settlement flows for `exact` MUST accept and process the same v2-compatible payment shape used on the wire between clients and servers.
- **FR-008**: The project MUST provide automated compatibility coverage for both directions of interoperability: Coinbase v2 client to our server, and our client to a v2-compatible server.
- **FR-009**: The project MUST preserve existing supported non-`exact` payment flows unless a deliberate breaking change is explicitly documented for this feature.
- **FR-010**: The project MUST document the new spec-aligned `exact` behavior, the interoperability target, and any temporary migration or fallback rules that remain during rollout.

### Key Entities *(include if feature involves data)*

- **Payment Challenge**: The server-provided description of what payment is acceptable for access to a protected resource, including scheme, network, asset, amount, recipient, timeout, and scheme-specific metadata.
- **Exact Payment Payload**: The client-submitted payment object used to answer a challenge, containing the accepted payment requirement, the signature material, and the authorization data required by the `exact` scheme.
- **Transfer Authorization**: The signed instruction authorizing the asset transfer for the `exact` flow, including payer, recipient, amount, validity window, and replay-protection value.
- **Compatibility Validation Result**: The observable outcome of verifying or settling a payment, including whether the payment is valid, why it failed if invalid, and settlement confirmation data when successful.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A stock Coinbase x402 v2 client can complete at least one automated end-to-end paid request against our protected `exact` endpoint with no compatibility patching.
- **SC-002**: Our client SDK can complete at least one automated end-to-end paid request against a v2-compatible `exact` server with no compatibility patching.
- **SC-003**: Automated regression coverage demonstrates that malformed, expired, replayed, or mismatched `exact` payments are rejected in all tested compatibility paths.
- **SC-004**: Existing automated tests for unaffected payment schemes continue to pass at the same rate as before the feature branch changes.
- **SC-005**: The repository contains a discoverable feature spec and migration-oriented documentation for the compatibility change before the implementation is considered ready to merge.

## Assumptions

- The scope of this feature is limited to making the `exact` scheme interoperable with Coinbase x402 v2 on the currently supported EVM path; broader multi-scheme redesign is out of scope.
- Coinbase's published x402 v2 specification and reference repository are treated as the compatibility source of truth for this feature.
- Existing `exact_permit` and other non-`exact` flows remain in scope only for regression protection, not for protocol redesign under this feature.
- Automated compatibility verification may rely on local fixtures, reference payloads, or integration harnesses that simulate a v2-compliant peer when a live external dependency is impractical.

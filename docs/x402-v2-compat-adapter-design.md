# x402 V2 Compatibility Adapter Design

## Status

Proposed

## Overview

This document proposes an in-repo compatibility adapter for x402.

The target state is:

- internal payment logic stays v2-oriented
- CLI, server, and facilitator each expose a compatibility boundary
- any one of the three actors can upgrade first without requiring the other two to upgrade at the same time
- the same compatibility pattern can be reused for future protocol versions

## Context

The current repository is already centered around the v2 protocol model, while some borrowers and integration surfaces still depend on older request and response shapes. The migration requirement is:

- new integrations should move toward v2
- existing borrowers should switch with minimal or no application changes
- any one of `CLI / server / facilitator` may upgrade to v2 before the others
- if only one actor upgrades, the remaining two older actors must still interoperate with it
- version handling must not leak into borrower business logic
- facilitator, server, and CLI must remain operable during the migration window

This document proposes an in-repo compatibility adapter, not a separate project.

## Goals

- Keep `dev/v2` as the canonical implementation baseline
- Add a compatibility layer that lets old and new callers coexist
- Isolate version branching at protocol boundaries
- Keep core payment logic single-path where possible
- Guarantee mixed-version interoperability when only one of the three actors upgrades first
- Support phased migration with observability and rollback

## Non-Goals

- Rebuild the existing v1 implementation as a first-class long-term code path
- Introduce a new standalone service or repository
- Allow arbitrary version-specific branching in borrower code

## Decision Summary

We will add a compatibility adapter layer inside the current x402 repository. The adapter will sit at the transport and SDK boundary, normalize incoming protocol objects into one internal canonical model, and materialize outbound responses into either v1-compatible or v2-compatible shapes.

The internal canonical model will be v2-oriented.

This means:

- borrower-facing SDK entrypoints remain stable
- CLI can talk to old and new server/facilitator combinations
- server can interoperate with old and new CLI/facilitator combinations
- facilitator can interoperate with old and new CLI/server combinations
- no deployment ordering is required across CLI, server, and facilitator

## Compatibility Requirement

The real migration requirement is stronger than "borrowers can update to a new adapter". In practice, developers may not proactively update. Therefore compatibility must hold for mixed-version deployment where any one of the three actors upgrades first.

Actors:

- CLI
- server
- facilitator

Required minimum guarantee:

- upgrade CLI only: old server + old facilitator still work
- upgrade server only: old CLI + old facilitator still work
- upgrade facilitator only: old CLI + old server still work

Extended guarantee:

- any two upgraded actors must also work with the remaining old actor

This means compatibility logic must exist in all three actors, not only in the borrower-facing SDK.

## Why Not a Separate Project

Creating a separate compatibility project would duplicate:

- protocol types
- transport codecs
- verification and settlement wiring
- release and versioning workflows

It would also create drift between the main v2 branch and the compatibility behavior. The adapter must evolve together with v2, so it belongs in the same repo and should share the same test matrix.

## Existing Baseline

The current codebase already has partial multi-version primitives:

- `x402Client` supports `register()` and `registerV1()`
- `x402Facilitator` supports `register()` and `registerV1()`
- `x402HTTPClient` already handles v1/v2 header differences
- `x402ResourceServer` is v2-first and currently emits v2 `PaymentRequired`

Relevant files:

- `typescript/packages/core/src/client/x402Client.ts`
- `typescript/packages/core/src/facilitator/x402Facilitator.ts`
- `typescript/packages/core/src/http/x402HTTPClient.ts`
- `typescript/packages/core/src/server/x402ResourceServer.ts`
- `typescript/packages/core/src/types/payments.ts`
- `typescript/packages/core/src/types/v1/index.ts`

## Actual V1 vs V2 Differences

The compatibility problem is not only a version flag. In the current codebase, v1 and v2 differ across schema, transport, and semantics.

### 1. Payment requirement shape changed

Current schema definitions show:

- v1 uses `maxAmountRequired`
- v2 uses `amount`
- v1 embeds `resource`, `description`, and `mimeType` inside each requirement
- v2 moves resource metadata to top-level `resource`
- v2 adds top-level `extensions`

Implication:

- converting `v1 -> v2` requires lifting resource fields out of each requirement
- converting `v2 -> v1` requires duplicating resource fields back into every requirement
- if multiple v2 requirements share one resource, the downgrade is straightforward
- if future v2 semantics allow per-option divergence, downgrade becomes lossy

### 2. Payment payload envelope changed

Current schema definitions show:

- v1 payload is `{ x402Version, scheme, network, payload }`
- v2 payload is `{ x402Version, accepted, payload, resource?, extensions? }`

Implication:

- `v1` does not carry the selected requirement object directly
- `v2` explicitly couples payload to `accepted`
- converting `v1 -> canonical` requires the paired requirements object as context
- this means payload conversion is not purely local; it depends on the original challenge or selected requirement

This is one of the main design difficulties.

### 3. Network validation changed

Current schema definitions show:

- v1 network accepts any non-empty string
- v2 network expects CAIP-2-like format with a colon

Implication:

- some old deployed values may not be valid v2 network identifiers
- compatibility may require a network alias mapping layer, not only field renaming
- strict v2 validation at ingress can break old traffic unless normalization happens before validation or via relaxed compatibility schemas

### 4. HTTP wire format changed

Current HTTP client behavior shows:

- v2 payment request header: `PAYMENT-SIGNATURE`
- v1 payment request header: `X-PAYMENT`
- v2 challenge header: `PAYMENT-REQUIRED`
- v1 challenge can still be body-based
- v2 settlement header: `PAYMENT-RESPONSE`
- v1 settlement header: `X-PAYMENT-RESPONSE`

Implication:

- CLI and server need dual header read/write support
- CORS exposure behavior also differs in old and new wrappers
- transport compatibility cannot be solved by data conversion alone

### 5. Resource server behavior is currently v2-first

Current `x402HTTPResourceServer` behavior shows:

- challenge responses are emitted as `PAYMENT-REQUIRED`
- settlement responses are emitted as `PAYMENT-RESPONSE`
- payment extraction currently checks `PAYMENT-SIGNATURE` first and does not yet act as a full old/new dual parser at this boundary

Implication:

- server compatibility is currently incomplete for "old caller against upgraded server"
- this boundary needs explicit compatibility work, not just internal type converters

### 6. Mechanism support is uneven across versions

Current mechanism code shows at least one important pattern:

- some v1 implementations already reuse v2 signing logic and then rematerialize into v1 shape
- for example, TRON v1 client adapts a v1 requirement into a v2-like requirement before creating payload

Implication:

- this is good news because some business logic can be shared
- but support is not guaranteed to be symmetric across all mechanisms
- each mechanism package must be checked for where compatibility is merely structural versus where business rules differ

### 7. `/supported` compatibility is a real risk area

Current codebase uses a flat version-tagged `kinds` response in the newer core path, while legacy consumers may have assumptions about supported shape and available metadata.

Implication:

- `/supported` is not just a passive discovery endpoint
- server initialization and routing depend on it
- if upgraded facilitator changes `/supported` behavior without compatibility, old servers can fail before any payment request is attempted

## Compatibility Difficulty

The difficulty is not uniform. Some differences are straightforward adapters; some are semantic bridges.

### Low to medium difficulty

- header dual-read and dual-write
- basic field renaming such as `maxAmountRequired <-> amount`
- top-level versus nested resource reshaping
- wrapping and unwrapping `accepted`

These are mostly interface compatibility tasks.

### Medium difficulty

- maintaining one canonical requirement selection flow while preserving old caller behavior
- mapping old loose network identifiers into v2-compatible canonical values
- preserving old error response expectations while using v2-oriented internals
- `/supported` response compatibility

These start affecting runtime behavior and negotiation.

### High difficulty

- converting `PaymentPayloadV1` without losing the selected requirement context
- keeping verify and settle semantics stable when old and new envelopes carry different information
- guaranteeing single-actor upgrade safety for `server <-> facilitator`
- ensuring mechanism-specific implementations behave the same after normalization

These are business compatibility problems, not just interface compatibility problems.

## What This Means For The Design

The current v1/v2 gap suggests:

1. A converter-only design is not enough.
2. Compatibility must include context-aware normalization, especially for payload conversion.
3. Server and facilitator boundaries need dedicated compatibility wrappers.
4. Validation must be compatibility-aware; otherwise strict v2 validation will reject old traffic before adaptation.
5. Mechanism-specific audit is required for each supported chain and scheme.

## Interface Compatibility vs Business Compatibility

These two are related but not identical.

### Interface compatibility

Interface compatibility means the protocol edge still works:

- old and new headers can be parsed
- old and new request bodies can be parsed
- old and new response shapes can be emitted
- `/supported`, `/verify`, and `/settle` can still be called successfully

This solves "the systems can talk to each other".

### Business compatibility

Business compatibility means the behavior still matches expectations:

- payment selection outcome is still valid
- amount, asset, payTo, and timeout semantics are preserved
- verify still accepts old-valid traffic
- settle still produces the expected transaction semantics
- old fallback behavior and error semantics are preserved

This solves "the payment flow still behaves correctly".

### Why both are required

For this migration, interface compatibility alone is not sufficient.

Example:

- old server can call upgraded facilitator
- upgraded facilitator can parse the old request
- but if the semantic mapping from old requirement to canonical v2 meaning is wrong, verify or settle can still fail

Therefore the migration plan must include:

- protocol compatibility at the transport edge
- semantic compatibility in normalization and execution

## Can Old CLI + Old Server + New Facilitator Reach V2 Settle

If the facilitator is upgraded to v2 and both CLI and server remain old, then reaching v2 internal settle is possible only if the upgraded facilitator includes a complete compatibility layer.

### Without a compatibility layer

This does not work reliably:

- old server may not understand upgraded `/supported`
- old verify and settle envelopes may fail schema validation
- the request may fail before settlement logic is even reached

### With a complete compatibility layer

This can work:

1. old CLI talks to old server using old challenge and payment headers
2. old server talks to upgraded facilitator using old `/supported`, `/verify`, and `/settle`
3. upgraded facilitator normalizes old request envelopes into canonical v2-oriented input
4. upgraded facilitator executes verify and settle using v2 internal logic
5. upgraded facilitator materializes the result back into an old-compatible response for old server

This means:

- externally the system still looks like v1
- internally facilitator can execute v2-style logic

### Required condition

This only works if old request data carries enough information to reconstruct the canonical settle input.

In practice this means the compatibility layer must handle:

- selected requirement reconstruction for v1 payloads
- network alias or normalization
- semantic mapping for amount and asset fields
- any mechanism-specific data required by the v2 settle logic

If old request data does not carry enough information, then pure interface compatibility is not enough and old traffic cannot safely reach v2 settle.

## Design Principles

1. Version branching only at the edge.
2. Canonical model inside, adapter model outside.
3. Each actor must be backward-compatible on ingress and egress during the migration window.
4. Borrowers should not decide protocol version explicitly in normal flows.
5. Server and facilitator should not maintain duplicated business logic for each version.
6. Migration must be observable, configurable, and reversible.

## Proposed Package Shape

Initial placement:

- `typescript/packages/core/src/compat/`

Proposed modules:

- `types.ts`
- `detect.ts`
- `normalize.ts`
- `materialize.ts`
- `client/compatClient.ts`
- `http/compatHttpClient.ts`
- `server/compatResourceServer.ts`
- `facilitator/compatFacilitatorTransport.ts`

If the surface grows, it can later be promoted into its own package under `typescript/packages/compat`, but the first iteration should stay close to `core`.

## Canonical Model

We standardize internally on a v2-oriented shape.

```ts
export type CanonicalPaymentRequirement = {
  scheme: string;
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra: Record<string, unknown>;
};

export type CanonicalResourceInfo = {
  url: string;
  description?: string;
  mimeType?: string;
};

export type CanonicalPaymentRequired = {
  version: 1 | 2;
  resource?: CanonicalResourceInfo;
  accepts: CanonicalPaymentRequirement[];
  extensions?: Record<string, unknown>;
  error?: string;
};

export type CanonicalPaymentPayload = {
  version: 1 | 2;
  accepted: CanonicalPaymentRequirement;
  payload: Record<string, unknown>;
  resource?: CanonicalResourceInfo;
  extensions?: Record<string, unknown>;
};
```

Notes:

- `version` is preserved as metadata for re-materialization and logging
- `resource` stays optional because v1 callers may not provide it
- canonical payload always has `accepted`; v1 payloads will be backfilled during normalization using the paired requirements

## Adapter Responsibilities

### Detect

The detector determines whether a protocol object is:

- v1
- v2
- unsupported

Detection sources:

- explicit `x402Version`
- header shape
- payload structure
- route-level or config-level override

### Normalize

Normalization converts version-specific payloads into canonical objects.

Examples:

- `PaymentRequiredV1 -> CanonicalPaymentRequired`
- `PaymentRequiredV2 -> CanonicalPaymentRequired`
- `PaymentPayloadV1 + requirements -> CanonicalPaymentPayload`
- `PaymentPayloadV2 -> CanonicalPaymentPayload`

### Materialize

Materialization converts canonical objects back to a requested protocol version.

Examples:

- `CanonicalPaymentRequired -> PaymentRequiredV1`
- `CanonicalPaymentRequired -> PaymentRequiredV2`
- `CanonicalPaymentPayload -> PaymentPayloadV1`
- `CanonicalPaymentPayload -> PaymentPayloadV2`

## CLI Design

### Objective

CLI should continue to expose one user-facing command set and should not ask operators to manually choose protocol version in routine usage.

### Proposed Handling

CLI depends on a compatibility HTTP client instead of directly branching on protocol versions.

Flow:

1. Receive HTTP challenge
2. Detect v1/v2 from headers or body
3. Normalize to canonical `PaymentRequired`
4. Pass canonical requirement selection into the compatibility client
5. Create canonical payload
6. Materialize payload into the required wire version
7. Emit correct payment headers automatically

This is required so that:

- new CLI can consume old server challenge formats
- new CLI can emit old wire formats when talking to old downstreams
- new CLI can speak v2 end-to-end when the other sides have upgraded

### CLI Boundary

CLI owns:

- user input
- network and asset selection policy
- request retry orchestration
- display and debug logging

CLI does not own:

- version-specific payment object branching
- protocol shape conversion
- settlement response decoding differences

### CLI Compatibility Obligation

An upgraded CLI must be able to:

- read old and new `PaymentRequired` responses
- emit old and new payment headers
- submit old and new payment payload shapes as needed
- decode old and new settlement responses

This ensures "CLI upgrades first" is safe.

### CLI Config

Add optional compatibility controls:

- `mode=auto|force-v1|force-v2`
- `preferV2=true|false`
- `emitCompatibilityDebug=true|false`

Default should be `mode=auto` and `preferV2=true`.

## Server Design

### Objective

Server must build payment requirements once and return a caller-compatible challenge format without duplicating paywall logic.

### Proposed Handling

Server remains v2-first internally.

Flow:

1. Build canonical payment requirements using existing v2 path
2. Build canonical `PaymentRequired`
3. Determine outbound version using capability strategy
4. Materialize to v1 or v2
5. Encode into transport-specific response

In addition, server ingress for follow-up paid requests must accept both old and new payment submission shapes and decode them into one canonical verification request.

### Capability Strategy

Server should choose outbound version from:

1. explicit route override
2. explicit request capability header
3. tenant or borrower configuration
4. default policy

Suggested first version:

- support config-driven mode first
- add request-header negotiation second

Because single-actor upgrade compatibility is required, server must also support passive fallback:

- if request carries an old payment header, decode old flow
- if request carries a new payment header, decode new flow
- if caller capability is unknown, emit the safest challenge shape based on route or tenant default

### Server Boundary

Server owns:

- canonical requirement construction
- resource metadata
- extension declaration enrichment
- outbound version negotiation

Server does not own:

- duplicated per-version business logic
- duplicated per-version scheme implementations

### Server Compatibility Obligation

An upgraded server must be able to:

- return a challenge old CLI understands
- return a challenge new CLI understands
- accept old follow-up payment submissions
- accept new follow-up payment submissions
- talk to old facilitator request and response shapes
- talk to new facilitator request and response shapes

This ensures "server upgrades first" is safe.

### Important Change

Current `x402ResourceServer.createPaymentRequiredResponse()` emits v2 directly. We should introduce a compatibility wrapper instead of stuffing v1 branching into all callers.

Proposed shape:

```ts
class CompatResourceServer {
  constructor(private readonly inner: x402ResourceServer, private readonly config: CompatConfig) {}

  async createPaymentRequiredResponse(...) {
    const canonical = await this.inner.createCanonicalPaymentRequired(...);
    const targetVersion = this.resolveTargetVersion(...);
    return materializePaymentRequired(canonical, targetVersion);
  }
}
```

This wrapper can begin as a thin class around existing `x402ResourceServer` methods.

## Facilitator Design

### Objective

Facilitator should accept both old and new request shapes while keeping verify and settle logic single-path.

### Proposed Handling

Facilitator transport layer becomes compatibility-aware.

Flow:

1. Receive `/supported`, `/verify`, or `/settle`
2. Detect request version
3. Normalize request into canonical verify or settle input
4. Route to existing scheme facilitator logic
5. Produce canonical response
6. Materialize response based on request version

This is required so that:

- new facilitator can still serve old server callers
- old-style verify and settle envelopes remain valid at the edge
- new facilitator can also serve new callers without coordinated rollout

### `/supported`

`/supported` should expose the supported matrix with explicit version metadata. Internally we should keep a version-aware registry so we can:

- answer with flat version-tagged kinds
- preserve v1-compatible consumers where needed
- keep extensions and signers attached to the canonical supported view

### `/verify` and `/settle`

Compatibility handling should sit above the current `SchemeNetworkFacilitator` layer.

`SchemeNetworkFacilitator` implementations should continue to receive canonical `PaymentPayload` and `PaymentRequirements` equivalents, not raw transport-version-specific payloads.

This avoids:

- duplicating mechanism verification logic
- version-specific bugs in every mechanism package
- future migration complexity for v3

### Facilitator Boundary

Facilitator transport owns:

- request version detection
- request normalization
- response materialization

Mechanism-specific facilitator owns:

- signature validation
- settlement execution
- scheme-specific invariant checks

### Facilitator Compatibility Obligation

An upgraded facilitator must be able to:

- return `/supported` data consumable by old server behavior
- return `/supported` data consumable by new server behavior
- accept old verify requests
- accept new verify requests
- accept old settle requests
- accept new settle requests

This ensures "facilitator upgrades first" is safe.

## Borrower SDK Surface

Borrowers should receive one stable surface.

Recommended public entrypoints:

- `createPaymentPayload(paymentRequired)`
- `wrapAxiosWithPayment(...)`
- `wrapFetchWithPayment(...)`
- `createHttpClient(...)`

The public contract should accept either v1 or v2 challenge objects, but it should always hide:

- version detection
- payload conversion
- header naming differences

Borrowers may optionally specify compatibility mode for debugging or hard rollback, but this must not be required in the steady state.

## Developer Impact

The goal is not "nobody sees any change". The real goal is:

- borrower and business developers should see little or no change
- infrastructure authors should see controlled framework-level changes
- business logic should not be polluted with version branching

### Borrower and CLI users

Expected impact:

- ideally no change in normal usage
- same high-level commands and payment flow
- optional compatibility flags may exist but should not be required

Not acceptable:

- forcing borrowers to manually branch on v1 versus v2
- forcing routine callers to rewrite business logic for the migration

### Server authors

If future server development is "v2 by default, with built-in v1 compatibility", then server authors should continue writing business logic in v2 terms:

- payment options
- resource metadata
- amount, asset, payTo
- extensions

Expected framework-level changes for server authors:

- initialize through a compatibility-aware server wrapper or builder
- configure a default compatibility strategy such as `auto`, `force-v1`, or `force-v2`
- run mixed-version compatibility tests in addition to v2-only tests

Server authors should not have to:

- manually parse old and new payment headers in route code
- write per-route `if v1 else v2` branches
- maintain two copies of paywall business logic

### Facilitator authors

If future facilitator development is "v2 by default, with built-in v1 compatibility", then facilitator authors should continue writing verification and settlement logic against canonical v2-oriented inputs.

Expected framework-level changes for facilitator authors:

- expose endpoints through a compatibility-aware transport wrapper
- register old and new request parsers and response materializers
- run mixed-version endpoint tests

Facilitator authors should not have to:

- maintain two full copies of verify and settle logic
- scatter `x402Version` branching throughout mechanism code
- duplicate chain-specific business rules for v1 and v2

### What changes in practice

In practice, "develop v2 while remaining compatible with v1" means:

- business logic is written once, against canonical v2-oriented models
- transport edges must support old and new protocol shapes
- tests must cover single-actor upgrade scenarios
- new features must be reviewed for downgrade behavior

### What must be considered for every new v2 feature

Every new server or facilitator capability should be evaluated against:

1. Can old callers ignore the new field safely?
2. Can the new field be downgraded into a v1-compatible representation?
3. If downgrade is impossible, can the feature be disabled in compatibility mode?
4. Will old error handling still behave correctly?

### Desired developer experience

If the design is implemented correctly:

- server authors use a compat-aware server framework and otherwise write normal v2 business logic
- facilitator authors use a compat-aware transport layer and otherwise write normal v2 verification and settlement logic
- borrower developers remain mostly unaware of the migration

If the design is implemented poorly:

- route code contains version branches
- mechanism logic is duplicated
- each new chain integration must implement separate v1 and v2 flows
- upgrades become fragile and hard to test

## Migration Strategy

### Phase 1

- add canonical types and converters
- introduce compatibility client and compatibility HTTP client
- add logging around detected versions and materialized versions
- make upgraded CLI backward-compatible first

### Phase 2

- introduce compatibility server wrapper
- allow server response version selection by config
- make upgraded server consume both old and new payment submissions
- make upgraded server interoperate with old and new facilitator shapes

### Phase 3

- introduce compatibility facilitator transport
- make upgraded facilitator accept old and new `/supported`, `/verify`, and `/settle` expectations
- validate mixed-mode integration in e2e tests

### Phase 4

- gradually move borrowers to unified entrypoints
- flip tenant or route defaults toward v2
- remove explicit legacy entrypoints after migration window

## Observability

Emit structured logs and metrics for:

- inbound version detected
- outbound version materialized
- fallback or downgrade reason
- conversion failures
- borrower identifier or tenant identifier
- route and scheme/network dimensions

Recommended counters:

- `x402.compat.detected.v1`
- `x402.compat.detected.v2`
- `x402.compat.materialized.v1`
- `x402.compat.materialized.v2`
- `x402.compat.fallback_total`
- `x402.compat.conversion_error_total`

## Testing Strategy

### Unit Tests

- `fromV1` and `toV1`
- `fromV2` and `toV2`
- invalid shape rejection
- detector precedence rules

### Contract Tests

- `v1 -> canonical -> v1`
- `v2 -> canonical -> v2`
- `v1 -> canonical -> v2`
- `v2 -> canonical -> v1`

### Integration Tests

- old borrower against compatibility server
- new borrower against compatibility server
- compatibility client against old facilitator
- compatibility client against new facilitator
- mixed server and facilitator version matrix

### E2E Matrix

- borrower=v1, server=v1, facilitator=v1
- borrower=v1, server=compat, facilitator=compat
- borrower=compat, server=compat, facilitator=compat
- borrower=compat, server=v2, facilitator=v2

### Single-Actor Upgrade Matrix

The following are mandatory rollout gates:

- CLI=v2-compat, server=v1, facilitator=v1
- CLI=v1, server=v2-compat, facilitator=v1
- CLI=v1, server=v1, facilitator=v2-compat

Recommended additional gates:

- CLI=v2-compat, server=v2-compat, facilitator=v1
- CLI=v2-compat, server=v1, facilitator=v2-compat
- CLI=v1, server=v2-compat, facilitator=v2-compat
- CLI=v2-compat, server=v2-compat, facilitator=v2-compat

## Acceptance Criteria

Acceptance must validate both:

- interface compatibility: the systems can still talk to each other
- business compatibility: the payment flow still behaves correctly

### 1. Converter and schema acceptance

The following must pass:

- `PaymentRequiredV1 -> canonical -> PaymentRequiredV1`
- `PaymentRequiredV2 -> canonical -> PaymentRequiredV2`
- `PaymentPayloadV1 + requirements -> canonical -> PaymentPayloadV1`
- `PaymentPayloadV2 -> canonical -> PaymentPayloadV2`
- `PaymentRequiredV1 -> canonical -> PaymentRequiredV2`
- `PaymentRequiredV2 -> canonical -> PaymentRequiredV1`
- `PaymentPayloadV1 + requirements -> canonical -> PaymentPayloadV2`
- `PaymentPayloadV2 -> canonical -> PaymentPayloadV1`

Required assertions:

- `maxAmountRequired <-> amount` mapping is correct
- resource lifting and flattening is correct
- selected requirement reconstruction is correct for v1 payloads
- `extensions` are preserved when downgrade is supported
- network normalization or alias mapping is correct

### 2. Protocol boundary acceptance

The following edge behaviors must pass:

- CLI can read old challenge format
- CLI can read new challenge format
- server can accept `X-PAYMENT`
- server can accept `PAYMENT-SIGNATURE`
- CLI can decode `X-PAYMENT-RESPONSE`
- CLI can decode `PAYMENT-RESPONSE`
- facilitator can accept old `/verify`
- facilitator can accept new `/verify`
- facilitator can accept old `/settle`
- facilitator can accept new `/settle`
- `/supported` is consumable by old server behavior
- `/supported` is consumable by new server behavior

This validates interface compatibility.

### 3. Single-actor upgrade acceptance

These are mandatory acceptance gates:

- `CLI=v2-compat, Server=v1, Facilitator=v1`
- `CLI=v1, Server=v2-compat, Facilitator=v1`
- `CLI=v1, Server=v1, Facilitator=v2-compat`

Recommended additional gates:

- `CLI=v2-compat, Server=v2-compat, Facilitator=v1`
- `CLI=v2-compat, Server=v1, Facilitator=v2-compat`
- `CLI=v1, Server=v2-compat, Facilitator=v2-compat`
- `CLI=v2-compat, Server=v2-compat, Facilitator=v2-compat`

Each case must validate the full path:

1. challenge creation succeeds
2. payment submission succeeds
3. verify succeeds or fails with expected semantic result
4. settle succeeds or fails with expected semantic result
5. upstream consumer can parse the result

### 4. Business compatibility acceptance

The following behavioral checks must be validated against old baseline behavior:

- selected payment requirement remains valid and expected
- amount, asset, payTo, and timeout semantics are preserved
- verify success and failure behavior remains compatible
- settle result semantics remain compatible
- `payer`, `transaction`, and `network` fields remain compatible
- old fallback behavior remains compatible
- old invalid reason and error reason handling remains compatible

This validates that the chain not only "works" but still behaves as expected.

### 5. Real flow end-to-end acceptance

At least one real mechanism-specific path must run end-to-end:

- challenge
- payment creation
- verify
- settle

This must be executed with at least one supported real payment mechanism, not only mocks.

### 6. Observability and rollback acceptance

The implementation is not acceptable unless the following can be observed:

- inbound detected version
- outbound materialized version
- fallback or downgrade reason
- conversion failure reason
- route, scheme, and network dimensions where applicable

The implementation is not operationally safe unless:

- compatibility mode can be forced to old behavior
- compatibility mode can be forced to new behavior
- auto mode can be enabled
- rollback to old behavior is possible without rewriting business code

## Recommended Validation Sequence

1. Run converter and schema unit tests.
2. Run protocol boundary tests.
3. Run mandatory single-actor upgrade matrix.
4. Run business compatibility regression tests.
5. Run at least one real mechanism end-to-end flow.
6. Verify logs, metrics, fallback visibility, and rollback switches.

## Open Questions

1. For "server upgrades first", what exact signal can the server use to decide whether to emit old or new challenge shape when caller capability is unknown?
2. For "facilitator upgrades first", do old servers require a distinct legacy `/supported` response shape, or is the current flat version-tagged shape sufficient?
3. Do we need TypeScript-only compatibility first, or must Python clients and servers be covered in the first-wave guarantee?
4. Which old header names and body fields are relied on by deployed callers and must therefore be preserved exactly?
5. How long do we expect mixed single-actor upgrade deployments to exist before coordinated upgrades become realistic?

## Initial Implementation Plan

1. Add `core/src/compat/types.ts`
2. Add `core/src/compat/detect.ts`
3. Add `core/src/compat/normalize.ts`
4. Add `core/src/compat/materialize.ts`
5. Add `core/src/compat/client/compatClient.ts`
6. Add tests for v1/v2 round-trip conversions
7. Add a thin compatibility wrapper for HTTP client
8. Add a thin compatibility wrapper for resource server
9. Add a thin compatibility transport wrapper for facilitator endpoints

## Recommendation

Start with TypeScript compatibility in `core`, using v2 as the canonical internal model and restricting version-aware branching to transport and SDK edges. This gives us the lowest-risk path to let borrowers switch without touching business logic, while keeping the migration logic close to the active v2 implementation.

## Future Protocol Evolution Plan

This adapter should be treated as a long-term compatibility layer, but it is not a guarantee that every future protocol change can always be made compatible automatically.

The correct goal is:

- make future protocol upgrades compatible by default
- force explicit review when compatibility cannot be preserved
- keep compatibility logic centralized in the adapter layer

## Generic Compatibility Framework

Although this document is motivated by the v1 to v2 migration, the adapter should not be treated as a one-off v1/v2 migration utility.

At the architectural level, the adapter is a generic version compatibility framework.

Its core pattern is always the same:

1. detect the source version
2. normalize version-specific input into a canonical model
3. run core logic against the canonical model
4. materialize output into the target version expected by the peer

This means the framework shape is stable even when concrete version mappings change.

### Stable framework responsibilities

The following responsibilities should remain stable across future versions:

- version detection
- normalization into canonical model
- materialization out of canonical model
- capability negotiation
- fallback policy
- compatibility configuration
- observability and downgrade tracing

### Version-specific responsibilities

The following are expected to vary per version pair:

- schema mapping rules
- field rename and reshape logic
- downgrade behavior for new fields
- semantic compatibility rules
- unsupported feature handling

In other words:

- the adapter framework should remain the same
- the mapping plugins and compatibility policies will evolve

### How to think about future versions

The current migration is:

- `v1 <-> v2`

But the same framework should later support:

- `v2 <-> v3`
- `v3 <-> v4`
- `legacy <-> current`

without changing the overall architecture.

### Design consequence

Implementation should avoid baking `v1` and `v2` assumptions directly into the framework itself.

Prefer this shape:

- generic compatibility pipeline
- version-specific normalizers and materializers
- explicit capability and downgrade policies

Avoid this shape:

- hard-coded special cases scattered throughout business code
- version-specific branches embedded into core payment logic
- migration code that only works for one historical transition

### Practical recommendation

Treat `v1/v2` as the first compatibility mapping package built on top of a reusable compatibility framework.

That allows the current work to solve the immediate migration while also establishing the pattern for future protocol evolution.

### What the adapter can handle well

The adapter is expected to handle future changes such as:

- field renaming
- field relocation inside envelopes
- header renaming
- additive optional fields
- response shape adjustments
- transport-level differences
- backward-compatible capability extension

These are structural or transport changes where the underlying payment semantics remain mappable.

### What the adapter cannot guarantee automatically

The adapter cannot guarantee compatibility when future protocol changes involve:

- required new information that old requests never carried
- semantic changes that alter payment meaning
- security model changes that require new proofs or trust assumptions
- features that cannot be downgraded into an older protocol shape

Examples:

- a future settle flow requires a new mandatory authorization context that old versions never send
- a future verify flow changes the meaning of asset or amount validation
- a future protocol adds multi-step atomic settlement that older versions cannot express

In these cases, the adapter may still support partial compatibility, but not transparent compatibility.

## Adapter Limits

The adapter should be documented as having the following limits:

1. It can bridge structure more easily than meaning.
2. It can infer missing values only when there is a reliable deterministic mapping.
3. It must not fabricate security-critical data.
4. It must not silently downgrade features if that changes safety or correctness.
5. It may disable some new features in compatibility mode when downgrade is impossible.

This is important so future protocol work does not assume "the adapter will always solve it".

## Protocol Evolution Rules

To keep future versions compatible through the adapter, protocol changes should follow these rules.

### 1. Canonical model first

New protocol versions should evolve by extending the canonical internal model rather than bypassing it.

Implication:

- new transport envelopes should still normalize into canonical objects
- canonical model changes must be reviewed for downgrade impact

### 2. Additive over destructive

Prefer adding optional fields over removing or redefining existing semantics.

Implication:

- old callers can ignore what they do not understand
- new callers can still work through canonical mapping

### 3. Every new field needs a downgrade story

For each new protocol field, define one of:

- ignored safely by old callers
- derivable from old fields
- downgrade-compatible representation exists
- feature disabled in compatibility mode

If none of these is true, the change is a breaking change and should be treated as such.

### 4. Do not make hidden semantics mandatory

Avoid changes where old requests appear structurally valid but are semantically unusable because they lack new hidden meaning.

If a new semantic dependency is mandatory:

- encode it explicitly
- mark the change as compatibility-sensitive
- define compatibility behavior up front

### 5. Security-sensitive changes require explicit compatibility review

Any change affecting signing, authorization, replay protection, trust boundaries, or settlement authorization must go through security and compatibility review together.

Compatibility must never be achieved by weakening security guarantees.

### 6. Capability-gated features are preferred

When a new feature cannot be safely downgraded, gate it by capability instead of forcing it into all flows.

Implication:

- old callers continue using compatible baseline behavior
- new callers opt into the feature explicitly or via negotiated capability

## Future Upgrade Workflow

Every future protocol upgrade should follow this workflow before rollout.

### Step 1. Classify the change

Determine whether the change is:

- structural only
- semantic but mappable
- capability-gated
- breaking

### Step 2. Define canonical impact

For each changed field or behavior:

- how it maps into canonical model
- whether canonical model must be extended
- whether old versions can still normalize into it

### Step 3. Define downgrade behavior

For each new capability:

- can old versions ignore it
- can it be represented approximately
- must it be disabled in compatibility mode
- is it incompatible by design

### Step 4. Update compatibility matrix

For the new version `vN`, update the matrix for:

- `vN <-> vN-1`
- `vN <-> canonical`
- single-actor upgrade cases involving `vN`

### Step 5. Extend validation and acceptance tests

Add:

- round-trip conversion tests
- cross-version conversion tests
- single-actor mixed-version tests
- feature-gated compatibility tests

### Step 6. Document unsupported downgrade cases

If any feature cannot be made transparent for old callers:

- state it explicitly
- define fallback behavior
- document what compatibility mode disables

## Compatibility Modes For Future Versions

To support ongoing protocol evolution, compatibility behavior should remain explicit and configurable.

Recommended modes:

- `auto`: detect and adapt based on peer version or capability
- `prefer-latest`: use the newest compatible representation when safe
- `force-legacy`: force old-compatible behavior
- `force-latest`: require newest behavior and fail otherwise

This allows:

- safe rollout
- reversible rollout
- debugging mixed-version failures

## Acceptance For Future Upgrades

Every future protocol upgrade should be considered acceptable only if all of the following are true:

1. New envelopes normalize into canonical model correctly.
2. Previous supported version still interoperates through compatibility mode.
3. Single-actor upgrade safety is revalidated.
4. Unsupported downgrade cases are explicitly documented.
5. Security semantics are not weakened by compatibility behavior.

## Recommendation For Future Work

Treat compatibility as part of protocol design, not as cleanup after the fact.

That means:

- every protocol proposal should include compatibility impact
- every new feature should declare downgrade behavior
- every release should update the compatibility matrix
- every breaking semantic change should be explicitly labeled instead of being hidden behind adapter assumptions

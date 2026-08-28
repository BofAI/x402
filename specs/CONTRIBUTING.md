# Specs Contributing Guide

Use this guide when changing the normative x402 v2 documentation in this repository.

## Directory Structure

```text
specs/
├── x402-specification-v2.md
├── transports-v2/
│   ├── http.md
│   └── mcp.md
├── schemes/
│   ├── exact/
│   ├── upto/
│   ├── batch-settlement/
│   ├── auth-capture/
│   └── exact-gasfree/
├── extensions/
├── scheme_template.md
├── scheme_impl_template.md
└── transport_template.md
```

## Specification Types

### Core Protocol

[`x402-specification-v2.md`](x402-specification-v2.md) defines the shared v2 message schemas,
facilitator API, discovery interface, and cross-cutting security rules.

### Schemes

Each scheme has a transport-independent overview named `scheme_<name>.md`. Each implemented network
family has a binding named `scheme_<name>_<network-family>.md`.

Current bindings are:

| Scheme | EVM | TRON |
| --- | --- | --- |
| `exact` | Yes | Yes |
| `upto` | Yes | Yes |
| `batch-settlement` | Yes | Yes |
| `auth-capture` | Yes | No |
| `exact_gasfree` | No | Yes |

### Transports

Transport documents define where the shared protocol objects are carried. This repository specifies
HTTP and MCP under `transports-v2/`.

### Extensions

Extension documents define optional data and lifecycle behavior layered on the core protocol. An
extension belongs in this directory only when the current SDK implements it.

## Proposing a Change

1. Explain the problem and why an existing scheme, transport, or extension does not cover it.
2. Update the appropriate overview and every affected network binding.
3. Update [`README.md`](README.md) when the support matrix or document set changes.
4. Update the TypeScript implementation and tests in the same change when behavior changes.
5. Verify all relative links and examples before submitting the change.

Use these templates:

| Change | Template |
| --- | --- |
| New scheme overview | [`scheme_template.md`](scheme_template.md) |
| New network binding | [`scheme_impl_template.md`](scheme_impl_template.md) |
| New transport | [`transport_template.md`](transport_template.md) |

## Writing Rules

- Use **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** in their RFC 2119 sense.
- Use `x402Version: 2` as a JSON number, never a string.
- Use CAIP-2 identifiers: `eip155:<chain-id>` for EVM and `tron:<hex-chain-id>` for TRON.
- Express token amounts as base-10 strings in atomic units.
- Keep Base58Check TRON addresses on the wire unless a binding explicitly requires 20-byte hex for
  typed-data construction.
- Include payload examples, verification rules, settlement rules, error behavior, and security
  considerations in every network binding.
- Do not document planned functionality as supported behavior.

## Implementation Sources of Truth

The public behavior is implemented under:

- `typescript/packages/core/src/`
- `typescript/packages/mechanisms/evm/src/`
- `typescript/packages/mechanisms/tron/src/`
- `typescript/packages/extensions/src/`
- `typescript/packages/http/`
- `typescript/packages/mcp/src/`

EVM and core are upstream-derived; TRON is maintained in this repository. Specifications should
describe observable behavior and wire contracts without exposing private keys, RPC credentials, or
deployment secrets.

## Review Checklist

- The document describes implemented v2 behavior.
- All required and optional fields agree with exported TypeScript types.
- Signature domains, primary types, and field order agree with the signer and verifier.
- Verification predicts settlement and fails closed where required.
- Replay protection, time bounds, recipient binding, and amount bounds are explicit.
- Contract addresses and supported network IDs agree with in-tree constants.
- Relative Markdown links resolve inside `specs/`.

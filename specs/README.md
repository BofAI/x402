# BANK OF AI x402 Specifications

This directory is the normative protocol documentation for the current BANK OF AI TypeScript SDK.
It profiles x402 protocol version 2 for the transports, schemes, networks, and extensions implemented
in this repository.

## Scope

- Protocol: x402 v2
- Networks: EVM (`eip155:*`, currently BSC) and TRON (`tron:*`)
- Transports: HTTP and MCP
- Schemes: `exact`, `upto`, `batch-settlement`, `auth-capture` (EVM), and
  `exact_gasfree` (TRON)
- Extensions: `bazaar`, `builder-code`, `eip2612GasSponsoring`,
  `erc20ApprovalGasSponsoring`, `offer-receipt`, `payment-identifier`, and
  `sign-in-with-x`

Legacy protocol revisions, unimplemented transports, and unimplemented network bindings are outside
the scope of this directory.

## Documents

- [Core protocol](x402-specification-v2.md)
- Transports: [HTTP](transports-v2/http.md), [MCP](transports-v2/mcp.md)
- Schemes:
  - [`exact`](schemes/exact/scheme_exact.md):
    [EVM](schemes/exact/scheme_exact_evm.md), [TRON](schemes/exact/scheme_exact_tron.md)
  - [`upto`](schemes/upto/scheme_upto.md):
    [EVM](schemes/upto/scheme_upto_evm.md), [TRON](schemes/upto/scheme_upto_tron.md)
  - [`batch-settlement`](schemes/batch-settlement/scheme_batch_settlement.md):
    [EVM](schemes/batch-settlement/scheme_batch_settlement_evm.md),
    [TRON](schemes/batch-settlement/scheme_batch_settlement_tron.md)
  - [`auth-capture`](schemes/auth-capture/scheme_auth_capture.md):
    [EVM](schemes/auth-capture/scheme_auth_capture_evm.md)
  - [`exact_gasfree`](schemes/exact-gasfree/scheme_exact_gasfree.md):
    [TRON](schemes/exact-gasfree/scheme_exact_gasfree_tron.md)
- [Extensions](extensions/)
- [Contributing](CONTRIBUTING.md)

The protocol separates transport (how messages move), scheme (how value moves), and network binding
(how a scheme is implemented on a chain). A conforming implementation MUST satisfy the core protocol,
one transport specification, and the selected scheme's network binding.

---
"@bankofai/x402-tron": major
---

**Breaking:** Remove facilitator service-fee configuration and metadata from
all TRON schemes (`exact`, `upto`, `exact_gasfree`). The `fee` property is
removed from `TronFacilitatorConfig` and `TronGasFreeFacilitatorConfig`, and
the `FeeInfo` / `ExactTronFeeConfig` / `GasFreeTronFeeConfig` type exports and
`shared/fee` module are deleted. All three schemes now transfer exactly the
requested amount.

GasFree provider-driven fees (`transferFee`, `activateFee`) are inherent to
the relayer protocol and remain unchanged — they are read from the relayer API,
not configured via the SDK.

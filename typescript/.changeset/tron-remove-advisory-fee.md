---
"@bankofai/x402-tron": major
---

**Breaking:** Remove advisory fee configuration and metadata from the TRON
`exact` and `upto` schemes. These schemes now transfer exactly the requested
amount and no longer accept a fee configuration through
`TronFacilitatorConfig` or their facilitator constructors.

GasFree fee handling is unchanged because those fees are enforced by the
GasFree relayer rather than advertised as advisory payment metadata.

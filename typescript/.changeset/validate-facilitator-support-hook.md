---
"@bankofai/x402-core": minor
---

Added an optional `validateFacilitatorSupport` hook to `SchemeNetworkServer` and wired it into `x402ResourceServer.initialize()`. After supported kinds are loaded, each registered scheme that the facilitator actually supports is asked to validate the advertised capabilities against its own configuration; any reported problems are aggregated and thrown so misconfigurations fail fast at server startup, not just on the first protected request.

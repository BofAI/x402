---
"@bankofai/x402-evm": minor
---

Expanded wallet compatibility so payments verify and settle consistently across plain EOAs, deployed smart accounts (ERC-4337 / ERC-7579), counterfactual ERC-6492 wallets, and ERC-7702-delegated EOAs. Pre-verification now mirrors on-chain signature checking, so a payment that passes `verify` is the same one that succeeds at `settle`. Added counterfactual ERC-6492 support to the `exact` and `batch-settlement` flows — the wallet is deployed and its signature validated together during `verify` — gated by a new `eip6492AllowedFactories` allowlist you set on the facilitator scheme config.

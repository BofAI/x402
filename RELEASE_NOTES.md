# v0.5.0 - Wallet-Based Signer Standardization

Release date: March 18, 2026

## What's New

- **Breaking change: signer initialization now uses `create()`**: Signers no longer support direct initialization from a private key. Use `create()` instead, which constructs the agent wallet internally and resolves signer setup through the new wallet-based flow.
- **Unified wallet capability surface**: Signer integration is now standardized around the agent-wallet `Wallet` interface for message signing, typed-data signing, and transaction signing. This creates a single capability model across supported signer flows.

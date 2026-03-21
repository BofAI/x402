# v0.5.0 - Wallet-Based Signer Standardization

Release date: March 21, 2026

## What's New

- **Breaking change: signer initialization now uses `create()`**: Signers no longer support direct initialization from a private key. Use `create()` instead, which constructs the agent wallet internally and resolves signer setup through the new wallet-based flow. For agent-wallet initialization details, see the [agent-wallet Quick Start](https://github.com/BofAI/agent-wallet/tree/main/packages/typescript#quick-start).
- **Unified wallet capability surface**: Signer integration is now standardized around the agent-wallet `Wallet` interface for message signing, typed-data signing, and transaction signing. This creates a single capability model across supported signer flows.

## Breaking Changes

### Migration Example

#### Python Client

```python
# old
tron_signer = TronClientSigner.from_private_key(TRON_PRIVATE_KEY)
evm_signer = EvmClientSigner.from_private_key(BSC_PRIVATE_KEY)
```

```python
# new
tron_signer = await TronClientSigner.create()
evm_signer = await EvmClientSigner.create()
```

#### TypeScript Client

```ts
// old
const tronSigner = new TronClientSigner(TRON_PRIVATE_KEY);
const evmSigner = new EvmClientSigner(BSC_PRIVATE_KEY);
```

```ts
// new
const tronSigner = await TronClientSigner.create();
const evmSigner = await EvmClientSigner.create();
```

#### Facilitator

```python
# old
tron_signer = TronFacilitatorSigner.from_private_key(TRON_PRIVATE_KEY)
bsc_signer = EvmFacilitatorSigner.from_private_key(BSC_PRIVATE_KEY)
```

```python
# new
tron_signer = await TronFacilitatorSigner.create()
bsc_signer = await EvmFacilitatorSigner.create()
```

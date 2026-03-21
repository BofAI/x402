# v0.5.0 - Wallet-Based Signer Standardization

Release date: March 18, 2026

## What's New

- **Breaking change: signer initialization now uses `create()`**: Signers no longer support direct initialization from a private key. Use `create()` instead, which constructs the agent wallet internally and resolves signer setup through the new wallet-based flow. Before calling `create()`, configure agent-wallet through its supported environment variables or local wallet configuration.
- **Unified wallet capability surface**: Signer integration is now standardized around the agent-wallet `Wallet` interface for message signing, typed-data signing, and transaction signing. This creates a single capability model across supported signer flows.

## How It Works

`create()` resolves the agent wallet using this order:

1. `AGENT_WALLET_PRIVATE_KEY` or `AGENT_WALLET_MNEMONIC` for static wallet mode
2. `AGENT_WALLET_PASSWORD` with optional `AGENT_WALLET_DIR` for local wallet mode
3. Raises a configuration error if no valid wallet configuration is found

Once resolved, the signer wraps the agent-wallet `Wallet` interface, which supports:

- `sign_message()` / `signMessage()` for message signing
- `sign_typed_data()` / `signTypedData()` for typed-data signing
- `sign_transaction()` / `signTransaction()` for transaction signing

## Breaking Changes

### Migration Example

The `create()` flow expects agent-wallet to be configured first. In static mode, this typically means setting `AGENT_WALLET_PRIVATE_KEY` or `AGENT_WALLET_MNEMONIC`. In local mode, configure `AGENT_WALLET_PASSWORD` and optionally `AGENT_WALLET_DIR`.

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

#### Facilitator (Python only)

The TypeScript SDK does not expose a separate facilitator signer. Facilitator-side signing is handled in the Python server implementation.

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

## Affected SDKs

- **Python**: `bankofai-x402==0.5.0`
- **TypeScript**: `@bankofai/x402@0.5.0`

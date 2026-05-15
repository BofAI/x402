# @bankofai/x402

TypeScript SDK for the x402 payment protocol. Supports TRON and EVM (BSC) networks with automatic HTTP 402 payment handling.

Current release: `@bankofai/x402@0.6.0`. This release includes TypeScript client, server, and facilitator parity with the Python SDK for `exact`, `exact_permit`, and `exact_gasfree` verify/settle flows.

## Compatibility Notes

- The EVM `exact` flow is being aligned to the Coinbase x402 v2 payload shape.
- Exact transfer authorizations are emitted in `payload.authorization`.
- Migration fallback support for the legacy `extensions.transferAuthorization` field remains on the server side while compatibility is rolled out.

## Features

- 🔐 **Automatic Payment Handling** - Transparently handles HTTP 402 Payment Required responses
- ⛓️ **Multi-Chain** - TRON (Mainnet, Nile, Shasta) and EVM/BSC (Mainnet, Testnet)
- 🔑 **TIP-712 / EIP-712 Signing** - Secure cryptographic signatures
- 💰 **GasFree Support** - Pay with USDT/USDD on TRON without holding TRX for gas
- 🚀 **Simple Integration** - Just 3 lines of code to get started
- 📦 **Lightweight** - Minimal dependencies (`tronweb` for TRON, `viem` for EVM)

## Installation

```bash
npm i @bankofai/x402@0.6.0 tronweb
```

## Quick Start

```typescript
import {
  X402Client,
  X402FetchClient,
  ExactPermitTronClientMechanism,
  TronClientSigner,
} from '@bankofai/x402';

// 1. Create signer and register payment mechanism
const signer = new TronClientSigner(process.env.TRON_PRIVATE_KEY);
const x402Client = new X402Client().register('tron:*', new ExactPermitTronClientMechanism(signer));

// 2. Create HTTP client with automatic 402 handling
const client = new X402FetchClient(x402Client);

// 3. Make requests - payments are handled automatically!
const response = await client.get('https://api.example.com/premium-data');
const data = await response.json();
console.log(data);
```

## BSC Testnet Example

For a smoke-tested BSC testnet `exact` example that uses a local private key and targets the Coinbase-compatible `exact` route, see [`examples/bsc-testnet-smoke/README.md`](../../../examples/bsc-testnet-smoke/README.md).

The BSC `exact` path in this repository is aligned around ERC-3009. On testnet, the validated asset is `DHLU`, not generic USDT/USDC permit-only flows.

## Core Concepts

### Payment Flow

When you make a request to a protected resource:

1. **First Request** - Server responds with `402 Payment Required` and payment requirements
2. **Payment Creation** - SDK automatically creates and signs a payment permit
3. **Token Approval** - SDK ensures sufficient token allowance (if needed)
4. **Retry with Payment** - Request is retried with payment signature
5. **Success** - Server validates payment and returns the protected resource

### Components

- **`X402Client`** - Core payment client that manages payment mechanisms
- **`X402FetchClient`** - HTTP client wrapper with automatic 402 handling
- **`TronClientSigner`** / **`EvmClientSigner`** - Sign payment permits using TIP-712 / EIP-712
- **`ExactPermitTronClientMechanism`** - Implements the "exact_permit" payment scheme for TRON
- **`ExactGasFreeClientMechanism`** - Implements the "exact_gasfree" scheme (no TRX gas needed)

## API Reference

### X402Client

Core client for managing payment mechanisms.

```typescript
const x402Client = new X402Client();
```

#### Methods

##### `register(networkPattern: string, mechanism: ClientMechanism): X402Client`

Register a payment mechanism for a network pattern.

```typescript
x402Client.register('tron:*', new ExactPermitTronClientMechanism(signer));
x402Client.register('tron:nile', new ExactPermitTronClientMechanism(nileSigner));
```

##### `selectPaymentRequirements(accepts: PaymentRequirements[], filters?: PaymentRequirementsFilter): PaymentRequirements`

Select payment requirements from available options.

```typescript
const selected = x402Client.selectPaymentRequirements(accepts, {
  network: 'tron:nile',
  maxAmount: '1000000',
});
```

##### `createPaymentPayload(requirements: PaymentRequirements, resource: string, extensions?: object): Promise<PaymentPayload>`

Create a payment payload for the given requirements.

```typescript
const payload = await x402Client.createPaymentPayload(requirements, '/api/data', extensions);
```

### X402FetchClient

HTTP client with automatic 402 payment handling.

```typescript
const client = new X402FetchClient(x402Client, selector?);
```

#### Methods

##### `get(url: string, init?: RequestInit): Promise<Response>`

Make a GET request with automatic payment handling.

```typescript
const response = await client.get('https://api.example.com/data');
```

##### `post(url: string, body?: RequestInit['body'], init?: RequestInit): Promise<Response>`

Make a POST request with automatic payment handling.

```typescript
const response = await client.post('https://api.example.com/data', JSON.stringify({ key: 'value' }));
```

##### `request(url: string, init?: RequestInit): Promise<Response>`

Make any HTTP request with automatic payment handling.

```typescript
const response = await client.request('https://api.example.com/data', {
  method: 'PUT',
  body: JSON.stringify({ key: 'value' }),
});
```

### TronClientSigner

Signer for creating payment permits using TIP-712.

```typescript
const signer = new TronClientSigner(privateKey);
```

#### Instance Methods

##### `getAddress(): string`

Get the signer's TRON address (Base58 format).

```typescript
const address = signer.getAddress(); // "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf"
```

##### `checkAllowance(token: string, amount: bigint, network: string): Promise<bigint>`

Check current token allowance for the payment permit contract.

```typescript
const allowance = await signer.checkAllowance(tokenAddress, BigInt(1000000), 'tron:nile');
```

##### `ensureAllowance(token: string, amount: bigint, network: string, mode?: 'auto' | 'interactive' | 'skip'): Promise<boolean>`

Ensure sufficient token allowance, approving if necessary.

```typescript
await signer.ensureAllowance(tokenAddress, BigInt(1000000), 'tron:nile', 'auto');
```

### EvmClientSigner

Signer for creating payment permits using EIP-712 (BSC and other EVM networks).

```typescript
const signer = new EvmClientSigner(privateKey);
```

### ExactPermitTronClientMechanism

Payment mechanism implementing the "exact_permit" scheme for TRON.

```typescript
const mechanism = new ExactPermitTronClientMechanism(signer);
```

### ExactGasFreeClientMechanism

Payment mechanism implementing the "exact_gasfree" scheme for TRON (no TRX gas needed).

```typescript
const mechanism = new ExactGasFreeClientMechanism(signer);
```

## Usage Examples

### Basic Usage with Automatic Payment

```typescript
import { X402Client, X402FetchClient, ExactPermitTronClientMechanism, TronClientSigner } from '@bankofai/x402';

const signer = new TronClientSigner(process.env.TRON_PRIVATE_KEY);
const x402Client = new X402Client().register('tron:*', new ExactPermitTronClientMechanism(signer));
const client = new X402FetchClient(x402Client);

// Automatic payment handling
const response = await client.get('https://api.example.com/weather');
const weather = await response.json();
console.log(weather);
```

### Manual Payment Handling

```typescript
import { X402Client, ExactPermitTronClientMechanism, TronClientSigner, encodePaymentPayload } from '@bankofai/x402';

const signer = new TronClientSigner(process.env.TRON_PRIVATE_KEY);
const x402Client = new X402Client().register('tron:*', new ExactPermitTronClientMechanism(signer));

// First request
const response = await fetch('https://api.example.com/data');

if (response.status === 402) {
  // Parse payment requirements
  const paymentRequired = await response.json();
  
  // Create payment payload
  const payload = await x402Client.createPaymentPayload(
    paymentRequired.accepts[0],
    '/data',
    paymentRequired.extensions
  );
  
  // Retry with payment
  const paidResponse = await fetch('https://api.example.com/data', {
    headers: {
      'PAYMENT-SIGNATURE': encodePaymentPayload(payload),
    },
  });
  
  const data = await paidResponse.json();
  console.log(data);
}
```

### Custom Payment Selection

```typescript
import { X402Client, X402FetchClient, ExactPermitTronClientMechanism, TronClientSigner } from '@bankofai/x402';

// Custom selector function
const selector = (requirements) => {
  // Choose the cheapest option
  return requirements.sort((a, b) => BigInt(a.amount) - BigInt(b.amount))[0];
};

const client = new X402FetchClient(x402Client, selector);
const response = await client.get('https://api.example.com/data');
```

### GasFree Usage (No TRX Gas Needed)

```typescript
import { X402Client, X402FetchClient, ExactGasFreeClientMechanism, TronClientSigner } from '@bankofai/x402';

const signer = new TronClientSigner(process.env.TRON_PRIVATE_KEY);
const x402Client = new X402Client().register('tron:*', new ExactGasFreeClientMechanism(signer));
const client = new X402FetchClient(x402Client);

// Pay with USDT/USDD without holding TRX
const response = await client.get('https://api.example.com/premium-content');
```

### Multiple Networks

```typescript
// Support multiple TRON networks
const nileClient = new X402Client()
  .register('tron:nile', new ExactPermitTronClientMechanism(nileSigner))
  .register('tron:shasta', new ExactPermitTronClientMechanism(shastaSigner))
  .register('tron:mainnet', new ExactPermitTronClientMechanism(mainnetSigner));
```

## Supported Networks

- **TRON Mainnet** - `tron:mainnet`
- **TRON Shasta Testnet** - `tron:shasta`
- **TRON Nile Testnet** - `tron:nile`
- **BSC Mainnet** - `eip155:56`
- **BSC Testnet** - `eip155:97`

## Payment Schemes

### Exact Permit Scheme (`exact_permit`)

The standard x402 payment scheme using TIP-712/EIP-712 permits. Requires a pre-deployed `PaymentPermit` contract on the network.

### GasFree Scheme (`exact_gasfree`)

Allows users to pay using TRC-20 tokens (USDT/USDD) without holding any TRX for gas.

- **Accountless**: Uses the official GasFree HTTP Proxy for settlement.
- **Dynamic**: Automatically discovers available service providers.
- **Status Tracking**: Built-in polling for transaction confirmation.

### Exact Scheme (`exact`)

Direct payment scheme using ERC-3009 (`TransferWithAuthorization`) where supported by the token contract (primarily for EVM networks like BSC).

For BSC testnet interoperability, treat token choice as part of the protocol contract. If the endpoint advertises `exact`, the asset must actually implement ERC-3009. The smoke-tested example in this repository uses `DHLU` on `eip155:97`.

## Security

- **Never commit private keys** - Use environment variables
- **TIP-712 signatures** - Cryptographically secure payment permits
- **Token allowances** - Explicit approval required before payments
- **Trust-minimizing** - Facilitator cannot move funds outside client authorization

## Troubleshooting

### "TronWeb does not support signTypedData"

Upgrade to TronWeb >= 5.0:

```bash
npm i tronweb@latest
```

### "No mechanism registered for network"

Ensure you've registered a mechanism for the network:

```typescript
x402Client.register('tron:nile', new ExactPermitTronClientMechanism(signer));
```

## Links

- **Repository**: https://github.com/BofAI/x402
- **Issues**: https://github.com/BofAI/x402/issues
- **Contributing**: https://github.com/BofAI/CONTRIBUTING.md
- **Documentation**: https://docs.bankofai.io/
- **TRON Documentation**: https://developers.tron.network/
- **TIP-712 Specification**: https://github.com/tronprotocol/tips/blob/master/tip-712.md

## License

MIT

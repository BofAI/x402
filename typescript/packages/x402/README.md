# @bankofai/x402

TypeScript client SDK for the x402 payment protocol on TRON blockchain. Enable pay-per-request APIs with automatic HTTP 402 payment handling.

## Features

- 🔐 **Automatic Payment Handling** - Transparently handles HTTP 402 Payment Required responses
- ⛓️ **TRON Native** - Built for TRON Mainnet, Shasta, and Nile testnets
- 🔑 **TIP-712 Signing** - Secure cryptographic signatures using TRON's EIP-712 implementation
- 💰 **Token Approval Management** - Automatic ERC20 token allowance handling
- 🚀 **Simple Integration** - Just 3 lines of code to get started
- 📦 **Zero Dependencies** - Only requires `tronweb` as peer dependency

## Installation

```bash
npm i @bankofai/x402 tronweb
```

## Quick Start

```typescript
import TronWeb from 'tronweb';
import {
  X402Client,
  X402FetchClient,
  ExactTronClientMechanism,
  TronClientSigner,
} from '@bankofai/x402';

// 1. Initialize TronWeb
const tronWeb = new TronWeb({
  fullHost: 'https://nile.trongrid.io',
  privateKey: 'your_private_key_here',
});

// 2. Create signer and register payment mechanism
const signer = TronClientSigner.withPrivateKey(tronWeb, 'your_private_key_here', 'nile');
const x402Client = new X402Client().register('tron:*', new ExactTronClientMechanism(signer));

// 3. Create HTTP client with automatic 402 handling
const client = new X402FetchClient(x402Client);

// 4. Make requests - payments are handled automatically!
const response = await client.get('https://api.example.com/premium-data');
const data = await response.json();
console.log(data);
```

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
- **`TronClientSigner`** - Signs payment permits using TIP-712
- **`ExactTronClientMechanism`** - Implements the "exact" payment scheme for TRON

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
x402Client.register('tron:*', new ExactTronClientMechanism(signer));
x402Client.register('tron:nile', new ExactTronClientMechanism(nileSigner));
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

#### Static Methods

##### `withPrivateKey(tronWeb: TronWeb, privateKey: string, network?: TronNetwork): TronClientSigner`

Create a signer with an explicit private key.

```typescript
const signer = TronClientSigner.withPrivateKey(tronWeb, '0x...', 'nile');
```

##### `fromTronWeb(tronWeb: TronWeb, network?: TronNetwork): TronClientSigner`

Create a signer from a TronWeb instance (uses default private key).

```typescript
const signer = TronClientSigner.fromTronWeb(tronWeb, 'mainnet');
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

### ExactTronClientMechanism

Payment mechanism implementing the "exact" scheme for TRON.

```typescript
const mechanism = new ExactTronClientMechanism(signer);
```

## Usage Examples

### Basic Usage with Automatic Payment

```typescript
import TronWeb from 'tronweb';
import { X402Client, X402FetchClient, ExactTronClientMechanism, TronClientSigner } from '@bankofai/x402';

const tronWeb = new TronWeb({
  fullHost: 'https://nile.trongrid.io',
  privateKey: process.env.TRON_PRIVATE_KEY,
});

const signer = TronClientSigner.withPrivateKey(tronWeb, process.env.TRON_PRIVATE_KEY, 'nile');
const x402Client = new X402Client().register('tron:*', new ExactTronClientMechanism(signer));
const client = new X402FetchClient(x402Client);

// Automatic payment handling
const response = await client.get('https://api.example.com/weather');
const weather = await response.json();
console.log(weather);
```

### Manual Payment Handling

```typescript
import TronWeb from 'tronweb';
import { X402Client, ExactTronClientMechanism, TronClientSigner, encodePaymentPayload } from '@bankofai/x402';

const tronWeb = new TronWeb({ fullHost: 'https://nile.trongrid.io', privateKey: process.env.TRON_PRIVATE_KEY });
const signer = TronClientSigner.withPrivateKey(tronWeb, process.env.TRON_PRIVATE_KEY, 'nile');
const x402Client = new X402Client().register('tron:*', new ExactTronClientMechanism(signer));

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
import { X402Client, X402FetchClient, ExactTronClientMechanism, TronClientSigner } from '@bankofai/x402';

// Custom selector function
const selector = (requirements) => {
  // Choose the cheapest option
  return requirements.sort((a, b) => BigInt(a.amount) - BigInt(b.amount))[0];
};

const client = new X402FetchClient(x402Client, selector);
const response = await client.get('https://api.example.com/data');
```

### Browser Integration

```typescript
// In browser with TronLink wallet
import { X402Client, X402FetchClient, ExactTronClientMechanism, TronClientSigner } from '@bankofai/x402';

// Wait for TronLink
const tronWeb = window.tronWeb;
if (!tronWeb) {
  throw new Error('TronLink not found');
}

const signer = TronClientSigner.fromTronWeb(tronWeb, 'mainnet');
const x402Client = new X402Client().register('tron:*', new ExactTronClientMechanism(signer));
const client = new X402FetchClient(x402Client);

// Make paid requests
const response = await client.get('https://api.example.com/premium-content');
```

### Multiple Networks

```typescript
// Support multiple TRON networks
const nileClient = new X402Client()
  .register('tron:nile', new ExactTronClientMechanism(nileSigner))
  .register('tron:shasta', new ExactTronClientMechanism(shastaSigner))
  .register('tron:mainnet', new ExactTronClientMechanism(mainnetSigner));
```

## Supported Networks

- **TRON Mainnet** - `tron:mainnet`
- **TRON Shasta Testnet** - `tron:shasta`
- **TRON Nile Testnet** - `tron:nile`

## Payment Schemes

### Exact Scheme

The `exact` scheme allows payments for a specified exact amount. Useful for:

- Pay-per-use APIs (e.g., LLM token generation)
- Fixed-price resources
- Predictable pricing for API calls

The server charges the exact amount specified in the payment permit.

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
x402Client.register('tron:nile', new ExactTronClientMechanism(signer));
```

### "Insufficient allowance"

The SDK automatically handles token approvals in `auto` mode. If you're using `skip` mode, manually approve tokens:

```typescript
await signer.ensureAllowance(tokenAddress, amount, network, 'auto');
```

## Links

- **Repository**: https://github.com/BofAI/x402
- **Issues**: https://github.com/BofAI/x402/issues
- **Contributing**: https://github.com/BofAI/CONTRIBUTING.md
- **Documentation**: https://github.com/BofAI/x402#readme
- **TRON Documentation**: https://developers.tron.network/
- **TIP-712 Specification**: https://github.com/tronprotocol/tips/blob/master/tip-712.md

## License

MIT

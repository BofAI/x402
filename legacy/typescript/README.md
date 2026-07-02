# x402 TypeScript Client SDK

TypeScript Client SDK for x402 Payment Protocol.

## Package

- `@bankofai/x402` - Complete TypeScript SDK with client, mechanisms, signers, and HTTP adapter

## Installation

```bash
# Install the package
pnpm add @bankofai/x402 tronweb
```

## Quick Start

```typescript
import { X402Client, ExactPermitTronClientMechanism, TronClientSigner, X402FetchClient } from '@bankofai/x402';

// 1. Create signer
const signer = new TronClientSigner(process.env.TRON_PRIVATE_KEY);

// 2. Create X402Client and register mechanisms
const x402Client = new X402Client()
  .register('tron:*', new ExactPermitTronClientMechanism(signer));

// 3. Create HTTP client with automatic 402 handling
const client = new X402FetchClient(x402Client);

// 4. Make requests - 402 payments handled automatically
const response = await client.get('https://api.example.com/premium-data');
console.log(await response.json());
```

## Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test
```

## License

MIT License

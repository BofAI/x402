# Network: EVM

Mechanisms: `typescript/packages/mechanisms/evm` (`@bankofai/x402-evm`). **Upstream fork** — see [typescript/conventions.md](../typescript/conventions.md).

Identifier: CAIP-2 `eip155:<chainId>`. Chain ID is a decimal integer after the colon.

| Identifier | Chain | Type |
|---|---|---|
| `eip155:1` | Ethereum Mainnet | Production |
| `eip155:11155111` | Sepolia Testnet | Testnet |
| `eip155:56` | BSC Mainnet | Production |
| `eip155:97` | BSC Testnet | Testnet |

## Signing rules

- EIP-712 typed data signing via `viem`.
- All address fields lowercase-normalized (checksum only at the boundary of APIs that require it).
- Signer factories: `createClientEvmSigner` / `createFacilitatorEvmSigner` / `createAuthorizerEvmSigner` from `@bankofai/x402-evm/adapters/agent-wallet`. They build the viem client from the CAIP-2 `network`; pass `{ network, rpcUrl? }`. Do not construct a chain client by hand.

## Schemes & token support

- `exact` — single fixed payment. Transfer method selected by `extra.assetTransferMethod`: **`eip3009`** (ERC-3009 `transferWithAuthorization`, signs offline) or **`permit2`** (Uniswap Permit2, reads the chain). See [schemes/exact.md](../schemes/exact.md).
- `upto` — usage-based ([schemes/upto.md](../schemes/upto.md)). `batch-settlement` — payment channels ([schemes/batch-settlement.md](../schemes/batch-settlement.md)). `auth-capture` — authorize+capture ([schemes/auth-capture.md](../schemes/auth-capture.md)).

## RPC

- viem's default public BSC-testnet node (`data-seed-prebsc-*.bnbchain.org:8545`) is frequently unreachable. Permit2 / channel-state reads need a working RPC; pass `rpcUrl` (or set the example's `EVM_RPC_URL`) to a reliable endpoint, e.g. `https://bsc-testnet-rpc.publicnode.com`. ERC-3009 (`eip3009`) signs offline and does not need RPC.

## Contracts

- Permit2 is the canonical singleton `0x000000000022D473030F116dDEE9F6B43aC78BA3` on every chain.
- Other contract addresses (PaymentPermit, batch channel manager, etc.) come from the in-tree config registry. Facilitator address is required — no implicit fallback.

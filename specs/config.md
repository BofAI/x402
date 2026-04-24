# Networks, Contracts & Token Registry

## Network Identifiers

TRON networks use the `tron:<name>` format. EVM networks use the CAIP-2 `eip155:<chainId>` format.

| Identifier | Chain | Type | Chain ID (decimal) | Chain ID (hex) |
|------------|-------|------|--------------------|----------------|
| `tron:mainnet` | TRON Mainnet | TRON | 728126428 | 0x2b6653dc |
| `tron:shasta` | TRON Shasta Testnet | TRON | 2494104990 | 0x94a9059e |
| `tron:nile` | TRON Nile Testnet | TRON | 3448148188 | 0xcd8690dc |
| `eip155:1` | Ethereum Mainnet | EVM | 1 | 0x1 |
| `eip155:11155111` | Sepolia Testnet | EVM | 11155111 | 0xaa36a7 |
| `eip155:56` | BSC Mainnet | EVM | 56 | 0x38 |
| `eip155:97` | BSC Testnet | EVM | 97 | 0x61 |

**Detection rules**:
- TRON network: identifier starts with `tron:`
- EVM network: identifier starts with `eip155:`
- EVM chain ID can be parsed directly from the identifier (after the colon)

## PaymentPermit Contract Addresses

| Network | Address |
|---------|---------|
| `tron:mainnet` | `TT8rEWbCoNX7vpEUauxb7rWJsTgs8vDLAn` |
| `tron:shasta` | `TR2XninQ3jsvRRLGTifFyUHTBysffooUjt` |
| `tron:nile` | `TFxDcGvS7zfQrS1YzcCMp673ta2NHHzsiH` |
| `eip155:97` | `0x1825bB32db3443dEc2cc7508b2D818fc13EaD878` |
| `eip155:56` | `0x1825bB32db3443dEc2cc7508b2D818fc13EaD878` |

Fallback for unconfigured EVM networks: EVM zero address. Fallback for TRON: TRON zero address.

## GasFree Contracts (TRON only)

### GasFreeController

| Network | Address |
|---------|---------|
| `tron:mainnet` | `TFFAMQLZybALaLb4uxHA9RBE7pxhUAjF3U` |
| `tron:shasta` | `TQghdCeVDA6CnuNVTUhfaAyPfTetqZWNpm` |
| `tron:nile` | `THQGuFzL87ZqhxkgqYEryRAd7gqFqL5rdc` |

### GasFree Beacon

| Network | Address |
|---------|---------|
| `tron:mainnet` | `TSP9UW6FQhT76XD2jWA6ipGMx3yGbjDffP` |
| `tron:shasta` | `TQ1jvA3nLDMDNbJoMPLzTPoqAg8NvZ5CCW` |
| `tron:nile` | `TLtCGmaxH3PbuaF6kbybwteZcHptEdgQGC` |

### GasFree API Base URLs

| Network | URL |
|---------|-----|
| `tron:mainnet` | `https://facilitator.bankofai.io/mainnet` |
| `tron:shasta` | `https://facilitator.bankofai.io/shasta` |
| `tron:nile` | `https://facilitator.bankofai.io/nile` |

## RPC URLs

### EVM

| Network | URL |
|---------|-----|
| `eip155:97` | `https://data-seed-prebsc-1-s1.binance.org:8545/` |
| `eip155:56` | `https://bsc-dataseed.binance.org/` |

### TRON (TronGrid)

| Network | URL |
|---------|-----|
| `tron:mainnet` | `https://api.trongrid.io` |
| `tron:shasta` | `https://api.shasta.trongrid.io` |
| `tron:nile` | `https://nile.trongrid.io` |

### TRON Fallback (used when `TRON_GRID_API_KEY` env var is not set)

| Network | URL |
|---------|-----|
| `tron:mainnet` | `https://hptg.bankofai.io` |

## Zero Addresses

| Chain type | Address |
|-----------|---------|
| TRON | `T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb` |
| EVM | `0x0000000000000000000000000000000000000000` |

## Address Formats

| Format | Prefix | Length | Example |
|--------|--------|--------|---------|
| TRON Base58 | `T` | 34 chars | `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t` |
| TRON raw hex | `41` | 42 chars | `41...` |
| EVM hex | `0x` | 42 chars | `0x55d398326f99059fF775485246999027B3197955` |

TRON and EVM hex are interconvertible: TRON raw hex replaces the `41` prefix with `0x` to get EVM format.

## Token Registry

### eip155:97 (BSC Testnet)

| Symbol | Address | Decimals | Name |
|--------|---------|----------|------|
| USDT | `0x337610d27c682E347C9cD60BD4b3b107C9d34dDd` | 18 | Tether USD |
| USDC | `0x64544969ed7EBf5f083679233325356EbE738930` | 18 | USD Coin |
| DHLU | `0x375cADdd2cB68cE82e3D9B075D551067a7b4B816` | 6 | DA HULU |

### eip155:56 (BSC Mainnet)

| Symbol | Address | Decimals | Name |
|--------|---------|----------|------|
| USDC | `0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d` | 18 | USD Coin |
| USDT | `0x55d398326f99059fF775485246999027B3197955` | 18 | Tether USD |
| EPS | `0xA7f552078dcC247C2684336020c03648500C6d9F` | 18 | Ellipsis |

### tron:mainnet

| Symbol | Address | Decimals | Name |
|--------|---------|----------|------|
| USDT | `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t` | 6 | Tether USD |
| USDD | `TXDk8mbtRbXeYuMNS83CfKPaYYT8XWv9Hz` | 18 | Decentralized USD |

### tron:shasta

| Symbol | Address | Decimals | Name |
|--------|---------|----------|------|
| USDT | `TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs` | 6 | Tether USD |

### tron:nile

| Symbol | Address | Decimals | Name |
|--------|---------|----------|------|
| USDT | `TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf` | 6 | Tether USD |
| USDD | `TGjgvdTWWrybVLaVeFqSyVqJQWjxqRYbaK` | 18 | Decentralized USD |

### Token Version

Token version defaults to `"1"` unless specified otherwise. This is used in the `exact` scheme's EIP-712 domain.

### Price String Format

Servers specify prices as human-readable strings: `"<amount> <SYMBOL>"` (e.g., `"100 USDT"`). The system resolves the symbol to a token address via the registry and converts the amount to the smallest unit using the token's decimals.

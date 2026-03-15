// EIP-3009 TransferWithAuthorization types for EIP-712 signing
export const authorizationTypes = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

/**
 * Permit2 EIP-712 types for signing PermitWitnessTransferFrom.
 * Must match the exact format expected by the Permit2 contract.
 * Note: Types must be in ALPHABETICAL order after the primary type (TokenPermissions < Witness).
 */
export const permit2WitnessTypes = {
  PermitWitnessTransferFrom: [
    { name: "permitted", type: "TokenPermissions" },
    { name: "spender", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "witness", type: "Witness" },
  ],
  TokenPermissions: [
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" },
  ],
  Witness: [
    { name: "to", type: "address" },
    { name: "facilitator", type: "address" },
    { name: "validAfter", type: "uint256" },
  ],
} as const;

// EIP3009 ABI for transferWithAuthorization function
export const eip3009ABI = [
  {
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
      { name: "v", type: "uint8" },
      { name: "r", type: "bytes32" },
      { name: "s", type: "bytes32" },
    ],
    name: "transferWithAuthorization",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
      { name: "signature", type: "bytes" },
    ],
    name: "transferWithAuthorization",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "version",
    outputs: [{ name: "", type: "string" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

/**
 * EIP-2612 Permit EIP-712 types for signing token.permit().
 */
export const eip2612PermitTypes = {
  Permit: [
    { name: "owner", type: "address" },
    { name: "spender", type: "address" },
    { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

/**
 * EIP-2612 nonces ABI for querying current nonce.
 */
export const eip2612NoncesAbi = [
  {
    type: "function",
    name: "nonces",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
] as const;

/** ERC-20 approve(address,uint256) ABI for encoding/decoding approval calldata. */
export const erc20ApproveAbi = [
  {
    type: "function",
    name: "approve",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
    stateMutability: "nonpayable",
  },
] as const;

/** ERC-20 allowance(address,address) ABI for checking spender approval. */
export const erc20AllowanceAbi = [
  {
    type: "function",
    name: "allowance",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
] as const;

/** ERC-20 balanceOf(address) ABI for checking token balances before signing. */
export const erc20BalanceOfAbi = [
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
] as const;

/** Gas limit for a standard ERC-20 approve() transaction. */
export const ERC20_APPROVE_GAS_LIMIT = 70_000n;

/** Fallback max fee per gas (1 gwei) when fee estimation fails. */
export const DEFAULT_MAX_FEE_PER_GAS = 1_000_000_000n;

/** Fallback max priority fee per gas (0.1 gwei) when fee estimation fails. */
export const DEFAULT_MAX_PRIORITY_FEE_PER_GAS = 100_000_000n;

/**
 * Canonical Uniswap Permit2 contract address.
 * Used as the default on EVM chains that do not override Permit2 deployment.
 *
 * @see https://github.com/Uniswap/permit2
 */
export const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as const;

/**
 * Chain-specific Permit2 deployments.
 * BSC uses PancakeSwap's Permit2 deployment instead of the canonical Uniswap address.
 */
export const PERMIT2_ADDRESSES: Record<string, `0x${string}`> = {
  "eip155:56": "0x31c2F6fcFf4F8759b3Bd5Bf0e1084A055615c768",
  "eip155:97": "0x31c2F6fcFf4F8759b3Bd5Bf0e1084A055615c768",
};

/**
 * Default x402ExactPermit2Proxy contract address.
 * Preserved for backwards compatibility in exports and tests.
 */
export const x402ExactPermit2ProxyAddress = "0xEe38Ec718255fe78e9D16aCC0e1183C731679b23" as const;

/**
 * Chain-specific x402ExactPermit2Proxy deployments.
 */
export const X402_EXACT_PERMIT2_PROXY_ADDRESSES: Record<string, `0x${string}`> = {
  "eip155:56": x402ExactPermit2ProxyAddress,
  "eip155:97": x402ExactPermit2ProxyAddress,
};

/**
 * Default x402UptoPermit2Proxy contract address.
 * Preserved for backwards compatibility in exports and tests.
 */
export const x402UptoPermit2ProxyAddress = "0x2b30Ed9F37c7C21ae8779c5753B1cCf264DfD63C" as const;

/**
 * Chain-specific x402UptoPermit2Proxy deployments.
 */
export const X402_UPTO_PERMIT2_PROXY_ADDRESSES: Record<string, `0x${string}`> = {
  "eip155:56": x402UptoPermit2ProxyAddress,
  "eip155:97": x402UptoPermit2ProxyAddress,
};

/**
 * Resolve the Permit2 contract address for an EVM network.
 * Falls back to the canonical Uniswap deployment when a chain-specific override is not configured.
 *
 * @param network - CAIP-2 EVM network identifier.
 * @returns The Permit2 contract address for the requested network.
 */
export function getPermit2Address(network: string): `0x${string}` {
  return PERMIT2_ADDRESSES[network] ?? PERMIT2_ADDRESS;
}

/**
 * Resolve the x402 exact Permit2 proxy address for an EVM network.
 * Falls back to the default exported address when a chain-specific override is not configured.
 *
 * @param network - CAIP-2 EVM network identifier.
 * @returns The x402 exact Permit2 proxy contract address for the requested network.
 */
export function getX402ExactPermit2ProxyAddress(network: string): `0x${string}` {
  return X402_EXACT_PERMIT2_PROXY_ADDRESSES[network] ?? x402ExactPermit2ProxyAddress;
}

/**
 * Resolve the x402 upto Permit2 proxy address for an EVM network.
 * Falls back to the default exported address when a chain-specific override is not configured.
 *
 * @param network - CAIP-2 EVM network identifier.
 * @returns The x402 upto Permit2 proxy contract address for the requested network.
 */
export function getX402UptoPermit2ProxyAddress(network: string): `0x${string}` {
  return X402_UPTO_PERMIT2_PROXY_ADDRESSES[network] ?? x402UptoPermit2ProxyAddress;
}

/**
 * Shared ABI components for the Permit2 witness tuple.
 * Used in both x402ExactPermit2ProxyABI and x402UptoPermit2ProxyABI to keep them in sync.
 * The upto contract's witness struct is identical to exact (both remove 'extra' post-audit).
 */
const permit2WitnessABIComponents = [
  { name: "to", type: "address", internalType: "address" },
  { name: "facilitator", type: "address", internalType: "address" },
  { name: "validAfter", type: "uint256", internalType: "uint256" },
] as const;

/**
 * x402UptoPermit2Proxy ABI - settle function for upto payment scheme (variable amounts).
 * Updated post-audit: 'extra' removed from witness struct, 'initialize()' removed (now
 * a constructor arg), and error names aligned with x402ExactPermit2Proxy.
 */
export const x402UptoPermit2ProxyABI = [
  {
    type: "function",
    name: "PERMIT2",
    inputs: [],
    outputs: [{ name: "", type: "address", internalType: "contract ISignatureTransfer" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "WITNESS_TYPEHASH",
    inputs: [],
    outputs: [{ name: "", type: "bytes32", internalType: "bytes32" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "WITNESS_TYPE_STRING",
    inputs: [],
    outputs: [{ name: "", type: "string", internalType: "string" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "settle",
    inputs: [
      {
        name: "permit",
        type: "tuple",
        internalType: "struct ISignatureTransfer.PermitTransferFrom",
        components: [
          {
            name: "permitted",
            type: "tuple",
            internalType: "struct ISignatureTransfer.TokenPermissions",
            components: [
              { name: "token", type: "address", internalType: "address" },
              { name: "amount", type: "uint256", internalType: "uint256" },
            ],
          },
          { name: "nonce", type: "uint256", internalType: "uint256" },
          { name: "deadline", type: "uint256", internalType: "uint256" },
        ],
      },
      { name: "owner", type: "address", internalType: "address" },
      {
        name: "witness",
        type: "tuple",
        internalType: "struct x402UptoPermit2Proxy.Witness",
        components: permit2WitnessABIComponents,
      },
      { name: "signature", type: "bytes", internalType: "bytes" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "settleWithPermit",
    inputs: [
      {
        name: "permit2612",
        type: "tuple",
        internalType: "struct x402UptoPermit2Proxy.EIP2612Permit",
        components: [
          { name: "value", type: "uint256", internalType: "uint256" },
          { name: "deadline", type: "uint256", internalType: "uint256" },
          { name: "r", type: "bytes32", internalType: "bytes32" },
          { name: "s", type: "bytes32", internalType: "bytes32" },
          { name: "v", type: "uint8", internalType: "uint8" },
        ],
      },
      {
        name: "permit",
        type: "tuple",
        internalType: "struct ISignatureTransfer.PermitTransferFrom",
        components: [
          {
            name: "permitted",
            type: "tuple",
            internalType: "struct ISignatureTransfer.TokenPermissions",
            components: [
              { name: "token", type: "address", internalType: "address" },
              { name: "amount", type: "uint256", internalType: "uint256" },
            ],
          },
          { name: "nonce", type: "uint256", internalType: "uint256" },
          { name: "deadline", type: "uint256", internalType: "uint256" },
        ],
      },
      { name: "owner", type: "address", internalType: "address" },
      {
        name: "witness",
        type: "tuple",
        internalType: "struct x402UptoPermit2Proxy.Witness",
        components: permit2WitnessABIComponents,
      },
      { name: "signature", type: "bytes", internalType: "bytes" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  { type: "event", name: "Settled", inputs: [], anonymous: false },
  { type: "event", name: "SettledWithPermit", inputs: [], anonymous: false },
  { type: "error", name: "InvalidAmount", inputs: [] },
  { type: "error", name: "InvalidDestination", inputs: [] },
  { type: "error", name: "InvalidOwner", inputs: [] },
  { type: "error", name: "InvalidPermit2Address", inputs: [] },
  { type: "error", name: "PaymentTooEarly", inputs: [] },
  { type: "error", name: "Permit2612AmountMismatch", inputs: [] },
  { type: "error", name: "ReentrancyGuardReentrantCall", inputs: [] },
] as const;

/**
 * x402ExactPermit2Proxy ABI - settle function for exact payment scheme.
 */
export const x402ExactPermit2ProxyABI = [
  {
    type: "function",
    name: "PERMIT2",
    inputs: [],
    outputs: [{ name: "", type: "address", internalType: "contract ISignatureTransfer" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "WITNESS_TYPEHASH",
    inputs: [],
    outputs: [{ name: "", type: "bytes32", internalType: "bytes32" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "WITNESS_TYPE_STRING",
    inputs: [],
    outputs: [{ name: "", type: "string", internalType: "string" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "settle",
    inputs: [
      {
        name: "permit",
        type: "tuple",
        internalType: "struct ISignatureTransfer.PermitTransferFrom",
        components: [
          {
            name: "permitted",
            type: "tuple",
            internalType: "struct ISignatureTransfer.TokenPermissions",
            components: [
              { name: "token", type: "address", internalType: "address" },
              { name: "amount", type: "uint256", internalType: "uint256" },
            ],
          },
          { name: "nonce", type: "uint256", internalType: "uint256" },
          { name: "deadline", type: "uint256", internalType: "uint256" },
        ],
      },
      { name: "owner", type: "address", internalType: "address" },
      {
        name: "witness",
        type: "tuple",
        internalType: "struct x402ExactPermit2Proxy.Witness",
        components: permit2WitnessABIComponents,
      },
      { name: "signature", type: "bytes", internalType: "bytes" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "settleWithPermit",
    inputs: [
      {
        name: "permit2612",
        type: "tuple",
        internalType: "struct x402ExactPermit2Proxy.EIP2612Permit",
        components: [
          { name: "value", type: "uint256", internalType: "uint256" },
          { name: "deadline", type: "uint256", internalType: "uint256" },
          { name: "r", type: "bytes32", internalType: "bytes32" },
          { name: "s", type: "bytes32", internalType: "bytes32" },
          { name: "v", type: "uint8", internalType: "uint8" },
        ],
      },
      {
        name: "permit",
        type: "tuple",
        internalType: "struct ISignatureTransfer.PermitTransferFrom",
        components: [
          {
            name: "permitted",
            type: "tuple",
            internalType: "struct ISignatureTransfer.TokenPermissions",
            components: [
              { name: "token", type: "address", internalType: "address" },
              { name: "amount", type: "uint256", internalType: "uint256" },
            ],
          },
          { name: "nonce", type: "uint256", internalType: "uint256" },
          { name: "deadline", type: "uint256", internalType: "uint256" },
        ],
      },
      { name: "owner", type: "address", internalType: "address" },
      {
        name: "witness",
        type: "tuple",
        internalType: "struct x402ExactPermit2Proxy.Witness",
        components: permit2WitnessABIComponents,
      },
      { name: "signature", type: "bytes", internalType: "bytes" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  { type: "event", name: "Settled", inputs: [], anonymous: false },
  { type: "event", name: "SettledWithPermit", inputs: [], anonymous: false },
  { type: "error", name: "InvalidAmount", inputs: [] },
  { type: "error", name: "InvalidDestination", inputs: [] },
  { type: "error", name: "InvalidOwner", inputs: [] },
  { type: "error", name: "InvalidPermit2Address", inputs: [] },
  { type: "error", name: "PaymentTooEarly", inputs: [] },
  { type: "error", name: "Permit2612AmountMismatch", inputs: [] },
  { type: "error", name: "ReentrancyGuardReentrantCall", inputs: [] },
] as const;

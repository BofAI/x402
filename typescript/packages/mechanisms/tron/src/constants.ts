// --- TIP-712 (TransferWithAuthorization) constants ---

/**
 * TIP-712 type definitions for TransferWithAuthorization on TRON.
 * Equivalent to EIP-3009 on EVM but using TRON's TIP-712 structured data signing.
 */
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
 * ABI for TransferWithAuthorization on TRC-20 tokens.
 * Includes both v/r/s and bytes signature overloads.
 */
export const transferWithAuthorizationABI = [
  {
    type: "function",
    name: "transferWithAuthorization",
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
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
] as const;

// --- Permit2 constants ---

/**
 * TIP-712 type definitions for Permit2 PermitWitnessTransferFrom on TRON.
 * Must match the exact format expected by the Permit2 contract.
 * Types must be in alphabetical order after the primary type.
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

/**
 * Permit2 contract addresses per TRON network.
 */
export const PERMIT2_ADDRESSES: Record<string, string> = {
  "tron:mainnet": "TTJxU3P8rHycAyFY4kVtGNfmnMH4ezcuM9",
  "tron:nile": "TYQuuhGbEMxF7nZxUHV3uHJxAVVAegNU9h",
};

/**
 * x402ExactPermit2Proxy contract addresses per TRON network.
 * Enforces that Permit2 transfers can only go to the witness.to address.
 */
export const X402_PERMIT2_PROXY_ADDRESSES: Record<string, string> = {
  "tron:mainnet": "TSm6MSWHHBeABh22uqX7SU7QUweav4Cyy6",
  "tron:nile": "TCd2ZSwbJBAdgFfP5d3gkhKcGs47WNZLLi",
};

/**
 * x402UptoPermit2Proxy contract addresses per TRON network.
 * Used by variable-amount settlement flows.
 */
export const X402_UPTO_PERMIT2_PROXY_ADDRESSES: Record<string, string> = {
  "tron:mainnet": "TGHEYAovw8fZz1bgnVgRtgrdGLbagFZYq5",
};

/**
 * ABI for x402ExactPermit2Proxy settle function on TRON.
 */
export const x402ExactPermit2ProxyABI = [
  {
    type: "function",
    name: "settle",
    inputs: [
      {
        name: "permit",
        type: "tuple",
        components: [
          {
            name: "permitted",
            type: "tuple",
            components: [
              { name: "token", type: "address" },
              { name: "amount", type: "uint256" },
            ],
          },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
      { name: "owner", type: "address" },
      {
        name: "witness",
        type: "tuple",
        components: [
          { name: "to", type: "address" },
          { name: "facilitator", type: "address" },
          { name: "validAfter", type: "uint256" },
        ],
      },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

/**
 * ABI for TRC-20 allowance check.
 */
export const erc20AllowanceAbi = [
  {
    type: "function",
    name: "allowance",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
] as const;

/**
 * ABI for TRC-20 approve used by Permit2 setup flows.
 */
export const erc20ApproveAbi = [
  {
    type: "function",
    name: "approve",
    inputs: [
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
  },
] as const;

// --- Shared constants ---

/**
 * TRON chain IDs for TIP-712 signing.
 */
export const TRON_CHAIN_IDS: Record<string, number> = {
  "tron:mainnet": 728126428, // 0x2b6653dc
  "tron:shasta": 2494104990, // 0x94a9059e
  "tron:nile": 3448148188, // 0xcd8690dc
};

/**
 * Default fee limit for TRON contract calls in SUN (1 TRX = 1,000,000 SUN).
 * 1000 TRX max fee.
 */
export const DEFAULT_FEE_LIMIT_SUN = 1_000_000_000;

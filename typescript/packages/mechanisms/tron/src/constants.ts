// --- CAIP-2 network identifiers ---
// TRON uses hex chain IDs in the CAIP-2 reference (not human-readable names),
// per upstream spec PR x402-foundation/x402#2076 review feedback.

/** TRON mainnet CAIP-2 id (chain id 0x2b6653dc). */
export const TRON_MAINNET = "tron:0x2b6653dc";
/** TRON Nile testnet CAIP-2 id (chain id 0xcd8690dc). */
export const TRON_NILE = "tron:0xcd8690dc";
/** TRON Shasta testnet CAIP-2 id (chain id 0x94a9059e). */
export const TRON_SHASTA = "tron:0x94a9059e";

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
    { name: "validAfter", type: "uint256" },
  ],
} as const;

/**
 * TIP-712 type definitions for the Upto Permit2 PermitWitnessTransferFrom on TRON.
 * Identical to `permit2WitnessTypes` except the Witness binds a `facilitator`
 * address: only that address may call `settle` on the upto proxy, and the
 * settlement amount may be any value up to `permitted.amount`.
 * Types must be in alphabetical order after the primary type.
 */
export const uptoPermit2WitnessTypes = {
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
  "tron:0x2b6653dc": "TTJxU3P8rHycAyFY4kVtGNfmnMH4ezcuM9",
  "tron:0xcd8690dc": "TYQuuhGbEMxF7nZxUHV3uHJxAVVAegNU9h",
  "tron:0x94a9059e": "TJMkP7a3ucTMkvi17p7ChhTCw6zriFX3tg",
};

/**
 * x402ExactPermit2Proxy contract addresses per TRON network.
 * Enforces that Permit2 transfers can only go to the witness.to address.
 */
export const X402_PERMIT2_PROXY_ADDRESSES: Record<string, string> = {
  "tron:0x2b6653dc": "TN49yaJmZMZoEdDCqjB4uPzQLHvYkGw95m",
  "tron:0xcd8690dc": "TFGoaq2KjizijgjtkVxT7yjffW1A5T1j6F",
  "tron:0x94a9059e": "TGZkC38n14f2GpBWPMQLF2BpmcpWW3QNhg",
};

/**
 * x402UptoPermit2Proxy contract addresses per TRON network.
 * Used by variable-amount settlement flows.
 */
export const X402_UPTO_PERMIT2_PROXY_ADDRESSES: Record<string, string> = {
  "tron:0x2b6653dc": "TBLeFPkfDiweBbYmAPqnakaFBPDt9p93sR",
  "tron:0xcd8690dc": "TKvcqQ7S2bYyys5ZZNpjj9xGiPhiwzHq1K",
  "tron:0x94a9059e": "TMxpieW75DQiA9QaoTB1ifJWeQpuppSB1g",
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
 * ABI for x402UptoPermit2Proxy settle function on TRON.
 * Differs from the exact proxy by an extra `amount` parameter (the actual
 * settlement amount, which must be ≤ `permit.permitted.amount`) and a 3-field
 * witness that binds the authorized facilitator (`msg.sender == witness.facilitator`).
 */
export const x402UptoPermit2ProxyABI = [
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
      { name: "amount", type: "uint256" },
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
  "tron:0x2b6653dc": 728126428, // 0x2b6653dc
  "tron:0x94a9059e": 2494104990, // 0x94a9059e
  "tron:0xcd8690dc": 3448148188, // 0xcd8690dc
};

/**
 * Default fee limit for TRON contract calls in SUN (1 TRX = 1,000,000 SUN).
 * 1000 TRX max fee.
 */
export const DEFAULT_FEE_LIMIT_SUN = 1_000_000_000;

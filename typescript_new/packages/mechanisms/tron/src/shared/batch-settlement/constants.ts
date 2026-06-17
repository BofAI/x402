/**
 * @file Constants for the TRON batch-settlement scheme.
 *
 * The deployed TRON contract is the same bytecode as the EVM `x402BatchSettlement`
 * contract: its EIP-712 domain (`name = "x402 Batch Settlement"`, `version = "1"`)
 * and `CHANNEL_CONFIG_TYPEHASH` were verified on-chain to match the EVM constants
 * exactly. Only the per-network `verifyingContract` address and `chainId` differ,
 * so the typed-data structures below are copied verbatim from `@x402/evm`.
 */

/** Scheme identifier for the batch-settlement payment scheme. */
export const BATCH_SETTLEMENT_SCHEME = "batch-settlement" as const;

/**
 * Deployed `x402BatchSettlement` contract addresses per TRON network (Base58Check).
 */
export const BATCH_SETTLEMENT_ADDRESSES: Record<string, string> = {
  "tron:nile": "TWBwWHZWwH8TzrZnbxit1J645VGYY1K2fA",
};

/**
 * Deployed `ERC3009DepositCollector` contract addresses per TRON network.
 */
export const ERC3009_DEPOSIT_COLLECTOR_ADDRESSES: Record<string, string> = {
  "tron:nile": "TJUQ3BQt4YFg8EeevjiUa5LbfSGz5BxzRW",
};

/**
 * Deployed `Permit2DepositCollector` contract addresses per TRON network.
 */
export const PERMIT2_DEPOSIT_COLLECTOR_ADDRESSES: Record<string, string> = {
  "tron:nile": "TEp6bCqSEKAr99sCiqANC84RtRwx7xGbA4",
};

/**
 * Resolve the `x402BatchSettlement` address for a network.
 *
 * @param network - CAIP-2 network identifier (e.g. `"tron:nile"`).
 * @returns The Base58Check contract address.
 * @throws When no contract is configured for the network.
 */
export function getBatchSettlementAddress(network: string): string {
  const address = BATCH_SETTLEMENT_ADDRESSES[network];
  if (!address) {
    throw new Error(`No x402BatchSettlement contract configured for network ${network}`);
  }
  return address;
}

/**
 * Resolve the `ERC3009DepositCollector` address for a network.
 *
 * @param network - CAIP-2 network identifier.
 * @returns The Base58Check collector address.
 * @throws When no collector is configured for the network.
 */
export function getErc3009DepositCollectorAddress(network: string): string {
  const address = ERC3009_DEPOSIT_COLLECTOR_ADDRESSES[network];
  if (!address) {
    throw new Error(`No ERC3009DepositCollector configured for network ${network}`);
  }
  return address;
}

/**
 * Resolve the `Permit2DepositCollector` address for a network.
 *
 * @param network - CAIP-2 network identifier.
 * @returns The Base58Check collector address.
 * @throws When no collector is configured for the network.
 */
export function getPermit2DepositCollectorAddress(network: string): string {
  const address = PERMIT2_DEPOSIT_COLLECTOR_ADDRESSES[network];
  if (!address) {
    throw new Error(`No Permit2DepositCollector configured for network ${network}`);
  }
  return address;
}

/** Minimum withdraw delay in seconds (15 minutes), matching the onchain constant. */
export const MIN_WITHDRAW_DELAY = 900;

/** Maximum withdraw delay in seconds (30 days), matching the onchain constant. */
export const MAX_WITHDRAW_DELAY = 2_592_000;

/** EIP-712 / TIP-712 domain fields shared across all batch-settlement signatures. */
export const BATCH_SETTLEMENT_DOMAIN = {
  name: "x402 Batch Settlement",
  version: "1",
} as const;

/** Typed-data definition for a channel configuration. */
export const channelConfigTypes = {
  ChannelConfig: [
    { name: "payer", type: "address" },
    { name: "payerAuthorizer", type: "address" },
    { name: "receiver", type: "address" },
    { name: "receiverAuthorizer", type: "address" },
    { name: "token", type: "address" },
    { name: "withdrawDelay", type: "uint40" },
    { name: "salt", type: "bytes32" },
  ],
} as const;

/** Typed-data definition for a cumulative voucher. */
export const voucherTypes = {
  Voucher: [
    { name: "channelId", type: "bytes32" },
    { name: "maxClaimableAmount", type: "uint128" },
  ],
} as const;

/** Typed-data definition for a cooperative refund. */
export const refundTypes = {
  Refund: [
    { name: "channelId", type: "bytes32" },
    { name: "nonce", type: "uint256" },
    { name: "amount", type: "uint128" },
  ],
} as const;

/** Typed-data definitions for a receiver-authorizer claim batch (nested ClaimEntry). */
export const claimBatchTypes = {
  ClaimBatch: [{ name: "claims", type: "ClaimEntry[]" }],
  ClaimEntry: [
    { name: "channelId", type: "bytes32" },
    { name: "maxClaimableAmount", type: "uint128" },
    { name: "totalClaimed", type: "uint128" },
  ],
} as const;

/** Typed-data definition for ERC-3009 `ReceiveWithAuthorization` (gasless deposits). */
export const receiveAuthorizationTypes = {
  ReceiveWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

/** Permit2 typed data for channel-bound batch deposits. */
export const batchPermit2WitnessTypes = {
  PermitWitnessTransferFrom: [
    { name: "permitted", type: "TokenPermissions" },
    { name: "spender", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "witness", type: "DepositWitness" },
  ],
  TokenPermissions: [
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" },
  ],
  DepositWitness: [{ name: "channelId", type: "bytes32" }],
} as const;

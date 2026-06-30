// Client
export {
  BatchSettlementTronScheme,
  InMemoryClientChannelStorage,
  signVoucher,
  refundChannel,
  createBatchSettlementClientHooks,
  buildChannelConfig,
  recoverChannel,
} from "./client";
export type {
  BatchSettlementClientContext,
  BatchSettlementClientDeps,
  BatchSettlementDepositPolicy,
  BatchSettlementDepositStrategy,
  BatchSettlementTronSchemeOptions,
  ClientChannelStorage,
  RefundOptions,
} from "./client";

// Server / Facilitator scheme classes are intentionally NOT re-exported here —
// like exact/upto (and EVM), the aggregate entry exposes only the client scheme.
// Import the server/facilitator scheme via their role subpaths
// (`./batch-settlement/server`, `./batch-settlement/facilitator`).

// Server helpers
export { BatchSettlementChannelManager, InMemoryChannelStorage } from "./server";
export type {
  BatchSettlementTronSchemeServerConfig,
  BatchSettlementRequestContext,
  Channel,
  ChannelStorage,
  ChannelManagerConfig,
  AutoSettlementConfig,
  AutoSettlementContext,
  ClaimResult,
  SettleResult,
  RefundResult,
} from "./server";

// Shared
export { computeChannelId, getBatchSettlementTip712Domain } from "../shared/batch-settlement/utils";
export {
  BATCH_SETTLEMENT_SCHEME,
  BATCH_SETTLEMENT_ADDRESSES,
  ERC3009_DEPOSIT_COLLECTOR_ADDRESSES,
  PERMIT2_DEPOSIT_COLLECTOR_ADDRESSES,
} from "../shared/batch-settlement/constants";

// Types
export type {
  TronAuthorizerSigner,
  ChannelConfig,
  BatchSettlementVoucherClaim,
  BatchSettlementDepositPayload,
  BatchSettlementVoucherPayload,
  BatchSettlementRefundPayload,
  BatchSettlementAssetTransferMethod,
} from "./types";
export {
  isBatchSettlementDepositPayload,
  isBatchSettlementVoucherPayload,
  isBatchSettlementRefundPayload,
} from "./types";

// Client
export { ExactTronScheme } from "./exact/client/scheme";
export { registerExactTronScheme } from "./exact/client/register";
export type { TronClientConfig } from "./exact/client/register";
export {
  createPermit2ApprovalTx,
  getPermit2AllowanceReadParams,
  type Permit2AllowanceParams,
} from "./exact/client/permit2Helpers";

// Signers
export {
  toClientTronSigner,
  toFacilitatorTronSigner,
  createClientTronSigner,
  createFacilitatorTronSigner,
} from "./signer";
export type {
  ClientTronSigner,
  FacilitatorTronSigner,
  AgentWallet,
  FacilitatorAgentWallet,
  FacilitatorTronSignerOptions,
} from "./signer";

// Types
export type {
  AssetTransferMethod,
  ExactEIP3009Payload,
  ExactPermit2Payload,
  Permit2Witness,
  Permit2Authorization,
  ExactTronPayload,
  GasFreeMessage,
  ExactGasFreePayload,
} from "./types";
export { isPermit2Payload, isEIP3009Payload } from "./types";

// Constants
export {
  TRON_CHAIN_IDS,
  PERMIT2_ADDRESSES,
  X402_PERMIT2_PROXY_ADDRESSES,
  X402_UPTO_PERMIT2_PROXY_ADDRESSES,
  authorizationTypes,
  transferWithAuthorizationABI,
  permit2WitnessTypes,
  x402ExactPermit2ProxyABI,
  erc20AllowanceAbi,
  erc20ApproveAbi,
} from "./constants";

// Token registry
export {
  getToken,
  findByAddress,
  getNetworkTokens,
  registerToken,
  getDecimals,
  buildAssetExtra,
  parsePrice,
  type TokenInfo,
} from "./shared/tokens";

// Fee
export {
  resolveBaseFee,
  isTokenAllowed,
  buildFeeInfo,
  validateFee,
  readFeeFromExtra,
  type FeeInfo,
  type ExactTronFeeConfig,
} from "./shared/fee";

// Token selection + balance-aware selection
export {
  CheapestTokenSelectionStrategy,
  DefaultTokenSelectionStrategy,
  createCheapestTokenSelector,
  type TokenSelectionStrategy,
} from "./shared/tokenSelection";
export {
  filterAffordableRequirements,
  selectAffordableRequirement,
  type BalanceCheckable,
} from "./shared/balance";

// Utils
export {
  getTronChainId,
  tronAddressToEvm,
  evmAddressToTron,
  isTronAddress,
  normalizeAddressForSigning,
} from "./utils";

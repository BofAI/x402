// Client
export { ExactTronScheme } from "./exact/client/scheme";
export { registerExactTronScheme } from "./exact/client/register";
export type { ExactTronClientConfig } from "./exact/client/register";
export {
  createPermit2ApprovalTx,
  getPermit2AllowanceReadParams,
  type Permit2AllowanceParams,
} from "./exact/client/permit2Helpers";
export {
  TRC20_APPROVAL_MAX_AMOUNT,
  TRC20_APPROVAL_RESOURCE_SPONSORING_KEY,
  TRC20_APPROVAL_RESOURCE_SPONSORING_VERSION,
  type Trc20ApprovalResourceSponsoringFacilitatorExtension,
  type Trc20ApprovalResourceSponsoringInfo,
  type Trc20ApprovalResourceSponsoringRequest,
  type Trc20ApprovalResourceSponsoringResult,
  type Trc20ApprovalResourceSponsoringRuntime,
  type Trc20ApprovalResourceSponsoringVerification,
  type Trc20SponsorshipExecutionOptions,
  type Trc20SponsorshipRevalidationResult,
} from "./shared/extensions/trc20ApprovalContract";
export {
  buildTrc20SponsoringPlan,
  createTrc20ApprovalResourceSponsoringRuntime,
  createTrc20ResourceSponsoringRuntime,
  createStaticTrc20ResourceSponsoringPolicy,
  createTronWebResourceSponsoringChain,
  InMemoryTrc20SponsoringCoordinator,
  resourceUnitsToStakeSun,
  type InMemoryTrc20SponsoringCoordinatorOptions,
  type CreateTrc20ResourceSponsoringRuntimeOptions,
  type StaticTrc20ResourceSponsoringPolicyOptions,
  type ManagedTrc20ApprovalResourceSponsoringRuntime,
  type PreparedTronAction,
  type Trc20ResourceLeg,
  type Trc20ResourceSponsoringChain,
  type Trc20ResourceSponsoringPolicy,
  type Trc20ResourceSponsoringRuntimeOptions,
  type Trc20SponsoringCoordinator,
  type Trc20SponsoringOperation,
  type Trc20SponsoringPlan,
  type Trc20SponsoringPreflight,
  type TronResourceSnapshot,
  type TronResourceOwnerActionIntent,
  type TronResourceOwnerSigner,
  type TronResourceType,
  type TronWebResourceSponsoringChainOptions,
} from "./resource-sponsoring";

// Upto client
export { UptoTronScheme } from "./upto/client/scheme";
export { createUptoPermit2Payload } from "./upto/client/permit2";

// Signers
export {
  createClientTronSigner,
  createFacilitatorTronSigner,
  createAuthorizerTronSigner,
  normalizeSignedTronTransaction,
  serializeSignedTronTransaction,
} from "./signer";
export type {
  ClientTronSigner,
  FacilitatorTronSigner,
  ClientTronWallet,
  FacilitatorTronWallet,
  TronAuthorizerSignerLike,
  FacilitatorTronSignerOptions,
  CreateClientTronSignerOptions,
  AllowanceMode,
  TronTransactionReceipt,
} from "./signer";
export {
  createTrc20ApprovalPolicy,
  type CreateTrc20ApprovalPolicyOptions,
  type Trc20ApprovalPolicy,
  type Trc20ApprovalUpdateStrategy,
} from "./approvalPolicy";

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
  UptoPermit2Witness,
  UptoPermit2Authorization,
  UptoPermit2Payload,
} from "./types";
export { isPermit2Payload, isEIP3009Payload, isUptoPermit2Payload } from "./types";

// Constants
export {
  TRON_MAINNET,
  TRON_NILE,
  TRON_SHASTA,
  TRON_CHAIN_IDS,
  PERMIT2_ADDRESSES,
  X402_PERMIT2_PROXY_ADDRESSES,
  X402_UPTO_PERMIT2_PROXY_ADDRESSES,
  authorizationTypes,
  transferWithAuthorizationABI,
  permit2WitnessTypes,
  uptoPermit2WitnessTypes,
  x402ExactPermit2ProxyABI,
  x402UptoPermit2ProxyABI,
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
  parsePrice,
  type TokenInfo,
} from "./shared/tokens";

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
export { normalizeTronNetwork, tronNetworksEqual, getTronNetworkValue } from "./network";

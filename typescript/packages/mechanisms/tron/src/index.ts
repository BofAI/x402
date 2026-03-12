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
export type { ClientTronSigner, FacilitatorTronSigner } from "./signer";

// Types
export type {
  AssetTransferMethod,
  ExactEIP3009Payload,
  ExactPermit2Payload,
  Permit2Witness,
  Permit2Authorization,
  ExactTronPayload,
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

// Utils
export {
  getTronChainId,
  tronAddressToEvm,
  evmAddressToTron,
  isTronAddress,
  normalizeAddressForSigning,
} from "./utils";

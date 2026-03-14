import type { VerifyResponse } from "@bankofai/x402-core/types";
import {
  validateTrc20ApprovalGasSponsoringInfo,
  type Trc20ApprovalGasSponsoringInfo,
  type Trc20ApprovalGasSponsoringSigner,
} from "@bankofai/x402-extensions";
import { utils as tronUtils } from "tronweb";
import { normalizeAddressForSigning } from "../../utils";
import {
  INVALID_TRC20_APPROVAL_FORMAT,
  INVALID_TRC20_APPROVAL_FROM_MISMATCH,
  INVALID_TRC20_APPROVAL_ASSET_MISMATCH,
  INVALID_TRC20_APPROVAL_SPENDER_NOT_PERMIT2,
  INVALID_TRC20_APPROVAL_TX_MISSING_DATA,
  INVALID_TRC20_APPROVAL_TX_WRONG_TARGET,
  INVALID_TRC20_APPROVAL_TX_WRONG_SELECTOR,
  INVALID_TRC20_APPROVAL_TX_WRONG_SPENDER,
  INVALID_TRC20_APPROVAL_TX_WRONG_AMOUNT,
  INVALID_TRC20_APPROVAL_TX_INVALID_SIGNATURE,
} from "./errors";

const APPROVE_SELECTOR = tronUtils.ethersUtils.id("approve(address,uint256)").slice(2, 10);
const MAX_UINT256 = BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");

function getApprovalTransactionValue(signedTransaction: Record<string, unknown>): {
  ownerAddress?: string;
  contractAddress?: string;
  data?: string;
} {
  const rawData = signedTransaction.raw_data as { contract?: Array<Record<string, unknown>> } | undefined;
  const contract = rawData?.contract?.[0];
  const parameter = contract?.parameter as { value?: Record<string, unknown> } | undefined;
  const value = parameter?.value ?? {};

  return {
    ownerAddress: typeof value.owner_address === "string" ? value.owner_address : undefined,
    contractAddress: typeof value.contract_address === "string" ? value.contract_address : undefined,
    data: typeof value.data === "string" ? value.data.toLowerCase() : undefined,
  };
}

function decodeApprovalCalldata(data: string): { spender: `0x${string}`; amount: bigint } | null {
  const cleaned = data.replace(/^0x/, "");
  if (!cleaned.startsWith(APPROVE_SELECTOR) || cleaned.length < 8 + 64 + 64) {
    return null;
  }

  const spenderWord = cleaned.slice(8, 8 + 64);
  const amountWord = cleaned.slice(8 + 64, 8 + 128);

  return {
    spender: `0x${spenderWord.slice(24).toLowerCase()}` as `0x${string}`,
    amount: BigInt(`0x${amountWord}`),
  };
}

export async function validateTrc20ApprovalForPayment(
  signer: Trc20ApprovalGasSponsoringSigner,
  info: Trc20ApprovalGasSponsoringInfo,
  payer: `0x${string}`,
  tokenAddress: `0x${string}`,
  permit2Address: string,
): Promise<Pick<VerifyResponse, "isValid" | "invalidReason" | "invalidMessage">> {
  if (!validateTrc20ApprovalGasSponsoringInfo(info)) {
    return {
      isValid: false,
      invalidReason: INVALID_TRC20_APPROVAL_FORMAT,
      invalidMessage: "TRC-20 approval extension info failed schema validation",
    };
  }

  if (normalizeAddressForSigning(info.from) !== normalizeAddressForSigning(payer)) {
    return {
      isValid: false,
      invalidReason: INVALID_TRC20_APPROVAL_FROM_MISMATCH,
      invalidMessage: `Expected from=${payer}, got ${info.from}`,
    };
  }

  if (normalizeAddressForSigning(info.asset) !== normalizeAddressForSigning(tokenAddress)) {
    return {
      isValid: false,
      invalidReason: INVALID_TRC20_APPROVAL_ASSET_MISMATCH,
      invalidMessage: `Expected asset=${tokenAddress}, got ${info.asset}`,
    };
  }

  if (normalizeAddressForSigning(info.spender) !== normalizeAddressForSigning(permit2Address)) {
    return {
      isValid: false,
      invalidReason: INVALID_TRC20_APPROVAL_SPENDER_NOT_PERMIT2,
      invalidMessage: `Expected spender=${permit2Address}, got ${info.spender}`,
    };
  }

  const tx = info.signedTransaction;
  const txValue = getApprovalTransactionValue(tx);
  if (!txValue.ownerAddress || !txValue.contractAddress || !txValue.data) {
    return {
      isValid: false,
      invalidReason: INVALID_TRC20_APPROVAL_TX_MISSING_DATA,
      invalidMessage: "Signed approval transaction is missing owner, target, or calldata",
    };
  }

  if (
    normalizeAddressForSigning(txValue.ownerAddress) !== normalizeAddressForSigning(payer)
  ) {
    return {
      isValid: false,
      invalidReason: INVALID_TRC20_APPROVAL_FROM_MISMATCH,
      invalidMessage: `Approval tx owner is ${txValue.ownerAddress}, expected ${payer}`,
    };
  }

  if (
    normalizeAddressForSigning(txValue.contractAddress) !== normalizeAddressForSigning(tokenAddress)
  ) {
    return {
      isValid: false,
      invalidReason: INVALID_TRC20_APPROVAL_TX_WRONG_TARGET,
      invalidMessage: `Approval tx targets ${txValue.contractAddress}, expected ${tokenAddress}`,
    };
  }

  if (!txValue.data.startsWith(APPROVE_SELECTOR)) {
    return {
      isValid: false,
      invalidReason: INVALID_TRC20_APPROVAL_TX_WRONG_SELECTOR,
      invalidMessage: `Approval tx calldata does not start with approve() selector ${APPROVE_SELECTOR}`,
    };
  }

  const decoded = decodeApprovalCalldata(txValue.data);
  if (!decoded) {
    return {
      isValid: false,
      invalidReason: INVALID_TRC20_APPROVAL_TX_WRONG_SELECTOR,
      invalidMessage: "Failed to decode approve() calldata from the signed transaction",
    };
  }

  if (normalizeAddressForSigning(decoded.spender) !== normalizeAddressForSigning(permit2Address)) {
    return {
      isValid: false,
      invalidReason: INVALID_TRC20_APPROVAL_TX_WRONG_SPENDER,
      invalidMessage: `approve() spender is ${decoded.spender}, expected Permit2 ${permit2Address}`,
    };
  }

  if (decoded.amount !== MAX_UINT256 || info.amount !== MAX_UINT256.toString()) {
    return {
      isValid: false,
      invalidReason: INVALID_TRC20_APPROVAL_TX_WRONG_AMOUNT,
      invalidMessage: "approve() amount must be MaxUint256 for Permit2 gas sponsoring",
    };
  }

  try {
    const signWeight = (await signer.getSignWeight({ transaction: tx })) as {
      result?: { result?: boolean; code?: string };
      transaction?: { result?: { result?: boolean; code?: string } };
      approved_list?: string[];
      current_weight?: number;
      permission?: { threshold?: number };
    };
    const isValidSignature =
      signWeight?.transaction?.result?.result ??
      signWeight?.result?.result ??
      (typeof signWeight?.current_weight === "number" &&
      typeof signWeight?.permission?.threshold === "number"
        ? signWeight.current_weight >= signWeight.permission.threshold
        : undefined) ??
      (Array.isArray(signWeight?.approved_list) ? signWeight.approved_list.length > 0 : undefined) ??
      false;

    if (!isValidSignature) {
      const errorCode = signWeight?.transaction?.result?.code ?? signWeight?.result?.code;
      return {
        isValid: false,
        invalidReason: INVALID_TRC20_APPROVAL_TX_INVALID_SIGNATURE,
        invalidMessage: `TRON node rejected the signed approval transaction${
          errorCode ? ` (${errorCode})` : ""
        }`,
      };
    }
  } catch {
    return {
      isValid: false,
      invalidReason: INVALID_TRC20_APPROVAL_TX_INVALID_SIGNATURE,
      invalidMessage: "Failed to verify the signed approval transaction",
    };
  }

  return { isValid: true };
}

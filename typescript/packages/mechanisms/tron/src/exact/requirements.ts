import { isUint256 } from "../shared/validation";
import type { Network } from "@x402/core/types";
import {
  PERMIT2_ADDRESSES,
  X402_PERMIT2_PROXY_ADDRESSES,
  X402_UPTO_PERMIT2_PROXY_ADDRESSES,
} from "../constants";
import {
  BATCH_SETTLEMENT_ADDRESSES,
  ERC3009_DEPOSIT_COLLECTOR_ADDRESSES,
  PERMIT2_DEPOSIT_COLLECTOR_ADDRESSES,
} from "../shared/batch-settlement/constants";
import { getNetworkTokens } from "../shared/tokens";
import type { AssetTransferMethod } from "../types";
import { normalizeAddressForSigning } from "../utils";

interface ExactRequirements {
  network: Network;
  asset: string;
  amount: string;
  extra?: Record<string, unknown>;
}

type ValidationResult =
  | { success: true; method: AssetTransferMethod | undefined }
  | { success: false; reason: string };

/**
 * Validate exact payment terms and infer registered tokens' transfer methods.
 * Leave the method unresolved for custom tokens without an explicit choice. Infrastructure
 * contracts are never payment assets, and registered Permit2 tokens cannot be
 * forced through an unsupported EIP-3009 call.
 *
 * @param requirements - Payment terms before signing or settlement.
 * @returns Explicit or registered method if available, or a stable protocol rejection reason.
 */
export function validateExactRequirements(requirements: ExactRequirements): ValidationResult {
  if (
    !isUint256(requirements.amount) ||
    !/^[0-9]+$/.test(requirements.amount) ||
    BigInt(requirements.amount) === 0n
  ) {
    return { success: false, reason: "invalid_exact_tron_amount" };
  }
  let asset: string;
  try {
    asset = normalizeAddressForSigning(requirements.asset);
    if (!/^0x[0-9a-f]{40}$/.test(asset)) throw new Error("Invalid address");
  } catch {
    return { success: false, reason: "invalid_exact_tron_asset" };
  }
  const infrastructure = [
    PERMIT2_ADDRESSES,
    X402_PERMIT2_PROXY_ADDRESSES,
    X402_UPTO_PERMIT2_PROXY_ADDRESSES,
    BATCH_SETTLEMENT_ADDRESSES,
    ERC3009_DEPOSIT_COLLECTOR_ADDRESSES,
    PERMIT2_DEPOSIT_COLLECTOR_ADDRESSES,
  ];
  if (
    infrastructure.some(addresses =>
      Object.values(addresses).some(address => normalizeAddressForSigning(address) === asset),
    )
  ) {
    return { success: false, reason: "invalid_exact_tron_asset" };
  }
  const token = Object.values(getNetworkTokens(requirements.network)).find(
    token => normalizeAddressForSigning(token.address) === asset,
  );
  const explicit = requirements.extra?.assetTransferMethod;
  if (explicit !== undefined && explicit !== "permit2" && explicit !== "eip3009") {
    return { success: false, reason: "invalid_exact_tron_asset_transfer_method" };
  }
  if (explicit === "eip3009" && token?.assetTransferMethod === "permit2") {
    return { success: false, reason: "invalid_exact_tron_asset_transfer_method" };
  }
  return { success: true, method: explicit ?? token?.assetTransferMethod };
}

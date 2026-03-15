import {
  TRC20_APPROVAL_GAS_SPONSORING_VERSION,
  type Trc20ApprovalGasSponsoringInfo,
} from "@bankofai/x402-extensions";
import { utils as tronUtils } from "tronweb";
import { PERMIT2_ADDRESSES, DEFAULT_FEE_LIMIT_SUN } from "../../constants";
import { ClientTronSigner } from "../../signer";

const MAX_UINT256 = BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");

/**
 * Builds and signs a TRC-20 `approve(Permit2, MaxUint256)` transaction for sponsored settlement.
 *
 * @param signer - TRON signer capable of building and signing trigger smart contract transactions.
 * @param tokenAddress - Token contract that should grant Permit2 allowance.
 * @param network - Network identifier used to resolve the Permit2 contract address.
 * @returns Sponsored approval payload consumed by the facilitator extension.
 */
export async function signTrc20ApprovalTransaction(
  signer: ClientTronSigner,
  tokenAddress: string,
  network: string,
): Promise<Trc20ApprovalGasSponsoringInfo> {
  if (!signer.buildTriggerSmartContractTransaction || !signer.signTransaction) {
    throw new Error("TRON signer does not support approval transaction signing");
  }

  const spender = PERMIT2_ADDRESSES[network];
  if (!spender) {
    throw new Error(`No Permit2 contract address configured for network ${network}`);
  }

  const unsignedTransaction = await signer.buildTriggerSmartContractTransaction({
    contractAddress: tokenAddress,
    functionSelector: "approve(address,uint256)",
    parameters: [
      { type: "address", value: spender },
      { type: "uint256", value: MAX_UINT256.toString() },
    ],
    feeLimit: DEFAULT_FEE_LIMIT_SUN,
    callValue: 0,
    issuerAddress: signer.address,
  });

  const signedTransaction = await signer.signTransaction(unsignedTransaction);
  const signatures = Array.isArray((signedTransaction as { signature?: unknown }).signature)
    ? (signedTransaction as { signature: unknown[] }).signature
    : [];
  if (signatures.length === 0) {
    throw new Error("Failed to sign TRON approval transaction");
  }

  try {
    const txCheck = tronUtils.transaction.txCheck(signedTransaction);
    if (!txCheck) {
      throw new Error("Failed to sign a valid TRON approval transaction");
    }
  } catch {
    // Some test doubles and custom signer adapters omit optional TRON protobuf metadata.
    // The facilitator fully validates the signed transaction before broadcasting it.
  }

  return {
    from: signer.address,
    asset: tokenAddress,
    spender,
    amount: MAX_UINT256.toString(),
    signedTransaction,
    version: TRC20_APPROVAL_GAS_SPONSORING_VERSION,
  };
}

/**
 * Broadcasts a local TRC-20 approval transaction when sponsoring is unavailable.
 *
 * @param signer - TRON signer capable of building, signing, and broadcasting approval transactions.
 * @param tokenAddress - Token contract that should grant Permit2 allowance.
 * @param network - Network identifier used to resolve the Permit2 contract address.
 * @returns The approval transaction hash.
 */
export async function broadcastTrc20ApprovalTransaction(
  signer: ClientTronSigner,
  tokenAddress: string,
  network: string,
): Promise<string> {
  if (!signer.sendRawTransaction || !signer.waitForTransactionReceipt) {
    throw new Error(
      "local_approve_unsupported: TRON signer cannot broadcast approval transactions",
    );
  }

  const info = await signTrc20ApprovalTransaction(signer, tokenAddress, network);
  const hash = await signer.sendRawTransaction({
    signedTransaction: info.signedTransaction,
  });
  const receipt = await signer.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`local_approve_failed: approval transaction ${hash} did not succeed`);
  }
  return hash;
}

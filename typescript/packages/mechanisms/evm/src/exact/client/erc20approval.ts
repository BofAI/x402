import { encodeFunctionData, getAddress, maxUint256 } from "viem";
import {
  ERC20_APPROVAL_GAS_SPONSORING_VERSION,
  type Erc20ApprovalGasSponsoringInfo,
} from "@bankofai/x402-extensions";
import {
  getPermit2Address,
  erc20ApproveAbi,
  ERC20_APPROVE_GAS_LIMIT,
  DEFAULT_MAX_FEE_PER_GAS,
  DEFAULT_MAX_PRIORITY_FEE_PER_GAS,
} from "../../constants";
import { ClientEvmSigner } from "../../signer";

/**
 * Signs an EIP-1559 `approve(Permit2, MaxUint256)` transaction for the given token.
 *
 * The signed transaction is NOT broadcast here — the facilitator broadcasts it
 * atomically before settling the Permit2 payment. This enables Permit2 payments
 * for generic ERC-20 tokens that do NOT implement EIP-2612.
 *
 * Always approves MaxUint256 regardless of the payment amount.
 *
 * @param signer - The client EVM signer (must support signTransaction, getTransactionCount)
 * @param tokenAddress - The ERC-20 token contract address
 * @param network - The target EVM network used to resolve Permit2
 * @param chainId - The chain ID
 * @returns The ERC-20 approval gas sponsoring info object
 */
export async function signErc20ApprovalTransaction(
  signer: ClientEvmSigner,
  tokenAddress: `0x${string}`,
  network: string,
  chainId: number,
): Promise<Erc20ApprovalGasSponsoringInfo> {
  const from = signer.address;
  const spender = getAddress(getPermit2Address(network));

  // Encode approve(PERMIT2_ADDRESS, MaxUint256) calldata
  const data = encodeFunctionData({
    abi: erc20ApproveAbi,
    functionName: "approve",
    args: [spender, maxUint256],
  });

  // Get current nonce for the sender
  const nonce = await signer.getTransactionCount!({ address: from });

  // Get current fee estimates, with fallback values
  let maxFeePerGas: bigint;
  let maxPriorityFeePerGas: bigint;
  try {
    const fees = await signer.estimateFeesPerGas!();
    maxFeePerGas = fees.maxFeePerGas;
    maxPriorityFeePerGas = fees.maxPriorityFeePerGas;
  } catch {
    maxFeePerGas = DEFAULT_MAX_FEE_PER_GAS;
    maxPriorityFeePerGas = DEFAULT_MAX_PRIORITY_FEE_PER_GAS;
  }

  // Sign the EIP-1559 transaction (not broadcast)
  const signedTransaction = await signer.signTransaction!({
    to: tokenAddress,
    data,
    nonce,
    gas: ERC20_APPROVE_GAS_LIMIT,
    maxFeePerGas,
    maxPriorityFeePerGas,
    chainId,
  });

  return {
    from,
    asset: tokenAddress,
    spender,
    amount: maxUint256.toString(),
    signedTransaction,
    version: ERC20_APPROVAL_GAS_SPONSORING_VERSION,
  };
}

/**
 * Broadcasts a local ERC-20 approval transaction when the facilitator does not
 * advertise approval sponsoring.
 *
 * @param signer - Client signer capable of broadcasting or signing raw approval transactions.
 * @param tokenAddress - ERC-20 token contract address to approve.
 * @param network - Network used to resolve the Permit2 deployment.
 * @param chainId - Chain ID used when signing a raw fallback transaction.
 * @returns The approval transaction hash.
 */
export async function broadcastErc20ApprovalTransaction(
  signer: ClientEvmSigner,
  tokenAddress: `0x${string}`,
  network: string,
  chainId: number,
): Promise<`0x${string}`> {
  if (signer.sendTransaction && signer.waitForTransactionReceipt) {
    const tx = encodeFunctionData({
      abi: erc20ApproveAbi,
      functionName: "approve",
      args: [getAddress(getPermit2Address(network)), maxUint256],
    });
    const hash = await signer.sendTransaction({
      to: tokenAddress,
      data: tx,
    });
    const receipt = await signer.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      throw new Error(`local_approve_failed: approval transaction ${hash} did not succeed`);
    }
    return hash;
  }

  if (
    signer.signTransaction &&
    signer.getTransactionCount &&
    signer.estimateFeesPerGas &&
    signer.sendRawTransaction &&
    signer.waitForTransactionReceipt
  ) {
    const info = await signErc20ApprovalTransaction(signer, tokenAddress, network, chainId);
    const hash = await signer.sendRawTransaction({
      serializedTransaction: info.signedTransaction,
    });
    const receipt = await signer.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      throw new Error(`local_approve_failed: approval transaction ${hash} did not succeed`);
    }
    return hash;
  }

  throw new Error("local_approve_unsupported: EVM signer cannot broadcast approval transactions");
}

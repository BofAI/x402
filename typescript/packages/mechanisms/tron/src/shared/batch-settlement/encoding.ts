/**
 * @file ABI encoding helpers for batch-settlement deposit collectors (TRON).
 *
 * Uses TRON's bundled ethers `AbiCoder` / `keccak256` for chain-agnostic ABI
 * encoding. The encodings match the EVM collectors verbatim.
 */
import { utils as tronUtils } from "tronweb";

const coder = (() => {
  const AbiCoder = tronUtils.ethersUtils.AbiCoder as unknown as {
    defaultAbiCoder?: () => { encode(types: string[], values: unknown[]): string };
    new (): { encode(types: string[], values: unknown[]): string };
  };
  return AbiCoder.defaultAbiCoder ? AbiCoder.defaultAbiCoder() : new AbiCoder();
})();

const keccak256 = tronUtils.ethersUtils.keccak256 as (data: string) => string;

/**
 * Computes the ERC-3009 nonce used by the deposit collector:
 * `keccak256(abi.encode(channelId, salt))`.
 *
 * @param channelId - The `bytes32` channel id binding the authorization to a channel.
 * @param salt - Random salt provided by the client to make the nonce unique per deposit.
 * @returns The `bytes32` ERC-3009 nonce.
 */
export function buildErc3009DepositNonce(
  channelId: `0x${string}`,
  salt: `0x${string}`,
): `0x${string}` {
  return keccak256(
    coder.encode(["bytes32", "uint256"], [channelId, BigInt(salt)]),
  ) as `0x${string}`;
}

/**
 * Encodes the `collectorData` payload for `ERC3009DepositCollector.collect()`:
 * `abi.encode(validAfter, validBefore, salt, signature)`.
 *
 * @param validAfter - Earliest unix timestamp the authorization is valid (decimal string).
 * @param validBefore - Latest unix timestamp the authorization is valid (decimal string).
 * @param salt - Random salt provided by the client (hex string).
 * @param signature - ERC-3009 `ReceiveWithAuthorization` signature.
 * @returns ABI-encoded collector data passed to `deposit(..., collector, collectorData)`.
 */
export function buildErc3009CollectorData(
  validAfter: string,
  validBefore: string,
  salt: `0x${string}`,
  signature: `0x${string}`,
): `0x${string}` {
  return coder.encode(
    ["uint256", "uint256", "uint256", "bytes"],
    [BigInt(validAfter), BigInt(validBefore), BigInt(salt), signature],
  ) as `0x${string}`;
}

/**
 * Encodes the `collectorData` payload for `Permit2DepositCollector.collect()`.
 *
 * @param nonce - Permit2 transfer nonce.
 * @param deadline - Permit2 transfer deadline.
 * @param permit2Signature - Signature over the channel-bound Permit2 authorization.
 * @param eip2612PermitData - Optional encoded EIP-2612 permit segment.
 * @returns ABI-encoded collector data passed to `deposit`.
 */
export function buildPermit2CollectorData(
  nonce: string,
  deadline: string,
  permit2Signature: `0x${string}`,
  eip2612PermitData: `0x${string}` = "0x",
): `0x${string}` {
  return coder.encode(
    ["uint256", "uint256", "bytes", "bytes"],
    [BigInt(nonce), BigInt(deadline), permit2Signature, eip2612PermitData],
  ) as `0x${string}`;
}

/**
 * Encodes a contract function call into calldata bytes (used for the contract's
 * `multicall(bytes[])` batching of claim + refund).
 *
 * @param abi - Contract ABI containing the function.
 * @param functionName - Name of the function to encode.
 * @param args - Positional arguments for the function.
 * @returns ABI-encoded calldata bytes as a hex string.
 */
export function encodeFunctionData(
  abi: readonly unknown[],
  functionName: string,
  args: readonly unknown[],
): `0x${string}` {
  const Interface = tronUtils.ethersUtils.Interface as unknown as {
    new (abi: readonly unknown[]): {
      encodeFunctionData(name: string, args: readonly unknown[]): string;
    };
  };
  const iface = new Interface(abi);
  return iface.encodeFunctionData(functionName, args) as `0x${string}`;
}

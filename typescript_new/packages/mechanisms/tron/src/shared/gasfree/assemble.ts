import type { GasFreeMessage } from "../../types";
import { normalizeAddressForSigning } from "../../utils";
import { getGasFreeDomain } from "./config";

/** GasFree TIP-712 primary type (GasFreeController `PermitTransfer`). */
export const GASFREE_PRIMARY_TYPE = "PermitTransfer";

/**
 * GasFree TIP-712 type definitions. Field order is contract-significant and
 * must match the GasFreeController's struct hash exactly.
 */
export const GASFREE_TYPES = {
  [GASFREE_PRIMARY_TYPE]: [
    { name: "token", type: "address" },
    { name: "serviceProvider", type: "address" },
    { name: "user", type: "address" },
    { name: "receiver", type: "address" },
    { name: "value", type: "uint256" },
    { name: "maxFee", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "version", type: "uint256" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

/**
 * Assemble the TIP-712 domain, types, and message for a GasFree permit.
 *
 * Address fields are converted to EVM-hex (the form the signer/verifier expect)
 * and numeric fields to BigInt, mirroring the exact/permit2 signing convention.
 *
 * @param message - The GasFree message with Base58Check addresses.
 * @param network - CAIP-2 network identifier.
 * @returns The `{ domain, types, message }` ready for signTypedData/verifyTypedData.
 */
export function assembleGasFreeTransaction(
  message: GasFreeMessage,
  network: string,
): {
  domain: ReturnType<typeof getGasFreeDomain>;
  types: typeof GASFREE_TYPES;
  primaryType: typeof GASFREE_PRIMARY_TYPE;
  message: {
    token: `0x${string}`;
    serviceProvider: `0x${string}`;
    user: `0x${string}`;
    receiver: `0x${string}`;
    value: bigint;
    maxFee: bigint;
    deadline: bigint;
    version: bigint;
    nonce: bigint;
  };
} {
  return {
    domain: getGasFreeDomain(network),
    types: GASFREE_TYPES,
    primaryType: GASFREE_PRIMARY_TYPE,
    message: {
      token: normalizeAddressForSigning(message.token),
      serviceProvider: normalizeAddressForSigning(message.serviceProvider),
      user: normalizeAddressForSigning(message.user),
      receiver: normalizeAddressForSigning(message.receiver),
      value: BigInt(message.value),
      maxFee: BigInt(message.maxFee),
      deadline: BigInt(message.deadline),
      version: BigInt(message.version),
      nonce: BigInt(message.nonce),
    },
  };
}

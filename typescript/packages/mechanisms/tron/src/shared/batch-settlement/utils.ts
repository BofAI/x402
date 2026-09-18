/**
 * @file Channel id / typed-data hashing for the TRON batch-settlement scheme.
 *
 * Uses TRON's bundled ethers `TypedDataEncoder` for EIP-712 hashing. This was
 * cross-checked against viem's `hashTypedData` for an identical `ChannelConfig`
 * and produces byte-identical digests, so off-chain `computeChannelId` matches
 * the on-chain `getChannelId`.
 */
import { utils as tronUtils } from "tronweb";
import { getTronChainId, normalizeAddressForSigning } from "../../utils";
import {
  BATCH_SETTLEMENT_DOMAIN,
  channelConfigTypes,
  getBatchSettlementAddress,
} from "./constants";
import type { ChannelConfig } from "../../batch-settlement/types";

type Eip712Domain = {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: `0x${string}`;
};

/**
 * Compute the EIP-712 digest of typed data using TRON's bundled encoder.
 *
 * @param domain - EIP-712 domain (addresses already in EVM hex form).
 * @param types - Typed-data type definitions (without `EIP712Domain`).
 * @param message - The message to hash.
 * @returns The `bytes32` digest as a hex string.
 */
export function hashTypedData(
  domain: Record<string, unknown>,
  types: Record<string, ReadonlyArray<{ name: string; type: string }>>,
  message: Record<string, unknown>,
): `0x${string}` {
  return tronUtils.typedData.TypedDataEncoder.hash(
    domain,
    types as unknown as Record<string, Array<{ name: string; type: string }>>,
    message,
  ) as `0x${string}`;
}

/**
 * Returns the full TIP-712 domain for the batch-settlement contract on a network.
 *
 * @param network - CAIP-2 network identifier (e.g. `"tron:3448148188"`).
 * @returns Domain with `name`, `version`, `chainId`, and EVM-hex `verifyingContract`.
 */
export function getBatchSettlementTip712Domain(network: string): Eip712Domain {
  return {
    ...BATCH_SETTLEMENT_DOMAIN,
    chainId: getTronChainId(network),
    verifyingContract: normalizeAddressForSigning(getBatchSettlementAddress(network)),
  };
}

/**
 * Computes the chain-bound channel id from a {@link ChannelConfig}.
 *
 * Address fields are normalized to EVM hex before hashing so the result matches
 * the on-chain `getChannelId` regardless of Base58Check vs hex input form.
 *
 * @param config - The immutable channel configuration.
 * @param network - CAIP-2 network identifier.
 * @returns The `bytes32` channel id as a hex string.
 */
export function computeChannelId(config: ChannelConfig, network: string): `0x${string}` {
  return hashTypedData(getBatchSettlementTip712Domain(network), channelConfigTypes, {
    payer: normalizeAddressForSigning(config.payer),
    payerAuthorizer: normalizeAddressForSigning(config.payerAuthorizer),
    receiver: normalizeAddressForSigning(config.receiver),
    receiverAuthorizer: normalizeAddressForSigning(config.receiverAuthorizer),
    token: normalizeAddressForSigning(config.token),
    withdrawDelay: config.withdrawDelay,
    salt: config.salt,
  });
}

/**
 * Recovers the signer address of a typed-data signature.
 *
 * @param domain - EIP-712 domain used when signing.
 * @param types - Typed-data type definitions (without `EIP712Domain`).
 * @param message - The signed message.
 * @param signature - The signature bytes.
 * @returns The recovered address in EVM hex (lowercased).
 */
export function recoverTypedDataAddress(
  domain: Record<string, unknown>,
  types: Record<string, ReadonlyArray<{ name: string; type: string }>>,
  message: Record<string, unknown>,
  signature: `0x${string}`,
): `0x${string}` {
  const recovered = tronUtils.typedData.verifyTypedData(
    domain,
    types as unknown as Record<string, Array<{ name: string; type: string }>>,
    message,
    signature,
  );
  return normalizeAddressForSigning(recovered);
}

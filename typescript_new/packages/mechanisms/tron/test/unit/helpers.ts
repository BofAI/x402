import { TronWeb } from "tronweb";
import type { ClientTronWallet } from "../../src/signer";

/**
 * Test-only helper: wrap a raw private key as an {@link AgentWallet}.
 *
 * Not part of the public SDK surface — the SDK signers are wallet-only. Used by
 * the offline test suite to drive signers with deterministic fixed keys.
 *
 * @param tronWeb - The TronWeb instance used for TIP-712 signing.
 * @param privateKey - The private key, with or without a `0x` prefix.
 * @returns An AgentWallet backed by the private key.
 */
export function privateKeyTronWallet(tronWeb: TronWeb, privateKey: string): ClientTronWallet {
  const clean = privateKey.replace(/^0x/, "");
  const address = TronWeb.address.fromPrivateKey(clean) as string;
  return {
    getAddress: () => address,
    async signTypedData(args) {
      const signature = await tronWeb.trx._signTypedData(
        args.domain,
        args.types,
        args.message,
        clean,
      );
      return signature as `0x${string}`;
    },
  };
}

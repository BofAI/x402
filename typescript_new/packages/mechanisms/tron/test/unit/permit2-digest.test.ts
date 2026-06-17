import { beforeAll, describe, expect, it } from "vitest";
import { TronWeb, utils as tronUtils } from "tronweb";
import { ExactTronScheme } from "../../src/exact/client/scheme";
import { createClientTronSigner, type ClientTronSigner } from "../../src/signer";
import { privateKeyTronWallet } from "./helpers";
import {
  PERMIT2_ADDRESSES,
  X402_PERMIT2_PROXY_ADDRESSES,
  permit2WitnessTypes,
} from "../../src/constants";
import { getTronChainId, normalizeAddressForSigning, tronAddressToEvm } from "../../src/utils";
import type { ExactPermit2Payload } from "../../src/types";

/**
 * Deterministic offline equivalent of scripts/l1-permit2-digest.mjs.
 *
 * Proves the client's Permit2 (TIP-712) signature is consistent end-to-end with
 * the deployed exact proxy's 2-field witness — without touching the network. If
 * the witness shape, type string, or hashing ever drift from the on-chain
 * contract, these assertions fail before any gas is spent.
 */

const NETWORK = "tron:nile";
// Fixed test key → deterministic payer address (no network, no randomness).
const PAYER_PK = "da146374a75310b9666e834ee4ad0866d6f4035967bfc76217c5a495fff9f0d0";
const PAY_TO = "TJRyWwFs9wTFGZg3JbrVriFbNfCug5tDeC";

// On-chain value read from the deployed exact proxy (TFGoaq…) WITNESS_TYPEHASH().
const ONCHAIN_EXACT_WITNESS_TYPEHASH =
  "0xd97b3239a7f32295517bd14cb074edfdd188dfe5eb42f802bb26d4fd1eb12c37";

const E = tronUtils.ethersUtils;
const abi = E.defaultAbiCoder ?? new E.AbiCoder();
const k = (hex: string): string => E.keccak256(hex);
const kstr = (s: string): string => E.keccak256(E.toUtf8Bytes(s));

describe("exact Permit2 TIP-712 digest (2-field witness)", () => {
  let signer: ClientTronSigner;
  let payerHex: string;
  let auth: ExactPermit2Payload["permit2Authorization"];
  let signature: `0x${string}`;

  beforeAll(async () => {
    const tronWeb = new TronWeb({ fullHost: "https://nile.trongrid.io", privateKey: PAYER_PK });
    signer = await createClientTronSigner(tronWeb, privateKeyTronWallet(tronWeb, PAYER_PK));
    payerHex = tronAddressToEvm(signer.address);

    const requirements = {
      scheme: "exact",
      network: NETWORK,
      asset: "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf",
      amount: "1000",
      payTo: PAY_TO,
      maxTimeoutSeconds: 600,
      extra: { assetTransferMethod: "permit2" },
    };

    const scheme = new ExactTronScheme(signer);
    const result = await scheme.createPaymentPayload(1, requirements);
    const payload = result.payload as ExactPermit2Payload;
    auth = payload.permit2Authorization;
    signature = payload.signature;
  });

  it("signs a 2-field witness (no facilitator field)", () => {
    expect(Object.keys(auth.witness).sort()).toEqual(["to", "validAfter"]);
    expect("facilitator" in auth.witness).toBe(false);
  });

  it("spender is the deployed exact proxy", () => {
    expect(auth.spender.toLowerCase()).toBe(
      normalizeAddressForSigning(X402_PERMIT2_PROXY_ADDRESSES[NETWORK]).toLowerCase(),
    );
  });

  it("local WITNESS_TYPEHASH matches the deployed exact proxy", () => {
    expect(kstr("Witness(address to,uint256 validAfter)")).toBe(ONCHAIN_EXACT_WITNESS_TYPEHASH);
  });

  it("verifies via the facilitator verifyTypedData path", () => {
    const chainId = getTronChainId(NETWORK);
    const domain = {
      name: "Permit2",
      chainId,
      verifyingContract: normalizeAddressForSigning(PERMIT2_ADDRESSES[NETWORK]),
    };
    const message = {
      permitted: { token: auth.permitted.token, amount: BigInt(auth.permitted.amount) },
      spender: auth.spender,
      nonce: BigInt(auth.nonce),
      deadline: BigInt(auth.deadline),
      witness: { to: auth.witness.to, validAfter: BigInt(auth.witness.validAfter) },
    };
    const recovered = tronUtils.typedData.verifyTypedData(
      domain,
      permit2WitnessTypes,
      message,
      signature,
    );
    expect(tronAddressToEvm(recovered)).toBe(payerHex);
  });

  it("verifies against a manually reconstructed on-chain Permit2 digest", () => {
    const chainId = getTronChainId(NETWORK);
    const permit2Hex = normalizeAddressForSigning(PERMIT2_ADDRESSES[NETWORK]);

    const DOMAIN_TYPEHASH = kstr(
      "EIP712Domain(string name,uint256 chainId,address verifyingContract)",
    );
    const domainSeparator = k(
      abi.encode(
        ["bytes32", "bytes32", "uint256", "address"],
        [DOMAIN_TYPEHASH, kstr("Permit2"), chainId, permit2Hex],
      ),
    );

    const tpHash = k(
      abi.encode(
        ["bytes32", "address", "uint256"],
        [
          kstr("TokenPermissions(address token,uint256 amount)"),
          auth.permitted.token,
          BigInt(auth.permitted.amount),
        ],
      ),
    );

    const wHash = k(
      abi.encode(
        ["bytes32", "address", "uint256"],
        [ONCHAIN_EXACT_WITNESS_TYPEHASH, auth.witness.to, BigInt(auth.witness.validAfter)],
      ),
    );

    const PWT_TYPEHASH = kstr(
      "PermitWitnessTransferFrom(TokenPermissions permitted,address spender,uint256 nonce,uint256 deadline,Witness witness)TokenPermissions(address token,uint256 amount)Witness(address to,uint256 validAfter)",
    );
    const structHash = k(
      abi.encode(
        ["bytes32", "bytes32", "address", "uint256", "uint256", "bytes32"],
        [PWT_TYPEHASH, tpHash, auth.spender, BigInt(auth.nonce), BigInt(auth.deadline), wHash],
      ),
    );

    const digest = k(E.concat(["0x1901", domainSeparator, structHash]));
    const recovered = E.recoverAddress(digest, signature);
    expect(recovered.toLowerCase()).toBe(payerHex.toLowerCase());
  });
});

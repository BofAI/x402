import { beforeAll, describe, expect, it } from "vitest";
import { TronWeb, utils as tronUtils } from "tronweb";
import {
  createClientTronSigner,
  type ClientTronSigner,
  type FacilitatorTronSigner,
} from "../../../src/signer";
import { privateKeyTronWallet } from "../helpers";
import { getTronChainId, normalizeAddressForSigning, tronAddressToEvm } from "../../../src/utils";
import {
  ERC3009_DEPOSIT_COLLECTOR_ADDRESSES,
  PERMIT2_DEPOSIT_COLLECTOR_ADDRESSES,
  receiveAuthorizationTypes,
  batchPermit2WitnessTypes,
} from "../../../src/shared/batch-settlement/constants";
import { PERMIT2_ADDRESSES } from "../../../src/constants";
import { buildErc3009DepositNonce } from "../../../src/shared/batch-settlement/encoding";
import { createBatchSettlementEIP3009DepositPayload } from "../../../src/batch-settlement/client/eip3009";
import { createBatchSettlementPermit2DepositPayload } from "../../../src/batch-settlement/client/permit2";
import type {
  BatchSettlementDepositPayload,
  ChannelConfig,
} from "../../../src/batch-settlement/types";

/**
 * Offline verification that batch-settlement deposit authorizations sign and
 * verify end-to-end: ERC-3009 `ReceiveWithAuthorization` (bound to the collector)
 * and the channel-bound Permit2 `DepositWitness`.
 */

const NETWORK = "tron:nile";
const PAYER_PK = "da146374a75310b9666e834ee4ad0866d6f4035967bfc76217c5a495fff9f0d0";
const ASSET = "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf";
const PAY_TO = "TJRyWwFs9wTFGZg3JbrVriFbNfCug5tDeC";

/** Minimal verify-only facilitator signer (tronweb-backed). */
function verifyOnlyFacilitatorSigner(): FacilitatorTronSigner {
  return {
    getAddresses: () => [],
    async readContract() {
      throw new Error("not used");
    },
    async verifyTypedData(args) {
      const recovered = tronUtils.typedData.verifyTypedData(
        args.domain,
        args.types,
        args.message,
        args.signature,
      );
      return tronAddressToEvm(args.address) === tronAddressToEvm(recovered);
    },
    async writeContract() {
      throw new Error("not used");
    },
    async waitForTransactionReceipt() {
      return { status: "success" };
    },
  };
}

const requirements = {
  scheme: "batch-settlement",
  network: NETWORK,
  asset: ASSET,
  amount: "1000",
  payTo: PAY_TO,
  maxTimeoutSeconds: 600,
  extra: { name: "Tether USD", version: "1", receiverAuthorizer: PAY_TO, withdrawDelay: 900 },
};

describe("batch-settlement deposit authorizations (TRON)", () => {
  let signer: ClientTronSigner;
  let config: ChannelConfig;
  let payerHex: string;

  beforeAll(async () => {
    const tronWeb = new TronWeb({ fullHost: "https://nile.trongrid.io", privateKey: PAYER_PK });
    signer = await createClientTronSigner(tronWeb, privateKeyTronWallet(tronWeb, PAYER_PK));
    payerHex = tronAddressToEvm(signer.address);
    config = {
      payer: normalizeAddressForSigning(signer.address),
      payerAuthorizer: normalizeAddressForSigning(signer.address),
      receiver: normalizeAddressForSigning(PAY_TO),
      receiverAuthorizer: normalizeAddressForSigning(PAY_TO),
      token: normalizeAddressForSigning(ASSET),
      withdrawDelay: 900,
      salt: `0x${"00".repeat(32)}` as `0x${string}`,
    };
  });

  it("ERC-3009 ReceiveWithAuthorization is bound to the collector and verifies", async () => {
    const result = await createBatchSettlementEIP3009DepositPayload(
      signer,
      1,
      requirements,
      config,
      "5000",
      "1000",
    );
    const payload = result.payload as BatchSettlementDepositPayload;
    const auth = payload.deposit.authorization.erc3009Authorization!;
    expect(auth).toBeDefined();

    const collectorHex = normalizeAddressForSigning(ERC3009_DEPOSIT_COLLECTOR_ADDRESSES[NETWORK]);
    const nonce = buildErc3009DepositNonce(payload.voucher.channelId, auth.salt);

    const facilitator = verifyOnlyFacilitatorSigner();
    const ok = await facilitator.verifyTypedData({
      address: payerHex,
      domain: {
        name: "Tether USD",
        version: "1",
        chainId: getTronChainId(NETWORK),
        verifyingContract: normalizeAddressForSigning(ASSET),
      },
      types: receiveAuthorizationTypes as unknown as Record<
        string,
        Array<{ name: string; type: string }>
      >,
      primaryType: "ReceiveWithAuthorization",
      message: {
        from: payerHex,
        to: collectorHex,
        value: 5000n,
        validAfter: BigInt(auth.validAfter),
        validBefore: BigInt(auth.validBefore),
        nonce,
      },
      signature: auth.signature,
    });
    expect(ok).toBe(true);
  });

  it("Permit2 DepositWitness binds channelId, spender is the collector, and verifies", async () => {
    const result = await createBatchSettlementPermit2DepositPayload(
      signer,
      1,
      requirements,
      config,
      "5000",
      "1000",
    );
    const payload = result.payload as BatchSettlementDepositPayload;
    const auth = payload.deposit.authorization.permit2Authorization!;
    expect(auth).toBeDefined();

    expect(normalizeAddressForSigning(auth.spender)).toBe(
      normalizeAddressForSigning(PERMIT2_DEPOSIT_COLLECTOR_ADDRESSES[NETWORK]),
    );
    expect(auth.witness.channelId).toBe(payload.voucher.channelId);

    const facilitator = verifyOnlyFacilitatorSigner();
    const ok = await facilitator.verifyTypedData({
      address: payerHex,
      domain: {
        name: "Permit2",
        chainId: getTronChainId(NETWORK),
        verifyingContract: normalizeAddressForSigning(PERMIT2_ADDRESSES[NETWORK]!),
      },
      types: batchPermit2WitnessTypes as unknown as Record<
        string,
        Array<{ name: string; type: string }>
      >,
      primaryType: "PermitWitnessTransferFrom",
      message: {
        permitted: { token: normalizeAddressForSigning(ASSET), amount: 5000n },
        spender: normalizeAddressForSigning(auth.spender),
        nonce: BigInt(auth.nonce),
        deadline: BigInt(auth.deadline),
        witness: { channelId: auth.witness.channelId },
      },
      signature: auth.signature,
    });
    expect(ok).toBe(true);
  });
});

import { beforeAll, describe, expect, it, vi } from "vitest";
import { TronWeb, utils as tronUtils } from "tronweb";
import {
  createClientTronSigner,
  type ClientTronSigner,
  type FacilitatorTronSigner,
} from "../../../src/signer";
import { privateKeyTronWallet } from "../helpers";
import { buildTronWeb } from "../../../src/rpc";

// Factory builds TronWeb internally; mock the builder to inject the seeded one.
vi.mock("../../../src/rpc", () => ({ buildTronWeb: vi.fn() }));
import { getTronChainId, normalizeAddressForSigning, tronAddressToEvm } from "../../../src/utils";
import {
  ERC3009_DEPOSIT_COLLECTOR_ADDRESSES,
  PERMIT2_DEPOSIT_COLLECTOR_ADDRESSES,
  receiveAuthorizationTypes,
  batchPermit2WitnessTypes,
} from "../../../src/shared/batch-settlement/constants";
import { PERMIT2_ADDRESSES } from "../../../src/constants";
import { TRC20_APPROVAL_RESOURCE_SPONSORING_KEY } from "../../../src/exact/extensions";
import { buildErc3009DepositNonce } from "../../../src/shared/batch-settlement/encoding";
import { createBatchSettlementEIP3009DepositPayload } from "../../../src/batch-settlement/client/eip3009";
import { createBatchSettlementPermit2DepositPayload } from "../../../src/batch-settlement/client/permit2";
import { BatchSettlementTronScheme as BatchSettlementFacilitator } from "../../../src/batch-settlement/facilitator/scheme";
import type {
  BatchSettlementDepositPayload,
  ChannelConfig,
} from "../../../src/batch-settlement/types";

/**
 * Offline verification that batch-settlement deposit authorizations sign and
 * verify end-to-end: ERC-3009 `ReceiveWithAuthorization` (bound to the collector)
 * and the channel-bound Permit2 `DepositWitness`.
 */

const NETWORK = "tron:0xcd8690dc";
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
    vi.mocked(buildTronWeb).mockReturnValue(tronWeb);
    signer = await createClientTronSigner(privateKeyTronWallet(tronWeb, PAYER_PK), {
      network: NETWORK,
      allowanceMode: "skip",
    });
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

  it("uses the Permit2 deposit amount when creating a sponsored Approval", async () => {
    const signPermit2Approval = vi.fn(async () => "0a02abcd");
    const sponsoredSigner: ClientTronSigner = {
      ...signer,
      readContract: vi.fn(async () => 0n),
      signPermit2Approval,
      ensureAllowance: vi.fn(async () => true),
    };

    const result = await createBatchSettlementPermit2DepositPayload(
      sponsoredSigner,
      2,
      requirements,
      config,
      "5000",
      "1000",
      undefined,
      {
        extensions: {
          [TRC20_APPROVAL_RESOURCE_SPONSORING_KEY]: { info: { version: "1" } },
        },
      },
    );

    expect(signPermit2Approval).toHaveBeenCalledWith({ token: ASSET, network: NETWORK });
    expect(result.extensions?.[TRC20_APPROVAL_RESOURCE_SPONSORING_KEY]).toMatchObject({
      info: { asset: ASSET, signedTransaction: "0a02abcd" },
    });
    expect(sponsoredSigner.ensureAllowance).not.toHaveBeenCalled();
  });

  it("fails closed on a malformed sponsored Approval after Permit2 deposit validation", async () => {
    const result = await createBatchSettlementPermit2DepositPayload(
      signer,
      2,
      requirements,
      config,
      "5000",
      "1000",
    );
    const facilitatorSigner: FacilitatorTronSigner = {
      ...verifyOnlyFacilitatorSigner(),
      async readContract(args) {
        if (args.functionName === "allowance") return 5000n;
        if (args.functionName === "balanceOf") return 10_000n;
        if (args.functionName === "channels") return [0n, 0n];
        if (args.functionName === "pendingWithdrawals") return [0n, 0n];
        if (args.functionName === "refundNonce") return 0n;
        throw new Error(`unexpected read ${args.functionName}`);
      },
    };
    const payment = {
      x402Version: 2,
      accepted: requirements,
      payload: result.payload,
      extensions: {
        [TRC20_APPROVAL_RESOURCE_SPONSORING_KEY]: { info: { version: "1" } },
      },
    };

    const verified = await new BatchSettlementFacilitator(facilitatorSigner).verify(
      payment as never,
      requirements as never,
      { getExtension: vi.fn(() => undefined) },
    );

    expect(verified).toMatchObject({
      isValid: false,
      invalidReason: "approval_extension_invalid",
    });
  });

  it("rejects a settle envelope whose accepted scheme does not match batch-settlement", async () => {
    const result = await createBatchSettlementPermit2DepositPayload(
      signer,
      2,
      requirements,
      config,
      "5000",
      "1000",
    );
    const payment = {
      x402Version: 2,
      accepted: { ...requirements, scheme: "exact" },
      payload: result.payload,
    };

    const settled = await new BatchSettlementFacilitator(verifyOnlyFacilitatorSigner()).settle(
      payment as never,
      requirements as never,
    );

    expect(settled).toMatchObject({
      success: false,
      errorReason: "invalid_batch_settlement_tron_scheme",
    });
  });
});

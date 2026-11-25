import { x402Facilitator } from "@x402/core/facilitator";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { describe, expect, it, vi } from "vitest";
import { BatchSettlementTronScheme } from "../../src/batch-settlement/facilitator/scheme";
import { computeChannelId } from "../../src/shared/batch-settlement/utils";
import {
  X402_PERMIT2_PROXY_ADDRESSES,
  X402_UPTO_PERMIT2_PROXY_ADDRESSES,
} from "../../src/constants";
import { ExactTronScheme } from "../../src/exact/facilitator/scheme";
import { ExactGasFreeTronScheme } from "../../src/gasfree/facilitator/scheme";
import type { GasFreeAPIClient } from "../../src/shared/gasfree/api";
import { UptoTronScheme } from "../../src/upto/facilitator/scheme";

const network = "tron:3448148188";
const token = "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf";
const payer = "0x1111111111111111111111111111111111111111";
const receiver = "0x2222222222222222222222222222222222222222";
const signature = "0x1234";
const deadline = "4000000000";

const gasfree = {
  token,
  serviceProvider: receiver,
  user: payer,
  receiver,
  value: "100",
  maxFee: "0",
  deadline,
  version: "1",
  nonce: "0",
};
const permit = {
  from: payer,
  spender: X402_UPTO_PERMIT2_PROXY_ADDRESSES[network],
  nonce: "1",
  deadline,
  permitted: { token, amount: "100" },
  witness: { to: receiver, facilitator: receiver, validAfter: "0" },
};
const channelConfig = {
  payer,
  payerAuthorizer: payer,
  receiver,
  receiverAuthorizer: receiver,
  token,
  withdrawDelay: 900,
  salt: `0x${"11".repeat(32)}` as const,
};
const voucher = {
  channelId: computeChannelId(channelConfig, network),
  maxClaimableAmount: "100",
  signature,
};
const claim = {
  voucher: { channel: channelConfig, maxClaimableAmount: "100" },
  signature,
  totalClaimed: "50",
};

const gasfreeReason = "missing_gasfree_payload";
const uptoReason = "unsupported_payload_type";
const batchReason = "invalid_batch_settlement_tron_payload_type";
type TestCase = [
  scheme: string,
  label: string,
  data: Record<string, unknown>,
  reason: string,
  terms?: Partial<PaymentRequirements>,
];
const cases: TestCase[] = [
  [
    "exact_gasfree",
    "missing token",
    { signature, gasfreeAddress: payer, gasfree: { ...gasfree, token: undefined } },
    gasfreeReason,
  ],
  [
    "exact_gasfree",
    "missing receiver",
    { signature, gasfreeAddress: payer, gasfree: { ...gasfree, receiver: undefined } },
    gasfreeReason,
  ],
  [
    "exact_gasfree",
    "missing nonce",
    { signature, gasfreeAddress: payer, gasfree: { ...gasfree, nonce: undefined } },
    gasfreeReason,
  ],
  ["exact_gasfree", "missing account address", { signature, gasfree }, gasfreeReason],
  [
    "exact_gasfree",
    "invalid requirements amount",
    { signature, gasfreeAddress: payer, gasfree },
    "gasfree_amount_mismatch",
    { amount: "invalid" },
  ],
  [
    "upto",
    "invalid permit nonce",
    { signature, permit2Authorization: { ...permit, nonce: "invalid" } },
    uptoReason,
  ],
  [
    "upto",
    "invalid witness address",
    {
      signature,
      permit2Authorization: { ...permit, witness: { ...permit.witness, to: "invalid" } },
    },
    uptoReason,
  ],
  [
    "upto",
    "invalid requirements amount",
    { signature, permit2Authorization: permit },
    "permit2_amount_mismatch",
    { amount: "invalid" },
  ],
  [
    "exact",
    "invalid requirements payTo",
    {
      signature,
      permit2Authorization: { ...permit, spender: X402_PERMIT2_PROXY_ADDRESSES[network] },
    },
    "invalid_exact_tron_pay_to",
    { payTo: "invalid" },
  ],
  [
    "batch-settlement",
    "incomplete channel",
    { type: "voucher", channelConfig: {}, voucher },
    batchReason,
  ],
  [
    "batch-settlement",
    "invalid voucher amount",
    {
      type: "refund",
      channelConfig,
      voucher: { ...voucher, maxClaimableAmount: "invalid" },
      amount: "1",
      refundNonce: "0",
      claims: [],
    },
    batchReason,
  ],
  [
    "batch-settlement",
    "incomplete deposit authorization",
    {
      type: "deposit",
      channelConfig,
      voucher,
      deposit: { amount: "100", authorization: { permit2Authorization: {} } },
    },
    batchReason,
  ],
];
cases.push([
  "batch-settlement",
  "incomplete EIP-3009 deposit authorization",
  {
    type: "deposit",
    channelConfig,
    voucher,
    deposit: {
      amount: "100",
      authorization: {
        erc3009Authorization: { validAfter: "0", salt: channelConfig.salt, signature },
      },
    },
  },
  batchReason,
  {
    extra: {
      receiverAuthorizer: receiver,
      assetTransferMethod: "eip3009",
      name: "Example",
      version: "1",
    },
  },
]);
const settleCases: TestCase[] = [
  ...cases.filter(([, , data]) => data.type !== "voucher"),
  [
    "batch-settlement",
    "incomplete claim",
    { type: "claim", claims: [{ ...claim, voucher: {} }] },
    batchReason,
  ],
  [
    "batch-settlement",
    "invalid refund amount",
    {
      type: "refund",
      channelConfig,
      voucher,
      amount: "invalid",
      refundNonce: "0",
      claims: [claim],
    },
    batchReason,
  ],
  [
    "batch-settlement",
    "invalid settle receiver",
    { type: "settle", token, receiver: {} },
    batchReason,
  ],
];

function setup(
  scheme: string,
  data: Record<string, unknown>,
  terms: Partial<PaymentRequirements> = {},
) {
  const signer = {
    getAddresses: () => [receiver],
    verifyTypedData: vi.fn(async () => true),
    readContract: vi.fn(async (): Promise<unknown> => 1000n),
    writeContract: vi.fn(async () => "11".repeat(32)),
    waitForTransactionReceipt: vi.fn(async () => ({ status: "success" as const })),
  };
  const api = {
    getProviders: vi.fn(async () => [{ address: receiver }]),
    submit: vi.fn(),
  };
  const facilitator = new x402Facilitator()
    .register(network, new ExactTronScheme(signer))
    .register(network, new UptoTronScheme(signer))
    .register(network, new BatchSettlementTronScheme(signer))
    .register(
      network,
      new ExactGasFreeTronScheme(signer, { [network]: api as unknown as GasFreeAPIClient }),
    );
  const requirements: PaymentRequirements = {
    scheme,
    network,
    asset: token,
    amount: "100",
    payTo: receiver,
    maxTimeoutSeconds: 600,
    extra: { receiverAuthorizer: receiver, assetTransferMethod: "permit2" },
    ...terms,
  };
  const payload: PaymentPayload = { x402Version: 2, accepted: requirements, payload: data };
  return { facilitator, payload, requirements, signer, api };
}

describe("malformed TRON facilitator requests", () => {
  it.each(cases)("verify rejects %s with %s", async (scheme, _label, data, reason, terms) => {
    const { facilitator, payload, requirements, signer, api } = setup(scheme, data, terms);
    await expect(facilitator.verify(payload, requirements)).resolves.toMatchObject({
      isValid: false,
      invalidReason: reason,
    });
    expect(signer.verifyTypedData).not.toHaveBeenCalled();
    expect(signer.readContract).not.toHaveBeenCalled();
    expect(api.getProviders).not.toHaveBeenCalled();
  });

  it.each(settleCases)("settle rejects %s with %s", async (scheme, _label, data, reason, terms) => {
    const { facilitator, payload, requirements, signer, api } = setup(scheme, data, terms);
    await expect(facilitator.settle(payload, requirements)).resolves.toMatchObject({
      success: false,
      errorReason: reason,
      transaction: "",
    });
    expect(signer.verifyTypedData).not.toHaveBeenCalled();
    expect(signer.readContract).not.toHaveBeenCalled();
    expect(signer.writeContract).not.toHaveBeenCalled();
    expect(api.submit).not.toHaveBeenCalled();
  });
});

describe("TRON signature field errors", () => {
  const voucherSignatureError = "invalid_batch_settlement_tron_voucher_signature";

  it.each([
    ["wrong length", "0x1234"],
    ["non-hex bytes", `0x${"gg".repeat(64)}1b`],
    ["high s", `0x${"01".repeat(32)}${"ff".repeat(32)}1b`],
    ["raw recovery parity", `0x${"01".repeat(64)}00`],
  ])("rejects a voucher with %s before checking its signer", async (_label, signature) => {
    const { facilitator, payload, requirements, signer } = setup("batch-settlement", {
      type: "voucher",
      channelConfig,
      voucher: { ...voucher, signature },
    });
    signer.readContract.mockResolvedValueOnce([1000n, 0n]);
    await expect(facilitator.verify(payload, requirements)).resolves.toMatchObject({
      isValid: false,
      invalidReason: voucherSignatureError,
    });
    expect(signer.verifyTypedData).not.toHaveBeenCalled();
    expect(signer.readContract).not.toHaveBeenCalled();
  });

  it.each(["claim", "refund"] as const)(
    "rejects an invalid voucher signature in %s before broadcasting",
    async type => {
      const { facilitator, payload, requirements, signer } = setup("batch-settlement", {
        type,
        claims: [claim],
        claimAuthorizerSignature: signature,
        ...(type === "refund"
          ? {
              channelConfig,
              voucher,
              amount: "1",
              refundNonce: "0",
              refundAuthorizerSignature: signature,
            }
          : {}),
      });
      signer.readContract.mockResolvedValueOnce([1000n, 0n]);
      await expect(facilitator.settle(payload, requirements)).resolves.toMatchObject({
        success: false,
        errorReason: voucherSignatureError,
        transaction: "",
      });
      expect(signer.writeContract).not.toHaveBeenCalled();
    },
  );

  it("lets the contract check the signature when a claim has no explicit payer authorizer", async () => {
    const { facilitator, payload, requirements, signer } = setup("batch-settlement", {
      type: "claim",
      claims: [
        {
          ...claim,
          voucher: {
            ...claim.voucher,
            channel: { ...channelConfig, payerAuthorizer: `0x${"00".repeat(20)}` },
          },
        },
      ],
      claimAuthorizerSignature: signature,
    });
    await expect(facilitator.settle(payload, requirements)).resolves.toMatchObject({
      success: true,
    });
    expect(signer.writeContract).toHaveBeenCalledOnce();
  });

  it("identifies the missing GasFree field in both responses", async () => {
    const { facilitator, payload, requirements } = setup("exact_gasfree", {
      signature,
      gasfreeAddress: payer,
      gasfree: { ...gasfree, receiver: undefined },
    });
    await expect(facilitator.verify(payload, requirements)).resolves.toMatchObject({
      invalidReason: gasfreeReason,
      invalidMessage: expect.stringContaining("gasfree.receiver"),
    });
    await expect(facilitator.settle(payload, requirements)).resolves.toMatchObject({
      errorReason: gasfreeReason,
      errorMessage: expect.stringContaining("gasfree.receiver"),
    });
  });

  it("rejects batch vouchers when the signer cannot decode the signature", async () => {
    const { facilitator, payload, requirements, signer } = setup("batch-settlement", {
      type: "voucher",
      channelConfig,
      voucher: { ...voucher, signature: "0x" },
    });
    signer.verifyTypedData.mockRejectedValue(new Error("invalid signature length"));
    await expect(facilitator.verify(payload, requirements)).resolves.toMatchObject({
      isValid: false,
      invalidReason: "invalid_batch_settlement_tron_voucher_signature",
    });
    expect(signer.readContract).not.toHaveBeenCalled();
  });

  it("rejects batch EIP-3009 deposits when the signer cannot decode the signature", async () => {
    const { facilitator, payload, requirements, signer } = setup(
      "batch-settlement",
      {
        type: "deposit",
        channelConfig,
        voucher,
        deposit: {
          amount: "100",
          authorization: {
            erc3009Authorization: {
              validAfter: "0",
              validBefore: deadline,
              salt: channelConfig.salt,
              signature: "0x",
            },
          },
        },
      },
      {
        extra: {
          receiverAuthorizer: receiver,
          assetTransferMethod: "eip3009",
          name: "Example",
          version: "1",
        },
      },
    );
    signer.verifyTypedData.mockRejectedValue(new Error("invalid signature length"));
    const reason = "invalid_batch_settlement_tron_receive_authorization_signature";
    await expect(facilitator.verify(payload, requirements)).resolves.toMatchObject({
      isValid: false,
      invalidReason: reason,
    });
    await expect(facilitator.settle(payload, requirements)).resolves.toMatchObject({
      success: false,
      errorReason: reason,
      transaction: "",
    });
    expect(signer.writeContract).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from "vitest";
import { TronWeb, utils as tronUtils } from "tronweb";
import {
  PERMIT2_ADDRESSES,
  X402_PERMIT2_PROXY_ADDRESSES,
  X402_UPTO_PERMIT2_PROXY_ADDRESSES,
} from "../../src/constants";
import {
  decodeSignedTrc20Approval,
  validateTrc20ApprovalForPayment,
} from "../../src/shared/trc20approval";
import {
  TRC20_APPROVAL_MAX_AMOUNT,
  type Trc20ApprovalResourceSponsoringInfo,
} from "../../src/shared/extensions/trc20ApprovalContract";
import { ExactTronScheme } from "../../src/exact/facilitator/scheme";
import type { FacilitatorTronSigner } from "../../src/signer";
import { normalizeAddressForSigning } from "../../src/utils";
import { UptoTronScheme as UptoFacilitator } from "../../src/upto/facilitator/scheme";
import { BatchSettlementTronScheme as BatchFacilitator } from "../../src/batch-settlement/facilitator/scheme";
import { computeChannelId } from "../../src/shared/batch-settlement/utils";
import { PERMIT2_DEPOSIT_COLLECTOR_ADDRESSES } from "../../src/shared/batch-settlement/constants";

const NETWORK = "tron:0xcd8690dc";
const PRIVATE_KEY = "4f3edf983ac63ad7c24ee152a7494471b2a18551b7117f7f7f3f2c47c8f6e5ad";
const PAYER = TronWeb.address.fromPrivateKey(PRIVATE_KEY);
const TOKEN = "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf";
const PERMIT2 = PERMIT2_ADDRESSES[NETWORK]!;

function concat(...chunks: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function varint(input: bigint): Uint8Array {
  const bytes: number[] = [];
  for (let value = input; ; value >>= 7n) {
    const byte = Number(value & 0x7fn);
    bytes.push(value < 0x80n ? byte : byte | 0x80);
    if (value < 0x80n) return Uint8Array.from(bytes);
  }
}

function bytesField(number: number, value: Uint8Array): Uint8Array {
  return concat(varint(BigInt((number << 3) | 2)), varint(BigInt(value.length)), value);
}

function uintField(number: number, value: bigint): Uint8Array {
  return concat(varint(BigInt(number << 3)), varint(value));
}

function hexBytes(hex: string): Uint8Array {
  return Uint8Array.from(tronUtils.code.hexStr2byteArray(hex));
}

function addressBytes(address: string): Uint8Array {
  return hexBytes(TronWeb.address.toHex(address));
}

function buildSignedApproval(
  options: {
    owner?: string;
    asset?: string;
    spender?: string;
    amountHex?: string;
    timestamp?: number;
    expiration?: number;
    extraRawField?: Uint8Array;
    tronRecoveryByte?: boolean;
  } = {},
): string {
  const now = options.timestamp ?? Date.now();
  const owner = options.owner ?? PAYER;
  const spenderHex = TronWeb.address.toHex(options.spender ?? PERMIT2).slice(2);
  const calldata = hexBytes(
    `095ea7b3${"0".repeat(24)}${spenderHex}${options.amountHex ?? "f".repeat(64)}`,
  );
  const trigger = concat(
    bytesField(1, addressBytes(owner)),
    bytesField(2, addressBytes(options.asset ?? TOKEN)),
    bytesField(4, calldata),
  );
  const any = concat(
    bytesField(1, new TextEncoder().encode("type.googleapis.com/protocol.TriggerSmartContract")),
    bytesField(2, trigger),
  );
  const contract = concat(uintField(1, 31n), bytesField(2, any));
  const rawData = concat(
    bytesField(1, hexBytes("1234")),
    bytesField(4, hexBytes("0102030405060708")),
    uintField(8, BigInt(options.expiration ?? now + 120_000)),
    bytesField(11, contract),
    uintField(14, BigInt(now)),
    uintField(18, 100_000_000n),
    options.extraRawField ?? new Uint8Array(),
  );
  const txID = Uint8Array.from(tronUtils.crypto.SHA256(rawData));
  const signature = hexBytes(tronUtils.crypto.ECKeySign(txID, hexBytes(PRIVATE_KEY)));
  if (options.tronRecoveryByte && signature[64] >= 27) signature[64] -= 27;
  return tronUtils.code
    .byteArray2hexStr(concat(bytesField(1, rawData), bytesField(2, signature)))
    .toLowerCase();
}

function info(signedTransaction: string): Trc20ApprovalResourceSponsoringInfo {
  return {
    from: PAYER,
    asset: TOKEN,
    spender: PERMIT2,
    amount: TRC20_APPROVAL_MAX_AMOUNT,
    signedTransaction,
    version: "1",
  };
}

const requirements = {
  scheme: "exact",
  network: NETWORK,
  asset: TOKEN,
  amount: "1000000",
  payTo: PAYER,
  maxTimeoutSeconds: 600,
  extra: { assetTransferMethod: "permit2" },
};

describe("TRC-20 Approval Resource Sponsoring validator", () => {
  it("decodes and validates a canonical signed Approval", () => {
    const signed = buildSignedApproval();
    const decoded = decodeSignedTrc20Approval(signed);
    const result = validateTrc20ApprovalForPayment(info(signed), PAYER, requirements as never);

    expect(decoded.owner).toBe(PAYER);
    expect(decoded.asset).toBe(TOKEN);
    expect(decoded.spender).toBe(PERMIT2);
    expect(decoded.amount).toBe(TRC20_APPROVAL_MAX_AMOUNT);
    expect(decoded.approvalTxID).toMatch(/^[0-9a-f]{64}$/);
    expect(result.isValid).toBe(true);
  });

  it("accepts the 0/1 recovery byte used by TRON transaction broadcasts", () => {
    const signed = buildSignedApproval({ tronRecoveryByte: true });
    expect(
      validateTrc20ApprovalForPayment(info(signed), PAYER, requirements as never),
    ).toMatchObject({ isValid: true });
  });

  it("rejects an Approval for a different spender", () => {
    const signed = buildSignedApproval({ spender: PAYER });
    const result = validateTrc20ApprovalForPayment(info(signed), PAYER, requirements as never);
    expect(result).toMatchObject({ isValid: false });
  });

  it("rejects an Approval amount other than MaxUint256", () => {
    const signed = buildSignedApproval({ amountHex: "0".repeat(63) + "1" });
    const result = validateTrc20ApprovalForPayment(info(signed), PAYER, requirements as never);
    expect(result).toMatchObject({ isValid: false });
  });

  it("rejects expired signed bytes", () => {
    const timestamp = Date.now() - 180_000;
    const signed = buildSignedApproval({ timestamp, expiration: timestamp + 60_000 });
    const result = validateTrc20ApprovalForPayment(info(signed), PAYER, requirements as never);
    expect(result).toMatchObject({ isValid: false });
  });

  it("rejects unknown protobuf fields", () => {
    const signed = buildSignedApproval({ extraRawField: uintField(20, 1n) });
    expect(() => decodeSignedTrc20Approval(signed)).toThrow("unsupported protobuf field 20");
  });
});

function sponsoredPayment(signedTransaction: string) {
  return {
    x402Version: 2,
    accepted: requirements,
    payload: {
      signature: "0xpermit2-signature",
      permit2Authorization: {
        from: PAYER,
        permitted: { token: TOKEN, amount: requirements.amount },
        spender: normalizeAddressForSigning(X402_PERMIT2_PROXY_ADDRESSES[NETWORK]),
        nonce: "1",
        deadline: String(Math.floor(Date.now() / 1000) + 600),
        witness: { to: PAYER, validAfter: "0" },
      },
    },
    extensions: {
      trc20ApprovalResourceSponsoring: { info: info(signedTransaction) },
    },
  };
}

describe("TRC-20 Approval Resource Sponsoring facilitator integration", () => {
  it("rejects exact Permit2 when the Server selected EIP-3009", async () => {
    const signer: FacilitatorTronSigner = {
      getAddresses: () => [PAYER],
      verifyTypedData: vi.fn(async () => true),
      readContract: vi.fn(),
      writeContract: vi.fn(),
      waitForTransactionReceipt: vi.fn(),
    };
    const eip3009Requirements = {
      ...requirements,
      extra: { assetTransferMethod: "eip3009" },
    };
    const payload = {
      ...sponsoredPayment(buildSignedApproval()),
      accepted: eip3009Requirements,
    };
    const scheme = new ExactTronScheme(signer);

    const verified = await scheme.verify(payload as never, eip3009Requirements as never);
    const settled = await scheme.settle(payload as never, eip3009Requirements as never);

    expect(verified).toMatchObject({
      isValid: false,
      invalidReason: "invalid_exact_tron_asset_transfer_method",
    });
    expect(settled).toMatchObject({
      success: false,
      transaction: "",
      errorReason: "invalid_exact_tron_asset_transfer_method",
    });
    expect(signer.verifyTypedData).not.toHaveBeenCalled();
    expect(signer.writeContract).not.toHaveBeenCalled();
  });

  it("rejects the Approval sponsorship extension on exact EIP-3009", async () => {
    const signer: FacilitatorTronSigner = {
      getAddresses: () => [PAYER],
      verifyTypedData: vi.fn(),
      readContract: vi.fn(),
      writeContract: vi.fn(),
      waitForTransactionReceipt: vi.fn(),
    };
    const payload = {
      x402Version: 2,
      accepted: requirements,
      payload: {},
      extensions: {
        trc20ApprovalResourceSponsoring: { info: info(buildSignedApproval()) },
      },
    };

    const scheme = new ExactTronScheme(signer);
    const verified = await scheme.verify(payload as never, requirements as never);
    const settled = await scheme.settle(payload as never, requirements as never);

    expect(verified).toMatchObject({
      isValid: false,
      invalidReason: "approval_extension_invalid",
    });
    expect(settled).toMatchObject({
      success: false,
      transaction: "",
      errorReason: "approval_extension_invalid",
    });
    expect(signer.verifyTypedData).not.toHaveBeenCalled();
    expect(signer.writeContract).not.toHaveBeenCalled();
  });

  it("uses read-only runtime verification and executes sponsorship before settlement", async () => {
    const calls: string[] = [];
    const runtime = {
      verify: vi.fn(async () => {
        calls.push("verify-sponsor");
        return { isValid: true };
      }),
      sponsor: vi.fn(async (_request, options) => {
        calls.push("sponsor");
        const revalidation = await options?.revalidate?.();
        calls.push("revalidate");
        expect(revalidation?.isValid).toBe(true);
        return { success: true, approvalTransaction: "approval-tx" };
      }),
    };
    const signer: FacilitatorTronSigner = {
      getAddresses: () => [PAYER],
      verifyTypedData: vi.fn(async () => true),
      readContract: vi.fn(async () => 2_000_000n),
      writeContract: vi.fn(async () => {
        calls.push("settlement");
        return "settlement-tx";
      }),
      waitForTransactionReceipt: vi.fn(async () => ({ status: "success" })),
    };
    const context = {
      getExtension: vi.fn(() => ({
        key: "trc20ApprovalResourceSponsoring",
        runtime,
      })),
    };
    const signed = buildSignedApproval();
    const payload = sponsoredPayment(signed);
    const scheme = new ExactTronScheme(signer);

    const verified = await scheme.verify(payload as never, requirements as never, context);
    expect(verified.isValid).toBe(true);
    expect(runtime.verify).toHaveBeenCalledTimes(1);
    expect(runtime.sponsor).not.toHaveBeenCalled();

    calls.length = 0;
    const settled = await scheme.settle(payload as never, requirements as never, context);
    expect(settled).toMatchObject({ success: true, transaction: "settlement-tx" });
    expect(calls).toEqual(["verify-sponsor", "sponsor", "revalidate", "settlement"]);
  });

  it("keeps the settlement transaction empty when sponsorship fails before Approval broadcast", async () => {
    const runtime = {
      verify: vi.fn(async () => ({ isValid: true })),
      sponsor: vi.fn(async () => ({
        success: false,
        approvalTransaction: "unbroadcast-approval-id",
        errorReason: "delegate_failed",
      })),
    };
    const signer: FacilitatorTronSigner = {
      getAddresses: () => [PAYER],
      verifyTypedData: vi.fn(async () => true),
      readContract: vi.fn(async () => 2_000_000n),
      writeContract: vi.fn(),
      waitForTransactionReceipt: vi.fn(),
    };
    const context = {
      getExtension: vi.fn(() => ({
        key: "trc20ApprovalResourceSponsoring",
        runtime,
      })),
    };

    const settled = await new ExactTronScheme(signer).settle(
      sponsoredPayment(buildSignedApproval()) as never,
      requirements as never,
      context,
    );

    expect(settled).toMatchObject({
      success: false,
      transaction: "",
      errorReason: "delegate_failed",
    });
    expect(signer.writeContract).not.toHaveBeenCalled();
  });

  it("fails closed before sponsorship when the runtime is not registered", async () => {
    const signer: FacilitatorTronSigner = {
      getAddresses: () => [PAYER],
      verifyTypedData: vi.fn(async () => true),
      readContract: vi.fn(async () => 2_000_000n),
      writeContract: vi.fn(),
      waitForTransactionReceipt: vi.fn(),
    };
    const payload = sponsoredPayment(buildSignedApproval());
    const result = await new ExactTronScheme(signer).verify(
      payload as never,
      requirements as never,
      { getExtension: () => undefined },
    );

    expect(result).toMatchObject({
      isValid: false,
      invalidReason: "sponsor_runtime_unavailable",
    });
    expect(signer.writeContract).not.toHaveBeenCalled();
  });

  it("fails closed when unsponsored allowance or balance reads fail", async () => {
    const signer: FacilitatorTronSigner = {
      getAddresses: () => [PAYER],
      verifyTypedData: vi.fn(async () => true),
      readContract: vi.fn(async () => {
        throw new Error("RPC unavailable");
      }),
      writeContract: vi.fn(),
      waitForTransactionReceipt: vi.fn(),
    };
    const payload = {
      ...sponsoredPayment(buildSignedApproval()),
      extensions: undefined,
    };
    const result = await new ExactTronScheme(signer).verify(
      payload as never,
      requirements as never,
    );

    expect(result).toMatchObject({
      isValid: false,
      invalidReason: "chain_read_failed",
      invalidMessage: "TRON contract read failed",
    });
    expect(result.invalidMessage).not.toContain("RPC unavailable");
    expect(signer.writeContract).not.toHaveBeenCalled();
  });

  it("sponsors an upto maximum before a positive settlement and skips sponsorship for zero", async () => {
    const calls: string[] = [];
    const runtime = {
      verify: vi.fn(async request => {
        calls.push("verify-sponsor");
        expect(request.requiredAllowance).toBe("1000000");
        return { isValid: true };
      }),
      sponsor: vi.fn(async (_request, options) => {
        calls.push("sponsor");
        const revalidation = await options?.revalidate?.();
        calls.push("revalidate");
        expect(revalidation?.isValid).toBe(true);
        return { success: true };
      }),
    };
    const signer: FacilitatorTronSigner = {
      getAddresses: () => [PAYER],
      verifyTypedData: vi.fn(async () => true),
      readContract: vi.fn(async args => {
        if (args.functionName === "balanceOf") return 2_000_000n;
        throw new Error(`unexpected read ${args.functionName}`);
      }),
      writeContract: vi.fn(async () => {
        calls.push("settlement");
        return "upto-settlement";
      }),
      waitForTransactionReceipt: vi.fn(async () => ({ status: "success" })),
    };
    const uptoRequirements = {
      ...requirements,
      scheme: "upto",
      extra: { permit2FacilitatorAddress: PAYER, assetTransferMethod: "permit2" },
    };
    const payment = {
      x402Version: 2,
      accepted: uptoRequirements,
      payload: {
        signature: "0xpermit2-signature",
        permit2Authorization: {
          from: PAYER,
          permitted: { token: TOKEN, amount: "1000000" },
          spender: normalizeAddressForSigning(X402_UPTO_PERMIT2_PROXY_ADDRESSES[NETWORK]),
          nonce: "1",
          deadline: String(Math.floor(Date.now() / 1000) + 600),
          witness: { to: PAYER, facilitator: PAYER, validAfter: "0" },
        },
      },
      extensions: {
        trc20ApprovalResourceSponsoring: { info: info(buildSignedApproval()) },
      },
    };
    const context = {
      getExtension: vi.fn(() => ({ key: "trc20ApprovalResourceSponsoring", runtime })),
    };
    const scheme = new UptoFacilitator(signer);

    const zero = await scheme.settle(
      payment as never,
      { ...uptoRequirements, amount: "0" } as never,
      context,
    );
    expect(zero).toMatchObject({ success: true, amount: "0", transaction: "" });
    expect(runtime.sponsor).not.toHaveBeenCalled();
    expect(signer.writeContract).not.toHaveBeenCalled();

    calls.length = 0;
    const settled = await scheme.settle(
      payment as never,
      { ...uptoRequirements, amount: "400000" } as never,
      context,
    );
    expect(settled).toMatchObject({ success: true, amount: "400000" });
    expect(calls).toEqual(["verify-sponsor", "sponsor", "revalidate", "settlement"]);
  });

  it("sponsors the batch deposit amount before submitting the channel deposit", async () => {
    const calls: string[] = [];
    let channelBalance = 0n;
    const runtime = {
      verify: vi.fn(async request => {
        calls.push("verify-sponsor");
        expect(request.requiredAllowance).toBe("5000");
        return { isValid: true };
      }),
      sponsor: vi.fn(async (_request, options) => {
        calls.push("sponsor");
        const revalidation = await options?.revalidate?.();
        calls.push("revalidate");
        expect(revalidation?.isValid).toBe(true);
        return { success: true };
      }),
    };
    const signer: FacilitatorTronSigner = {
      getAddresses: () => [PAYER],
      verifyTypedData: vi.fn(async () => true),
      readContract: vi.fn(async args => {
        if (args.functionName === "balanceOf") return 10_000n;
        if (args.functionName === "channels") return [channelBalance, 0n];
        if (args.functionName === "pendingWithdrawals") return [0n, 0n];
        if (args.functionName === "refundNonce") return 0n;
        throw new Error(`unexpected read ${args.functionName}`);
      }),
      writeContract: vi.fn(async () => {
        calls.push("deposit");
        channelBalance = 5_000n;
        return "deposit-tx";
      }),
      waitForTransactionReceipt: vi.fn(async () => ({ status: "success" })),
    };
    const config = {
      payer: normalizeAddressForSigning(PAYER),
      payerAuthorizer: normalizeAddressForSigning(PAYER),
      receiver: normalizeAddressForSigning(PAYER),
      receiverAuthorizer: normalizeAddressForSigning(PAYER),
      token: normalizeAddressForSigning(TOKEN),
      withdrawDelay: 900,
      salt: `0x${"00".repeat(32)}`,
    };
    const batchRequirements = {
      ...requirements,
      scheme: "batch-settlement",
      amount: "1000",
      extra: {
        receiverAuthorizer: PAYER,
        withdrawDelay: 900,
        assetTransferMethod: "permit2",
      },
    };
    const channelId = computeChannelId(config as never, NETWORK);
    const payment = {
      x402Version: 2,
      accepted: batchRequirements,
      payload: {
        type: "deposit",
        channelConfig: config,
        voucher: {
          channelId,
          maxClaimableAmount: "1000",
          signature: `0x${"22".repeat(65)}`,
        },
        deposit: {
          amount: "5000",
          authorization: {
            permit2Authorization: {
              from: normalizeAddressForSigning(PAYER),
              permitted: { token: normalizeAddressForSigning(TOKEN), amount: "5000" },
              spender: normalizeAddressForSigning(PERMIT2_DEPOSIT_COLLECTOR_ADDRESSES[NETWORK]),
              nonce: "1",
              deadline: String(Math.floor(Date.now() / 1000) + 600),
              witness: { channelId },
              signature: `0x${"11".repeat(65)}`,
            },
          },
        },
      },
      extensions: {
        trc20ApprovalResourceSponsoring: { info: info(buildSignedApproval()) },
      },
    };
    const context = {
      getExtension: vi.fn(() => ({ key: "trc20ApprovalResourceSponsoring", runtime })),
    };

    const settled = await new BatchFacilitator(signer).settle(
      payment as never,
      batchRequirements as never,
      context,
    );

    expect(settled, JSON.stringify({ settled, calls })).toMatchObject({
      success: true,
      transaction: "deposit-tx",
      amount: "5000",
    });
    expect(calls).toEqual(["verify-sponsor", "sponsor", "revalidate", "deposit"]);
  });
});

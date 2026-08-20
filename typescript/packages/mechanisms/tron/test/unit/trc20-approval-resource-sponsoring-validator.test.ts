import { describe, expect, it, vi } from "vitest";
import { TronWeb, utils as tronUtils } from "tronweb";
import { PERMIT2_ADDRESSES, X402_PERMIT2_PROXY_ADDRESSES } from "../../src/constants";
import {
  decodeSignedTrc20Approval,
  validateTrc20ApprovalForPayment,
} from "../../src/exact/facilitator/trc20approval";
import {
  TRC20_APPROVAL_MAX_AMOUNT,
  type Trc20ApprovalResourceSponsoringInfo,
} from "../../src/exact/extensions";
import { ExactTronScheme } from "../../src/exact/facilitator/scheme";
import type { FacilitatorTronSigner } from "../../src/signer";
import { normalizeAddressForSigning } from "../../src/utils";

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
  it("uses read-only runtime verification and executes sponsorship before settlement", async () => {
    const calls: string[] = [];
    const runtime = {
      verify: vi.fn(async () => {
        calls.push("verify-sponsor");
        return { isValid: true };
      }),
      sponsor: vi.fn(async () => {
        calls.push("sponsor");
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
    expect(calls).toEqual(["verify-sponsor", "sponsor", "settlement"]);
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
});

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  TRC20_APPROVAL_GAS_SPONSORING,
  type Trc20ApprovalGasSponsoringFacilitatorExtension,
} from "@bankofai/x402-extensions";
import { ExactTronScheme } from "../../../src/exact/facilitator/scheme";
import * as errors from "../../../src/exact/facilitator/errors";
import type { FacilitatorTronSigner } from "../../../src/signer";
import { PaymentPayload, PaymentRequirements } from "@bankofai/x402-core/types";
import { ExactEIP3009Payload, ExactPermit2Payload } from "../../../src/types";
import { X402_PERMIT2_PROXY_ADDRESSES, PERMIT2_ADDRESSES } from "../../../src/constants";
import { evmAddressToTron, normalizeAddressForSigning } from "../../../src/utils";

describe("ExactTronScheme (Facilitator)", () => {
  let facilitator: ExactTronScheme;
  let mockSigner: FacilitatorTronSigner;

  const now = Math.floor(Date.now() / 1000);
  const facilitatorBase58 = "TSForFRqxmZdJ6Yfx2rNaFykhuQLc9cTMR";
  const facilitatorAddress = normalizeAddressForSigning(facilitatorBase58);

  const buyerAddress = "0x1234567890123456789012345678901234567890" as `0x${string}`;
  const payToAddress = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd" as `0x${string}`;
  const tokenAddress = "0x5678567856785678567856785678567856785678" as `0x${string}`;
  const buyerBase58 = evmAddressToTron(buyerAddress);
  const tokenBase58 = evmAddressToTron(tokenAddress);
  const permit2Base58 = PERMIT2_ADDRESSES["tron:nile"]!;

  // --- TIP-712 test data ---
  const mockTIP712Payload: ExactEIP3009Payload = {
    signature: ("0x" + "ab".repeat(32) + "cd".repeat(32) + "1b") as `0x${string}`,
    authorization: {
      from: buyerAddress,
      to: payToAddress,
      value: "1000000",
      validAfter: (now - 600).toString(),
      validBefore: (now + 300).toString(),
      nonce: ("0x" + "aa".repeat(32)) as `0x${string}`,
    },
  };

  const mockTIP712PaymentPayload: PaymentPayload = {
    x402Version: 2,
    payload: mockTIP712Payload,
    accepted: { scheme: "exact", network: "tron:nile" },
  };

  const mockTIP712Requirements: PaymentRequirements = {
    scheme: "exact",
    network: "tron:nile",
    amount: "1000000",
    asset: tokenAddress,
    payTo: payToAddress,
    maxTimeoutSeconds: 300,
    extra: { name: "Tether USD", version: "1" },
  };

  // --- Permit2 test data ---
  const proxyAddress = normalizeAddressForSigning(X402_PERMIT2_PROXY_ADDRESSES["tron:nile"]!);

  const mockPermit2Payload: ExactPermit2Payload = {
    signature: ("0x" + "ab".repeat(32) + "cd".repeat(32) + "1b") as `0x${string}`,
    permit2Authorization: {
      from: buyerAddress,
      permitted: { token: tokenAddress, amount: "1000000" },
      spender: proxyAddress,
      nonce: ("0x" + "aa".repeat(32)) as `0x${string}`,
      deadline: (now + 300).toString(),
      witness: {
        to: payToAddress,
        facilitator: facilitatorAddress,
        validAfter: (now - 600).toString(),
      },
    },
  };

  const mockPermit2PaymentPayload: PaymentPayload = {
    x402Version: 2,
    payload: mockPermit2Payload,
    accepted: { scheme: "exact", network: "tron:nile" },
  };

  const mockPermit2Requirements: PaymentRequirements = {
    scheme: "exact",
    network: "tron:nile",
    amount: "1000000",
    asset: tokenAddress,
    payTo: payToAddress,
    maxTimeoutSeconds: 300,
    extra: {
      assetTransferMethod: "permit2",
      permit2FacilitatorAddress: facilitatorBase58,
    },
  };

  beforeEach(() => {
    mockSigner = {
      getAddresses: vi.fn().mockReturnValue([facilitatorBase58]),
      readContract: vi.fn().mockResolvedValue(BigInt("10000000")),
      verifyTypedData: vi.fn().mockResolvedValue(true),
      writeContract: vi.fn().mockResolvedValue("tx_hash_123"),
      waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: "success" }),
      sendRawTransaction: vi.fn().mockResolvedValue("approval_tx_hash_123"),
      getSignWeight: vi.fn().mockResolvedValue({ result: { result: true } }),
    };
    facilitator = new ExactTronScheme(mockSigner);
  });

  function createApprovalExtensionContext(): {
    getExtension: (key: string) => Trc20ApprovalGasSponsoringFacilitatorExtension | undefined;
  } {
    return {
      getExtension: (key: string) =>
        key === TRC20_APPROVAL_GAS_SPONSORING.key
          ? {
              key: TRC20_APPROVAL_GAS_SPONSORING.key,
              signer: mockSigner as NonNullable<
                Trc20ApprovalGasSponsoringFacilitatorExtension["signer"]
              >,
            }
          : undefined,
    };
  }

  function createApprovalExtensionPayload(): PaymentPayload {
    const permit2Hex = normalizeAddressForSigning(permit2Base58).slice(2);
    const spenderWord = permit2Hex.padStart(64, "0");
    const amountWord = "f".repeat(64);

    return {
      ...mockPermit2PaymentPayload,
      extensions: {
        [TRC20_APPROVAL_GAS_SPONSORING.key]: {
          info: {
            from: buyerBase58,
            asset: tokenBase58,
            spender: permit2Base58,
            amount: BigInt(
              "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
            ).toString(),
            signedTransaction: {
              raw_data: {
                contract: [
                  {
                    parameter: {
                      value: {
                        owner_address: `41${buyerAddress.slice(2)}`,
                        contract_address: `41${tokenAddress.slice(2)}`,
                        data: `095ea7b3${spenderWord}${amountWord}`,
                      },
                    },
                  },
                ],
              },
              raw_data_hex: "abcd",
              signature: ["11".repeat(65)],
            },
            version: "1",
          },
        },
      },
    };
  }

  describe("Construction", () => {
    it("should create instance with correct scheme and caipFamily", () => {
      expect(facilitator.scheme).toBe("exact");
      expect(facilitator.caipFamily).toBe("tron:*");
    });
  });

  describe("getSigners", () => {
    it("should return signer addresses", () => {
      const signers = facilitator.getSigners("tron:nile");
      expect(signers).toEqual([facilitatorBase58]);
    });
  });

  describe("getExtra", () => {
    it("should return supportedAssetTransferMethods including eip3009", () => {
      const extra = facilitator.getExtra("tron:nile");
      expect(extra).toBeDefined();
      expect(extra!.supportedAssetTransferMethods).toContain("eip3009");
    });

    it("should include permit2 when proxy address exists for network", () => {
      const extra = facilitator.getExtra("tron:nile");
      expect(extra!.supportedAssetTransferMethods).toContain("permit2");
      expect(extra!.permit2FacilitatorAddress).toBe(facilitatorBase58);
    });

    it("should not include permit2 for unknown network without proxy", () => {
      const extra = facilitator.getExtra("tron:unknown");
      const methods = extra!.supportedAssetTransferMethods as string[];
      expect(methods).toContain("eip3009");
      expect(methods).not.toContain("permit2");
    });
  });

  // --- TIP-712 verify ---
  describe("verify (TIP-712)", () => {
    it("should return valid for correct payload", async () => {
      const result = await facilitator.verify(mockTIP712PaymentPayload, mockTIP712Requirements);
      expect(result.isValid).toBe(true);
      expect(result.payer).toBe(buyerAddress);
    });

    it("should reject wrong scheme", async () => {
      const badPayload = {
        ...mockTIP712PaymentPayload,
        accepted: { scheme: "wrong", network: "tron:nile" },
      };
      const result = await facilitator.verify(badPayload, mockTIP712Requirements);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe(errors.INVALID_SCHEME);
    });

    it("should reject missing TIP-712 domain params", async () => {
      const badReqs = { ...mockTIP712Requirements, extra: {} };
      const result = await facilitator.verify(mockTIP712PaymentPayload, badReqs);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe(errors.MISSING_TIP712_DOMAIN);
    });

    it("should reject network mismatch", async () => {
      const badPayload = {
        ...mockTIP712PaymentPayload,
        accepted: { scheme: "exact", network: "tron:shasta" },
      };
      const result = await facilitator.verify(badPayload, mockTIP712Requirements);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe(errors.NETWORK_MISMATCH);
    });

    it("should reject invalid signature", async () => {
      (mockSigner.verifyTypedData as ReturnType<typeof vi.fn>).mockResolvedValue(false);
      const result = await facilitator.verify(mockTIP712PaymentPayload, mockTIP712Requirements);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe(errors.INVALID_SIGNATURE);
    });

    it("should reject value mismatch", async () => {
      const badReqs = { ...mockTIP712Requirements, amount: "2000000" };
      const result = await facilitator.verify(mockTIP712PaymentPayload, badReqs);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe(errors.VALUE_MISMATCH);
    });

    it("should reject insufficient funds", async () => {
      (mockSigner.readContract as ReturnType<typeof vi.fn>).mockResolvedValue(BigInt("100"));
      const result = await facilitator.verify(mockTIP712PaymentPayload, mockTIP712Requirements);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe(errors.INSUFFICIENT_FUNDS);
    });

    it("should continue when balance check fails", async () => {
      (mockSigner.readContract as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("rpc"));
      const result = await facilitator.verify(mockTIP712PaymentPayload, mockTIP712Requirements);
      expect(result.isValid).toBe(true);
    });
  });

  // --- TIP-712 settle ---
  describe("settle (TIP-712)", () => {
    it("should settle successfully", async () => {
      const result = await facilitator.settle(mockTIP712PaymentPayload, mockTIP712Requirements);
      expect(result.success).toBe(true);
      expect(result.transaction).toBe("tx_hash_123");
      expect(result.network).toBe("tron:nile");
    });

    it("should call writeContract with transferWithAuthorization", async () => {
      await facilitator.settle(mockTIP712PaymentPayload, mockTIP712Requirements);
      const callArgs = (mockSigner.writeContract as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(callArgs.functionName).toBe("transferWithAuthorization");
    });

    it("should fail when verification fails", async () => {
      (mockSigner.verifyTypedData as ReturnType<typeof vi.fn>).mockResolvedValue(false);
      const result = await facilitator.settle(mockTIP712PaymentPayload, mockTIP712Requirements);
      expect(result.success).toBe(false);
    });

    it("should fail when writeContract throws", async () => {
      (mockSigner.writeContract as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("tx fail"),
      );
      const result = await facilitator.settle(mockTIP712PaymentPayload, mockTIP712Requirements);
      expect(result.success).toBe(false);
      expect(result.errorReason).toBe(errors.TRANSACTION_FAILED);
    });
  });

  // --- Permit2 verify ---
  describe("verify (Permit2)", () => {
    it("should return valid for correct permit2 payload", async () => {
      const result = await facilitator.verify(mockPermit2PaymentPayload, mockPermit2Requirements);
      expect(result.isValid).toBe(true);
      expect(result.payer).toBe(buyerAddress);
    });

    it("should reject wrong scheme", async () => {
      const badPayload = {
        ...mockPermit2PaymentPayload,
        accepted: { scheme: "wrong", network: "tron:nile" },
      };
      const result = await facilitator.verify(badPayload, mockPermit2Requirements);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe(errors.INVALID_SCHEME);
    });

    it("should reject network mismatch", async () => {
      const badPayload = {
        ...mockPermit2PaymentPayload,
        accepted: { scheme: "exact", network: "tron:shasta" },
      };
      const result = await facilitator.verify(badPayload, mockPermit2Requirements);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe(errors.NETWORK_MISMATCH);
    });

    it("should reject missing permit2 address", async () => {
      const badReqs = { ...mockPermit2Requirements, network: "tron:unknown" };
      const badPayload = {
        ...mockPermit2PaymentPayload,
        accepted: { scheme: "exact", network: "tron:unknown" },
      };
      const result = await facilitator.verify(badPayload, badReqs);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe(errors.MISSING_PERMIT2_ADDRESS);
    });

    it("should reject wrong spender", async () => {
      const badPermit2 = {
        ...mockPermit2Payload,
        permit2Authorization: {
          ...mockPermit2Payload.permit2Authorization,
          spender: "0x0000000000000000000000000000000000000bad" as `0x${string}`,
        },
      };
      const badPayload = { ...mockPermit2PaymentPayload, payload: badPermit2 };
      const result = await facilitator.verify(badPayload, mockPermit2Requirements);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe(errors.INVALID_PERMIT2_SPENDER);
    });

    it("should reject recipient mismatch", async () => {
      const badPermit2 = {
        ...mockPermit2Payload,
        permit2Authorization: {
          ...mockPermit2Payload.permit2Authorization,
          witness: {
            ...mockPermit2Payload.permit2Authorization.witness,
            to: "0x0000000000000000000000000000000000000bad" as `0x${string}`,
          },
        },
      };
      const badPayload = { ...mockPermit2PaymentPayload, payload: badPermit2 };
      const result = await facilitator.verify(badPayload, mockPermit2Requirements);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe(errors.PERMIT2_RECIPIENT_MISMATCH);
    });

    it("should reject facilitator mismatch", async () => {
      const badPermit2 = {
        ...mockPermit2Payload,
        permit2Authorization: {
          ...mockPermit2Payload.permit2Authorization,
          witness: {
            ...mockPermit2Payload.permit2Authorization.witness,
            facilitator: "0x0000000000000000000000000000000000000bad" as `0x${string}`,
          },
        },
      };
      const badPayload = { ...mockPermit2PaymentPayload, payload: badPermit2 };
      const result = await facilitator.verify(badPayload, mockPermit2Requirements);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe(errors.INVALID_PERMIT2_FACILITATOR);
    });

    it("should reject expired deadline", async () => {
      const badPermit2 = {
        ...mockPermit2Payload,
        permit2Authorization: {
          ...mockPermit2Payload.permit2Authorization,
          deadline: (now - 100).toString(),
        },
      };
      const badPayload = { ...mockPermit2PaymentPayload, payload: badPermit2 };
      const result = await facilitator.verify(badPayload, mockPermit2Requirements);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe(errors.PERMIT2_DEADLINE_EXPIRED);
    });

    it("should reject amount mismatch", async () => {
      const badReqs = { ...mockPermit2Requirements, amount: "2000000" };
      const result = await facilitator.verify(mockPermit2PaymentPayload, badReqs);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe(errors.PERMIT2_AMOUNT_MISMATCH);
    });

    it("should reject invalid permit2 signature", async () => {
      (mockSigner.verifyTypedData as ReturnType<typeof vi.fn>).mockResolvedValue(false);
      const result = await facilitator.verify(mockPermit2PaymentPayload, mockPermit2Requirements);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe(errors.PERMIT2_INVALID_SIGNATURE);
    });

    it("should reject insufficient allowance", async () => {
      (mockSigner.readContract as ReturnType<typeof vi.fn>).mockResolvedValue(BigInt("100"));
      const result = await facilitator.verify(mockPermit2PaymentPayload, mockPermit2Requirements);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe(errors.PERMIT2_ALLOWANCE_REQUIRED);
    });

    it("should accept approval extension when allowance is insufficient", async () => {
      (mockSigner.readContract as ReturnType<typeof vi.fn>).mockImplementation(async args =>
        args.functionName === "allowance" ? BigInt(0) : BigInt("10000000"),
      );
      const result = await facilitator.verify(
        createApprovalExtensionPayload(),
        mockPermit2Requirements,
        createApprovalExtensionContext(),
      );
      expect(result.isValid).toBe(true);
      expect(mockSigner.getSignWeight).toHaveBeenCalled();
    });
  });

  // --- Permit2 settle ---
  describe("settle (Permit2)", () => {
    it("should settle successfully", async () => {
      const result = await facilitator.settle(mockPermit2PaymentPayload, mockPermit2Requirements);
      expect(result.success).toBe(true);
      expect(result.transaction).toBe("tx_hash_123");
    });

    it("should call writeContract with settle on proxy", async () => {
      await facilitator.settle(mockPermit2PaymentPayload, mockPermit2Requirements);
      const callArgs = (mockSigner.writeContract as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(callArgs.functionName).toBe("settle");
      expect(callArgs.address).toBe(X402_PERMIT2_PROXY_ADDRESSES["tron:nile"]);
      expect(Array.isArray(callArgs.args[0])).toBe(true);
      expect(Array.isArray(callArgs.args[0][0])).toBe(true);
      expect(Array.isArray(callArgs.args[2])).toBe(true);
      expect(callArgs.args[2][1]).toBe(facilitatorAddress);
    });

    it("should fail when verification fails", async () => {
      (mockSigner.verifyTypedData as ReturnType<typeof vi.fn>).mockResolvedValue(false);
      const result = await facilitator.settle(mockPermit2PaymentPayload, mockPermit2Requirements);
      expect(result.success).toBe(false);
    });

    it("should fail when writeContract throws", async () => {
      (mockSigner.writeContract as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("tx fail"),
      );
      const result = await facilitator.settle(mockPermit2PaymentPayload, mockPermit2Requirements);
      expect(result.success).toBe(false);
      expect(result.errorReason).toBe(errors.TRANSACTION_FAILED);
    });

    it("should broadcast approval then settle when allowance is insufficient and extension is present", async () => {
      (mockSigner.readContract as ReturnType<typeof vi.fn>).mockImplementation(async args =>
        args.functionName === "allowance" ? BigInt(0) : BigInt("10000000"),
      );

      const result = await facilitator.settle(
        createApprovalExtensionPayload(),
        mockPermit2Requirements,
        createApprovalExtensionContext(),
      );

      expect(result.success).toBe(true);
      expect(mockSigner.sendRawTransaction).toHaveBeenCalled();
      expect(mockSigner.writeContract).toHaveBeenCalled();
      expect(
        (mockSigner.sendRawTransaction as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0],
      ).toBeLessThan(
        (mockSigner.writeContract as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0],
      );
    });
  });
});

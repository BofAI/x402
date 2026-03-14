import { describe, it, expect, beforeEach, vi } from "vitest";
import { TRC20_APPROVAL_GAS_SPONSORING } from "@bankofai/x402-extensions";
import { ExactTronScheme } from "../../../src/exact/client/scheme";
import type { ClientTronSigner } from "../../../src/signer";
import { PaymentRequirements } from "@bankofai/x402-core/types";

describe("ExactTronScheme (Client)", () => {
  let mockSigner: ClientTronSigner;
  const facilitatorAddress = "TSForFRqxmZdJ6Yfx2rNaFykhuQLc9cTMR";

  const tip712Requirements: PaymentRequirements = {
    scheme: "exact",
    network: "tron:nile",
    amount: "1000000",
    asset: "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf",
    payTo: "TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs",
    maxTimeoutSeconds: 300,
    extra: { name: "Tether USD", version: "1" },
  };

  const permit2Requirements: PaymentRequirements = {
    scheme: "exact",
    network: "tron:nile",
    amount: "1000000",
    asset: "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf",
    payTo: "TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs",
    maxTimeoutSeconds: 300,
    extra: {
      assetTransferMethod: "permit2",
      permit2FacilitatorAddress: facilitatorAddress,
    },
  };

  beforeEach(() => {
    mockSigner = {
      address: "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf",
      signTypedData: vi.fn().mockResolvedValue("0x" + "ab".repeat(32) + "cd".repeat(32) + "1b"),
      readContract: vi.fn().mockResolvedValue(BigInt(0)),
      buildTriggerSmartContractTransaction: vi.fn().mockResolvedValue({
        raw_data: { contract: [{ parameter: { value: {} } }] },
        raw_data_hex: "abcd",
      }),
      signTransaction: vi.fn().mockResolvedValue({
        raw_data: { contract: [{ parameter: { value: {} } }] },
        raw_data_hex: "abcd",
        signature: ["11".repeat(65)],
      }),
    };
  });

  describe("Construction", () => {
    it("should create instance with correct scheme", () => {
      const client = new ExactTronScheme(mockSigner);
      expect(client.scheme).toBe("exact");
    });
  });

  describe("TIP-712 path (default)", () => {
    it("should create TIP-712 payload when no assetTransferMethod", async () => {
      const client = new ExactTronScheme(mockSigner);
      const result = await client.createPaymentPayload(2, tip712Requirements);

      expect(result.x402Version).toBe(2);
      expect(result.payload).toHaveProperty("authorization");
      expect(result.payload).not.toHaveProperty("permit2Authorization");
    });

    it("should create TIP-712 payload with eip3009 method", async () => {
      const reqs = {
        ...tip712Requirements,
        extra: { ...tip712Requirements.extra, assetTransferMethod: "eip3009" },
      };
      const client = new ExactTronScheme(mockSigner);
      const result = await client.createPaymentPayload(2, reqs);

      expect(result.payload).toHaveProperty("authorization");
    });

    it("should normalize addresses to EVM hex", async () => {
      const client = new ExactTronScheme(mockSigner);
      const result = await client.createPaymentPayload(2, tip712Requirements);
      const auth = (result.payload as any).authorization;

      expect(auth.from).toMatch(/^0x[0-9a-f]{40}$/);
      expect(auth.to).toMatch(/^0x[0-9a-f]{40}$/);
    });

    it("should set time bounds correctly", async () => {
      const client = new ExactTronScheme(mockSigner);
      const beforeTime = Math.floor(Date.now() / 1000);
      const result = await client.createPaymentPayload(2, tip712Requirements);
      const auth = (result.payload as any).authorization;

      const validAfter = parseInt(auth.validAfter);
      const validBefore = parseInt(auth.validBefore);

      expect(validAfter).toBeLessThanOrEqual(beforeTime - 600 + 1);
      expect(validBefore).toBeGreaterThanOrEqual(beforeTime + 300);
    });

    it("should generate unique nonces", async () => {
      const client = new ExactTronScheme(mockSigner);
      const r1 = await client.createPaymentPayload(2, tip712Requirements);
      const r2 = await client.createPaymentPayload(2, tip712Requirements);

      expect((r1.payload as any).authorization.nonce).not.toBe(
        (r2.payload as any).authorization.nonce,
      );
    });

    it("should call signTypedData with TransferWithAuthorization", async () => {
      const client = new ExactTronScheme(mockSigner);
      await client.createPaymentPayload(2, tip712Requirements);

      expect(mockSigner.signTypedData).toHaveBeenCalled();
      const callArgs = (mockSigner.signTypedData as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(callArgs.primaryType).toBe("TransferWithAuthorization");
      expect(callArgs.domain.name).toBe("Tether USD");
      expect(callArgs.domain.chainId).toBe(3448148188);
    });

    it("should throw when TIP-712 domain params are missing", async () => {
      const reqs = { ...tip712Requirements, extra: {} };
      const client = new ExactTronScheme(mockSigner);

      await expect(client.createPaymentPayload(2, reqs)).rejects.toThrow(
        "TIP-712 domain parameters",
      );
    });
  });

  describe("Permit2 path", () => {
    it("should create Permit2 payload when assetTransferMethod is permit2", async () => {
      const client = new ExactTronScheme(mockSigner);
      const result = await client.createPaymentPayload(2, permit2Requirements);

      expect(result.x402Version).toBe(2);
      expect(result.payload).toHaveProperty("permit2Authorization");
      expect(result.payload).not.toHaveProperty("authorization");
    });

    it("should set permit2 spender to proxy address", async () => {
      const client = new ExactTronScheme(mockSigner);
      const result = await client.createPaymentPayload(2, permit2Requirements);
      const auth = (result.payload as any).permit2Authorization;

      expect(auth.spender).toMatch(/^0x[0-9a-f]{40}$/);
    });

    it("should set permit2 witness.to to payTo address", async () => {
      const client = new ExactTronScheme(mockSigner);
      const result = await client.createPaymentPayload(2, permit2Requirements);
      const auth = (result.payload as any).permit2Authorization;

      expect(auth.witness.to).toMatch(/^0x[0-9a-f]{40}$/);
    });

    it("should set permit2 witness.facilitator from requirements extra", async () => {
      const client = new ExactTronScheme(mockSigner);
      const result = await client.createPaymentPayload(2, permit2Requirements);
      const auth = (result.payload as any).permit2Authorization;

      expect(auth.witness.facilitator).toMatch(/^0x[0-9a-f]{40}$/);
    });

    it("should call signTypedData with PermitWitnessTransferFrom", async () => {
      const client = new ExactTronScheme(mockSigner);
      await client.createPaymentPayload(2, permit2Requirements);

      const callArgs = (mockSigner.signTypedData as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(callArgs.primaryType).toBe("PermitWitnessTransferFrom");
      expect(callArgs.domain.name).toBe("Permit2");
      expect(callArgs.message.witness.facilitator).toMatch(/^0x[0-9a-f]{40}$/);
    });

    it("should throw for unknown network", async () => {
      const reqs = { ...permit2Requirements, network: "tron:unknown" };
      const client = new ExactTronScheme(mockSigner);

      await expect(client.createPaymentPayload(2, reqs)).rejects.toThrow();
    });

    it("should throw when permit2 facilitator address is missing", async () => {
      const reqs = {
        ...permit2Requirements,
        extra: { assetTransferMethod: "permit2" },
      };
      const client = new ExactTronScheme(mockSigner);

      await expect(client.createPaymentPayload(2, reqs)).rejects.toThrow(
        "Permit2 facilitator address is required",
      );
    });

    it("should attach TRC-20 approval extension when advertised and allowance is insufficient", async () => {
      const client = new ExactTronScheme(mockSigner);
      const result = await client.createPaymentPayload(2, permit2Requirements, {
        extensions: {
          [TRC20_APPROVAL_GAS_SPONSORING.key]: {
            info: { description: "approve", version: "1" },
          },
        },
      });

      expect(result.extensions).toBeDefined();
      expect(result.extensions?.[TRC20_APPROVAL_GAS_SPONSORING.key]).toBeDefined();
      expect(mockSigner.buildTriggerSmartContractTransaction).toHaveBeenCalled();
      expect(mockSigner.signTransaction).toHaveBeenCalled();
    });

    it("should skip TRC-20 approval extension when allowance is already sufficient", async () => {
      (mockSigner.readContract as ReturnType<typeof vi.fn>).mockResolvedValueOnce(BigInt("1000000"));
      const client = new ExactTronScheme(mockSigner);
      const result = await client.createPaymentPayload(2, permit2Requirements, {
        extensions: {
          [TRC20_APPROVAL_GAS_SPONSORING.key]: {
            info: { description: "approve", version: "1" },
          },
        },
      });

      expect(result.extensions).toBeUndefined();
      expect(mockSigner.buildTriggerSmartContractTransaction).not.toHaveBeenCalled();
      expect(mockSigner.signTransaction).not.toHaveBeenCalled();
    });
  });
});

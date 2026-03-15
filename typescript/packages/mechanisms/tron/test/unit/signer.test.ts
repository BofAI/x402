import { describe, expect, it, vi } from "vitest";
import {
  createClientTronSigner,
  toClientTronSigner,
  toFacilitatorTronSigner,
} from "../../src/signer";

describe("TRON signer helpers", () => {
  describe("toClientTronSigner", () => {
    it("returns a composed signer when signer already has readContract", async () => {
      const signer = {
        address: "TTestAddress11111111111111111111111111",
        signTypedData: vi.fn().mockResolvedValue("0xsignature"),
        readContract: vi.fn().mockResolvedValue("42"),
      };

      const result = toClientTronSigner(signer);
      expect(result.address).toBe(signer.address);
      await expect(
        result.readContract({
          address: "TContract111111111111111111111111111",
          abi: [],
          functionName: "balanceOf",
          args: [],
        }),
      ).resolves.toBe("42");
    });

    it("composes readContract from TronWeb when signer lacks it", async () => {
      const call = vi.fn().mockResolvedValue("99");
      const sendRawTransaction = vi.fn().mockResolvedValue({ result: true, txid: "0xtxid" });
      const tronWeb = {
        contract: vi.fn().mockResolvedValue({
          methods: {
            balanceOf: (..._args: unknown[]) => ({ call }),
          },
        }),
        trx: {
          sendRawTransaction,
          getTransactionInfo: vi.fn().mockResolvedValue({ receipt: { result: "SUCCESS" } }),
        },
      };

      const result = toClientTronSigner(
        {
          address: "TTestAddress11111111111111111111111111",
          signTypedData: vi.fn().mockResolvedValue("0xsignature"),
        },
        tronWeb as any,
      );

      await expect(
        result.readContract({
          address: "TContract111111111111111111111111111",
          abi: [],
          functionName: "balanceOf",
          args: ["owner"],
        }),
      ).resolves.toBe("99");
      expect(call).toHaveBeenCalled();
      await expect(
        result.sendRawTransaction?.({
          signedTransaction: { raw_data: {}, raw_data_hex: "00" } as any,
        }),
      ).resolves.toBe("0xtxid");
      await expect(result.waitForTransactionReceipt?.({ hash: "0xtxid" })).resolves.toEqual({
        status: "success",
      });
    });

    it("throws when neither signer nor TronWeb can read contracts", () => {
      expect(() =>
        toClientTronSigner({
          address: "TTestAddress11111111111111111111111111",
          signTypedData: vi.fn().mockResolvedValue("0xsignature"),
        }),
      ).toThrow(
        "toClientTronSigner requires either a signer with readContract or a TronWeb instance.",
      );
    });
  });

  describe("toFacilitatorTronSigner", () => {
    it("wraps a single address signer with getAddresses()", () => {
      const signer = {
        address: "TSForFRqxmZdJ6Yfx2rNaFykhuQLc9cTMR",
        readContract: vi.fn(),
        verifyTypedData: vi.fn(),
        writeContract: vi.fn(),
        waitForTransactionReceipt: vi.fn(),
      };

      const result = toFacilitatorTronSigner(signer);
      expect(result.getAddresses()).toEqual([signer.address]);
      expect(result.readContract).toBe(signer.readContract);
      expect(result.verifyTypedData).toBe(signer.verifyTypedData);
      expect(result.writeContract).toBe(signer.writeContract);
    });
  });

  describe("createClientTronSigner", () => {
    it("creates a TronWeb-backed client signer", async () => {
      const call = vi.fn().mockResolvedValue("100");
      const tronWeb = {
        defaultAddress: { base58: "TSForFRqxmZdJ6Yfx2rNaFykhuQLc9cTMR" },
        address: {
          fromPrivateKey: vi.fn().mockReturnValue("TSForFRqxmZdJ6Yfx2rNaFykhuQLc9cTMR"),
        },
        trx: {
          _signTypedData: vi.fn().mockResolvedValue("0xsignature"),
        },
        contract: vi.fn().mockResolvedValue({
          methods: {
            allowance: (..._args: unknown[]) => ({ call }),
          },
        }),
      };

      const signer = createClientTronSigner(tronWeb as any, "0xabc123");
      await expect(
        signer.signTypedData({
          domain: {},
          types: { Test: [] },
          primaryType: "Test",
          message: {},
        }),
      ).resolves.toBe("0xsignature");
      await expect(
        signer.readContract({
          address: "TContract111111111111111111111111111",
          abi: [],
          functionName: "allowance",
          args: [],
        }),
      ).resolves.toBe("100");
    });
  });
});

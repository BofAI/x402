import { describe, it, expect } from "vitest";
import { isPermit2Payload, isTIP712Payload } from "../../src/types";

describe("Type Guards", () => {
  const tip712Payload = {
    signature: "0x" + "ab".repeat(32) + "cd".repeat(32) + "1b",
    authorization: {
      from: "0x1234567890123456789012345678901234567890",
      to: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
      value: "1000000",
      validAfter: "0",
      validBefore: "9999999999",
      nonce: "0x" + "aa".repeat(32),
    },
  } as const;

  const permit2Payload = {
    signature: "0x" + "ab".repeat(32) + "cd".repeat(32) + "1b",
    permit2Authorization: {
      from: "0x1234567890123456789012345678901234567890",
      permitted: { token: "0x5678567856785678567856785678567856785678", amount: "1000000" },
      spender: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
      nonce: "0x" + "aa".repeat(32),
      deadline: "9999999999",
      witness: { to: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd", validAfter: "0" },
    },
  } as const;

  describe("isPermit2Payload", () => {
    it("should return true for permit2 payload", () => {
      expect(isPermit2Payload(permit2Payload)).toBe(true);
    });

    it("should return false for TIP-712 payload", () => {
      expect(isPermit2Payload(tip712Payload)).toBe(false);
    });
  });

  describe("isTIP712Payload", () => {
    it("should return true for TIP-712 payload", () => {
      expect(isTIP712Payload(tip712Payload)).toBe(true);
    });

    it("should return false for permit2 payload", () => {
      expect(isTIP712Payload(permit2Payload)).toBe(false);
    });
  });
});

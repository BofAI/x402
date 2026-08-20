import { describe, expect, it, vi } from "vitest";
import type { PaymentPayload } from "@bankofai/x402-core/types";
import {
  TRC20_APPROVAL_MAX_AMOUNT,
  TRC20_APPROVAL_RESOURCE_SPONSORING,
  createTrc20ApprovalResourceSponsoringExtension,
  declareTrc20ApprovalResourceSponsoringExtension,
  extractTrc20ApprovalResourceSponsoringInfo,
  resolveTrc20ApprovalResourceSponsoringRuntime,
  validateTrc20ApprovalResourceSponsoringInfo,
  type Trc20ApprovalResourceSponsoringInfo,
  type Trc20ApprovalResourceSponsoringRuntime,
} from "../src/trc20-approval-resource-sponsoring";

const validInfo: Trc20ApprovalResourceSponsoringInfo = {
  from: "TJRyWwFs9wTFGZg3JbrVriFbNfCug5tDeC",
  asset: "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf",
  spender: "TYQuuhGbEMxF7nZxUHV3uHJxAVVAegNU9h",
  amount: TRC20_APPROVAL_MAX_AMOUNT,
  signedTransaction: "0a02abcd",
  version: "1",
};

describe("TRC-20 Approval Resource Sponsoring Extension", () => {
  it("declares the canonical extension key and schema", () => {
    const declaration = declareTrc20ApprovalResourceSponsoringExtension();
    expect(TRC20_APPROVAL_RESOURCE_SPONSORING.key).toBe("trc20ApprovalResourceSponsoring");
    expect(declaration.trc20ApprovalResourceSponsoring.info).toMatchObject({ version: "1" });
    expect(declaration.trc20ApprovalResourceSponsoring.schema).toMatchObject({
      type: "object",
      required: ["from", "asset", "spender", "amount", "signedTransaction", "version"],
    });
  });

  it("extracts complete info from a payment payload", () => {
    const payload = {
      extensions: {
        trc20ApprovalResourceSponsoring: { info: validInfo, schema: {} },
      },
    } as unknown as PaymentPayload;
    expect(extractTrc20ApprovalResourceSponsoringInfo(payload)).toEqual(validInfo);
  });

  it("returns null for missing or declaration-only info", () => {
    expect(extractTrc20ApprovalResourceSponsoringInfo({} as PaymentPayload)).toBeNull();
    expect(
      extractTrc20ApprovalResourceSponsoringInfo({
        extensions: {
          trc20ApprovalResourceSponsoring: {
            info: { description: "test", version: "1" },
            schema: {},
          },
        },
      } as unknown as PaymentPayload),
    ).toBeNull();
  });

  it("validates the version 1 wire shape", () => {
    expect(validateTrc20ApprovalResourceSponsoringInfo(validInfo)).toBe(true);
    expect(
      validateTrc20ApprovalResourceSponsoringInfo({
        ...validInfo,
        amount: "1",
      }),
    ).toBe(false);
    expect(
      validateTrc20ApprovalResourceSponsoringInfo({
        ...validInfo,
        signedTransaction: "0xnot-tron-hex",
      }),
    ).toBe(false);
  });

  it("resolves a network runtime before the default runtime", () => {
    const defaultRuntime: Trc20ApprovalResourceSponsoringRuntime = {
      verify: vi.fn(async () => ({ isValid: true })),
      sponsor: vi.fn(async () => ({ success: true })),
    };
    const networkRuntime: Trc20ApprovalResourceSponsoringRuntime = {
      verify: vi.fn(async () => ({ isValid: true })),
      sponsor: vi.fn(async () => ({ success: true })),
    };
    const extension = createTrc20ApprovalResourceSponsoringExtension(defaultRuntime, network =>
      network === "tron:test" ? networkRuntime : undefined,
    );

    expect(resolveTrc20ApprovalResourceSponsoringRuntime(extension, "tron:test")).toBe(
      networkRuntime,
    );
    expect(resolveTrc20ApprovalResourceSponsoringRuntime(extension, "tron:other")).toBe(
      defaultRuntime,
    );
  });
});

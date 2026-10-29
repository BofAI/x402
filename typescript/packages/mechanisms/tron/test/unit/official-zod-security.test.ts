import { describe, expect, it } from "vitest";
import { PaymentRequiredV2Schema, ResourceInfoSchema } from "@x402/core/schemas";

describe("official Core collection validation", () => {
  const requirement = {
    scheme: "exact",
    network: "tron:3448148188",
    amount: "1",
    asset: "token",
    payTo: "recipient",
    maxTimeoutSeconds: 60,
    extra: { symbol: "USDT" },
  };

  it("rejects oversized resource tags with one size error", () => {
    const result = ResourceInfoSchema.safeParse({
      url: "https://test.invalid",
      tags: Array(1_000).fill(0),
    });
    expect(result.success).toBe(false);
    if (result.success) throw new Error("Oversized tags accepted");
    expect(result.error.issues).toHaveLength(1);
    expect(result.error.issues[0]).toMatchObject({ code: "too_big", path: ["tags"] });
  });

  it("rejects oversized payment options before parsing each invalid entry", () => {
    const result = PaymentRequiredV2Schema.safeParse({
      x402Version: 2,
      resource: { url: "https://test.invalid" },
      accepts: Array(1_025).fill(null),
    });
    expect(result.success).toBe(false);
    if (result.success) throw new Error("Oversized payment options accepted");
    expect(result.error.issues).toHaveLength(1);
    expect(result.error.issues[0]).toMatchObject({ code: "too_big", path: ["accepts"] });
  });

  it("preserves valid TRON payment options and extensible metadata", () => {
    const payment = {
      x402Version: 2,
      resource: { url: "https://test.invalid", tags: ["payments"] },
      accepts: [requirement],
    };
    expect(PaymentRequiredV2Schema.parse(payment)).toEqual(payment);
  });
});

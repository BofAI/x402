import { describe, expect, it } from "vitest";
import {
  Any,
  OptionalAny,
  PaymentRequiredV1Schema,
  PaymentRequiredV2Schema,
  ResourceInfoSchema,
  parsePaymentPayload,
  parsePaymentRequired,
  z,
} from "../../../src/schemas";

describe("native Zod collection limits", () => {
  it.each([
    [PaymentRequiredV1Schema, { x402Version: 1 }],
    [PaymentRequiredV2Schema, { x402Version: 2, resource: { url: "https://test.invalid" } }],
  ] as const)("bounds errors from oversized payment options", (schema, envelope) => {
    const requirement = {
      scheme: "exact",
      network: "tron:3448148188",
      amount: "1",
      maxAmountRequired: "1",
      resource: "https://test.invalid",
      description: "payments",
      asset: "token",
      payTo: "recipient",
      maxTimeoutSeconds: 60,
    };
    expect(schema.safeParse({ ...envelope, accepts: [requirement] }).success).toBe(true);
    expect(schema.safeParse({ ...envelope, accepts: Array(1_024).fill(requirement) }).success).toBe(
      true,
    );
    expect(schema.safeParse({ ...envelope, accepts: [] }).success).toBe(false);
    const result = schema.safeParse({ ...envelope, accepts: Array(1_025).fill(null) });
    expect(result.success).toBe(false);
    if (result.success) throw new Error("Oversized payment options accepted");
    expect(result.error.issues).toHaveLength(1);
    expect(result.error.issues[0]).toMatchObject({ code: "too_big", path: ["accepts"] });
  });

  for (const bound of ["max", "length"] as const) {
    for (const asyncParse of [false, true]) {
      it(`rejects oversized ${bound} input before element parsing (async=${asyncParse})`, async () => {
        let visits = 0;
        const schema = z
          .array(
            z.string().superRefine(() => {
              visits += 1;
            }),
          )
          [bound](2);
        const input = Array.from({ length: 32 }, () => "valid");
        const rejected = asyncParse ? await schema.safeParseAsync(input) : schema.safeParse(input);
        expect(rejected.success).toBe(false);
        expect(visits).toBe(0);
        const accepted = asyncParse
          ? await schema.safeParseAsync(["one", "two"])
          : schema.safeParse(["one", "two"]);
        expect(accepted.success).toBe(true);
        expect(visits).toBe(2);
      });
    }
  }

  it("bounds errors from oversized resource tags", () => {
    const result = ResourceInfoSchema.safeParse({
      url: "https://test.invalid",
      tags: Array(32).fill(0),
    });
    expect(result.success).toBe(false);
    if (result.success) throw new Error("Oversized resource tags accepted");
    expect(result.error.issues).toHaveLength(1);
    expect(result.error.issues[0]).toMatchObject({ code: "too_big", path: ["tags"] });
  });

  it.each([parsePaymentRequired, parsePaymentPayload])(
    "bounds tag errors through the public payment parsers",
    parse => {
      const requirements = {
        scheme: "exact",
        network: "tron:3448148188",
        amount: "1",
        asset: "token",
        payTo: "recipient",
        maxTimeoutSeconds: 60,
      };
      const payment = {
        x402Version: 2,
        accepts: [requirements],
        accepted: requirements,
        payload: { signature: "0x01" },
        resource: { url: "https://test.invalid", tags: ["payments"] },
      };
      expect(parse(payment).success).toBe(true);
      const result = parse({
        ...payment,
        resource: { ...payment.resource, tags: Array(1_000).fill(0) },
      });
      expect(result.success).toBe(false);
      if (result.success) throw new Error("Oversized resource tags accepted");
      expect(result.error.issues).toHaveLength(1);
      expect(result.error.issues[0]).toMatchObject({
        code: "too_big",
        path: ["resource", "tags"],
      });
    },
  );

  it("preserves extensible records and nullable optional metadata", () => {
    const record = { signature: "0x01", authorization: { nonce: "1" }, values: [1, null] };
    expect(Any.parse(record)).toEqual(record);
    expect(OptionalAny.parse(null)).toBeNull();
    expect(OptionalAny.parse(undefined)).toBeUndefined();
    expect(Any.safeParse([record]).success).toBe(false);
    expect(
      ResourceInfoSchema.parse({ url: "https://test.invalid", tags: null }).tags,
    ).toBeUndefined();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { ExactTronScheme } from "../../src/exact/facilitator/scheme";
import type { FacilitatorTronClient } from "../../src/signer";
import {
  createPaymentPayload,
  createSignedTransfer,
  mockRecoveredPayer,
  NOW,
  PAYER,
  REQUIREMENTS,
} from "./helpers";

function createClient(): FacilitatorTronClient {
  return {
    preflightTransfer: vi.fn(async () => undefined),
    broadcastTransaction: vi.fn(async transaction => transaction.txID),
    waitForTransaction: vi.fn(async () => undefined),
  };
}

describe("Exact TRON facilitator scheme", () => {
  afterEach(() => vi.restoreAllMocks());

  it("verifies a valid signed transfer", async () => {
    mockRecoveredPayer();
    const result = await new ExactTronScheme(createClient(), { now: () => NOW }).verify(
      createPaymentPayload(),
      REQUIREMENTS,
    );
    expect(result).toEqual({ isValid: true, payer: PAYER });
  });

  it("rejects an incorrect amount", async () => {
    mockRecoveredPayer();
    const result = await new ExactTronScheme(createClient(), { now: () => NOW }).verify(
      createPaymentPayload(createSignedTransfer({ amount: "999" })),
      REQUIREMENTS,
    );
    expect(result.invalidReason).toBe("invalid_exact_tron_payload_amount_mismatch");
  });

  it("rejects expired transactions", async () => {
    mockRecoveredPayer();
    const result = await new ExactTronScheme(createClient(), { now: () => NOW }).verify(
      createPaymentPayload(createSignedTransfer({ expiration: NOW + 1_000 })),
      REQUIREMENTS,
    );
    expect(result.invalidReason).toBe("invalid_exact_tron_payload_transaction_expired");
  });

  it("rejects excessive fee limits", async () => {
    mockRecoveredPayer();
    const result = await new ExactTronScheme(createClient(), {
      now: () => NOW,
      maxFeeLimit: 10_000_000,
    }).verify(createPaymentPayload(), REQUIREMENTS);
    expect(result.invalidReason).toBe("invalid_exact_tron_payload_fee_limit");
  });

  it("broadcasts and confirms a verified payment", async () => {
    mockRecoveredPayer();
    const client = createClient();
    const result = await new ExactTronScheme(client, { now: () => NOW }).settle(
      createPaymentPayload(),
      REQUIREMENTS,
    );
    expect(result.success).toBe(true);
    expect(result.transaction).toBe("ab".repeat(32));
    expect(client.broadcastTransaction).toHaveBeenCalledOnce();
    expect(client.waitForTransaction).toHaveBeenCalledOnce();
  });

  it("returns preflight failures as invalid payments", async () => {
    mockRecoveredPayer();
    const client = createClient();
    client.preflightTransfer = vi.fn(async () => {
      throw new Error("insufficient token balance");
    });
    const result = await new ExactTronScheme(client, { now: () => NOW }).verify(
      createPaymentPayload(),
      REQUIREMENTS,
    );
    expect(result.invalidReason).toBe("invalid_exact_tron_payload_preflight_failed");
    expect(result.invalidMessage).toBe("insufficient token balance");
  });
});

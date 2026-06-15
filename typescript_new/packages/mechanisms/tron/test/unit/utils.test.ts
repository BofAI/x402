import { afterEach, describe, expect, it, vi } from "vitest";
import { inspectTronTransaction, normalizeTronAddress } from "../../src/utils";
import {
  ASSET,
  createSignedTransfer,
  mockRecoveredPayer,
  PAYER,
  PAY_TO,
  REQUIREMENTS,
} from "./helpers";

describe("TRON utilities", () => {
  afterEach(() => vi.restoreAllMocks());

  it("inspects a valid signed TRC-20 transfer", () => {
    mockRecoveredPayer();
    const inspected = inspectTronTransaction(createSignedTransfer());

    expect(inspected.payer).toBe(PAYER);
    expect(inspected.asset).toBe(ASSET);
    expect(inspected.payTo).toBe(PAY_TO);
    expect(inspected.amount).toBe(REQUIREMENTS.amount);
  });

  it("normalizes base58 and hex addresses identically", () => {
    expect(normalizeTronAddress(PAYER)).toBe(normalizeTronAddress(normalizeTronAddress(PAYER)));
  });

  it("rejects a signature from another owner", () => {
    mockRecoveredPayer(PAY_TO);
    expect(() => inspectTronTransaction(createSignedTransfer())).toThrow(
      "signature_owner_mismatch",
    );
  });

  it("rejects non-transfer smart contract calls", () => {
    mockRecoveredPayer();
    expect(() => inspectTronTransaction(createSignedTransfer({ selector: "deadbeef" }))).toThrow(
      "trc20_transfer_required",
    );
  });

  it("rejects multisig transactions in the MVP", () => {
    expect(() => inspectTronTransaction(createSignedTransfer({ signature: ["00", "11"] }))).toThrow(
      "exactly_one_signature_required",
    );
  });
});

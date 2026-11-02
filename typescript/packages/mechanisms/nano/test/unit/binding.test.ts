import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import {
  InMemoryNanoUsedBlockStore,
  SqliteNanoUsedBlockStore,
  isNanoPaymentSecret,
  nanoOrderCommitment,
} from "../../src";
import { ExactNanoScheme, ExactNanoErrors } from "../../src/exact/facilitator";
import {
  AMOUNT,
  BLOCK_HASH,
  BLOCK_TIME,
  COMMITMENT,
  PAYER,
  PAY_TO,
  SECRET,
  mockRpc,
  paymentPayload,
  requirements,
  stateSendBlockInfo,
} from "./helpers";

const BURN = "nano_1111111111111111111111111111111111111111111111111111hifc8npp";

describe("order commitment", () => {
  it("matches the XNO binding standard test vector (option C, order id as secret)", () => {
    expect(nanoOrderCommitment("order-0001", BURN, "50000000000000000000000000000")).toBe(
      "nano_33q9dassq66es6mcay83n5kypqgpzjikr9bkc9ope9xch1borfphgehj4ozj",
    );
  });

  it("changes with the secret, the destination and the amount", () => {
    expect(nanoOrderCommitment("b".repeat(32), PAY_TO, AMOUNT)).not.toBe(COMMITMENT);
    expect(nanoOrderCommitment(SECRET, BURN, AMOUNT)).not.toBe(COMMITMENT);
    expect(nanoOrderCommitment(SECRET, PAY_TO, AMOUNT + "0")).not.toBe(COMMITMENT);
  });

  it("accepts 128 to 512 bits of hex as a secret and nothing else", () => {
    expect(isNanoPaymentSecret("a".repeat(32))).toBe(true);
    expect(isNanoPaymentSecret("A".repeat(128))).toBe(true);
    for (const bad of ["a".repeat(31), "a".repeat(129), "g".repeat(32), "", 5, undefined]) {
      expect(isNanoPaymentSecret(bad), String(bad)).toBe(false);
    }
  });
});

describe("payment binding in the facilitator", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date((BLOCK_TIME + 10) * 1000));
  });
  afterEach(() => vi.useRealTimers());

  const facilitator = (body: Record<string, unknown>) =>
    new ExactNanoScheme({ rpc: mockRpc(body).rpc, allowInMemoryUsedBlocks: true });

  it("accepts the block whose representative commits to the presented secret", async () => {
    const result = await facilitator(stateSendBlockInfo()).verify(paymentPayload(), requirements());
    expect(result).toEqual({ isValid: true, payer: PAYER });
  });

  it("refuses a ledger-watcher: right destination and amount, but no secret that opens the commitment", async () => {
    // Someone else's payment, read off the ledger. The thief knows the hash and the public
    // representative, not the secret, so every guess at a secret fails.
    const scheme = facilitator(stateSendBlockInfo());
    for (const guess of ["00".repeat(32), "ab".repeat(16), "cd".repeat(32)]) {
      const result = await scheme.verify(
        paymentPayload(BLOCK_HASH, requirements(), guess),
        requirements(),
      );
      expect(result, guess).toMatchObject({
        isValid: false,
        invalidReason: ExactNanoErrors.NOT_BOUND_TO_PAYMENT,
      });
    }
  });

  it("refuses a block with another representative, or none that matches", async () => {
    for (const representative of [
      PAYER,
      BURN,
      nanoOrderCommitment(SECRET, BURN, AMOUNT),
      undefined,
    ]) {
      const scheme = facilitator(stateSendBlockInfo({}, { representative }));
      expect(
        await scheme.verify(paymentPayload(), requirements()),
        String(representative),
      ).toMatchObject({
        isValid: false,
        invalidReason: ExactNanoErrors.NOT_BOUND_TO_PAYMENT,
      });
    }
  });

  it("binds the amount: a block committed to a cheaper price does not pay a dearer one", async () => {
    const cheaper = nanoOrderCommitment(SECRET, PAY_TO, "1");
    const result = await facilitator(stateSendBlockInfo({}, { representative: cheaper })).verify(
      paymentPayload(),
      requirements(),
    );
    expect(result).toMatchObject({
      isValid: false,
      invalidReason: ExactNanoErrors.NOT_BOUND_TO_PAYMENT,
    });
  });

  it("refuses a payload without a well-formed secret, before calling the node", async () => {
    const { rpc, fetchMock } = mockRpc(stateSendBlockInfo());
    const scheme = new ExactNanoScheme({ rpc, allowInMemoryUsedBlocks: true });
    for (const secret of [null, "", "xyz", "ab".repeat(8), 7]) {
      const result = await scheme.verify(
        paymentPayload(BLOCK_HASH, requirements(), secret),
        requirements(),
      );
      expect(result).toMatchObject({
        isValid: false,
        invalidReason: ExactNanoErrors.INVALID_PAYLOAD,
      });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("credits one payment once: a second block with the same commitment is refused", async () => {
    const scheme = facilitator(stateSendBlockInfo());
    const first = await scheme.settle(paymentPayload(), requirements());
    expect(first.success).toBe(true);
    const otherHash = "A".repeat(64);
    const second = await scheme.settle(paymentPayload(otherHash), requirements());
    expect(second).toMatchObject({
      success: false,
      errorReason: ExactNanoErrors.BLOCK_ALREADY_USED,
    });
  });
});

describe("the used-block store is mandatory and durable", () => {
  it("refuses to start without a persistent store", () => {
    const { rpc } = mockRpc({});
    expect(() => new ExactNanoScheme({ rpc })).toThrow(/persistent usedBlocks/);
    expect(
      () => new ExactNanoScheme({ rpc, usedBlocks: new InMemoryNanoUsedBlockStore() }),
    ).toThrow(/persistent usedBlocks/);
    expect(() => new ExactNanoScheme({ rpc, allowInMemoryUsedBlocks: true })).not.toThrow();
    expect(
      () =>
        new ExactNanoScheme({
          rpc,
          usedBlocks: new SqliteNanoUsedBlockStore(new DatabaseSync(":memory:")),
        }),
    ).not.toThrow();
  });

  it("in memory: one hash and one commitment each pay once", () => {
    const store = new InMemoryNanoUsedBlockStore();
    expect(store.add("H1", "C1")).toBe(true);
    expect(store.add("H1", "C2")).toBe(false);
    expect(store.add("H2", "C1")).toBe(false);
    expect(store.has("H1")).toBe(true);
    expect(store.has("H2")).toBe(false);
  });

  it("on SQLite: claims survive reopening the file, and two connections race for one block", async () => {
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "nano-used-"));
    try {
      const file = join(dir, "used.db");
      const first = new DatabaseSync(file);
      first.exec("PRAGMA synchronous = FULL");
      const a = new SqliteNanoUsedBlockStore(first);
      expect(a.persistent).toBe(true);
      expect(a.add("HASH1", "COMMIT1")).toBe(true);
      first.close();

      const second = new DatabaseSync(file);
      const third = new DatabaseSync(file);
      const b = new SqliteNanoUsedBlockStore(second);
      const c = new SqliteNanoUsedBlockStore(third);
      expect(b.has("HASH1")).toBe(true);
      expect(b.add("HASH1", "COMMIT9")).toBe(false);
      expect(b.add("HASH9", "COMMIT1")).toBe(false);
      expect([b.add("HASH2", "COMMIT2"), c.add("HASH2", "COMMIT2")]).toEqual([true, false]);
      second.close();
      third.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rethrows a database failure that is not a constraint", () => {
    const db = {
      exec: () => undefined,
      prepare: () => ({
        run: () => {
          throw Object.assign(new Error("disk full"), { code: "SQLITE_FULL" });
        },
        get: () => undefined,
      }),
    };
    expect(() => new SqliteNanoUsedBlockStore(db).add("H", "C")).toThrow("disk full");
  });
});

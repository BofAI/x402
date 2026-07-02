import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  attachFacilitatorLogging,
  createFacilitator,
} from "../../../src/observability/facilitatorLogging";
import { setLogger, resetLogger, type Logger } from "../../../src/observability/logger";
import { x402Facilitator } from "../../../src/facilitator/x402Facilitator";
import {
  PaymentPayload,
  PaymentRequirements,
  VerifyResponse,
  SettleResponse,
} from "../../../src/types";
import { SchemeNetworkFacilitator } from "../../../src/types/mechanisms";

/**
 * Unit tests for the facilitator logging overlay.
 *
 * Verifies that observability is registered on the facilitator's hook surface
 * (so x402Facilitator stays byte-identical to upstream) and that the logs flow
 * through the injectable global logger.
 */

class MockSchemeFacilitator implements SchemeNetworkFacilitator {
  readonly scheme = "exact";

  constructor(
    private verifyFn?: () => Promise<VerifyResponse>,
    private settleFn?: () => Promise<SettleResponse>,
  ) {}

  getExtra(): Record<string, unknown> | undefined {
    return undefined;
  }

  async verify(): Promise<VerifyResponse> {
    return this.verifyFn ? this.verifyFn() : { isValid: true, payer: "0xPayer" };
  }

  async settle(): Promise<SettleResponse> {
    return this.settleFn
      ? this.settleFn()
      : { success: true, transaction: "0xTx", network: "eip155:8453" };
  }
}

const payload: PaymentPayload = {
  x402Version: 2,
  payload: {},
  accepted: {
    scheme: "exact",
    network: "eip155:8453",
    asset: "0xUSDC",
    amount: "1000000",
    payTo: "0xRecipient",
    maxTimeoutSeconds: 300,
    extra: {},
  },
  resource: { url: "https://e.com/r", description: "r", mimeType: "application/json" },
};

const requirements: PaymentRequirements = {
  scheme: "exact",
  network: "eip155:8453",
  asset: "0xUSDC",
  amount: "1000000",
  payTo: "0xRecipient",
  maxTimeoutSeconds: 300,
  extra: {},
};

const makeSpyLogger = (): Logger => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

describe("attachFacilitatorLogging", () => {
  let logger: Logger;

  beforeEach(() => {
    logger = makeSpyLogger();
    setLogger(logger);
  });

  afterEach(() => {
    resetLogger();
  });

  it("returns the same facilitator instance (chainable)", () => {
    const f = new x402Facilitator();
    expect(attachFacilitatorLogging(f)).toBe(f);
  });

  it("logs info on successful verify and settle", async () => {
    const f = attachFacilitatorLogging(new x402Facilitator());
    f.register("eip155:8453", new MockSchemeFacilitator());

    await f.verify(payload, requirements);
    await f.settle(payload, requirements);

    expect(logger.info).toHaveBeenCalledWith(
      "x402: verify result",
      expect.objectContaining({ isValid: true }),
    );
    expect(logger.info).toHaveBeenCalledWith("x402: settle start", expect.any(Object));
    expect(logger.info).toHaveBeenCalledWith(
      "x402: settle result",
      expect.objectContaining({ success: true }),
    );
  });

  it("logs warn on invalid verify", async () => {
    const f = attachFacilitatorLogging(new x402Facilitator());
    f.register(
      "eip155:8453",
      new MockSchemeFacilitator(async () => ({ isValid: false, invalidReason: "bad sig" })),
    );

    await f.verify(payload, requirements);

    expect(logger.warn).toHaveBeenCalledWith(
      "x402: verify failed",
      expect.objectContaining({ reason: "bad sig" }),
    );
  });

  it("logs warn on unsuccessful settle result", async () => {
    const f = attachFacilitatorLogging(new x402Facilitator());
    f.register(
      "eip155:8453",
      new MockSchemeFacilitator(undefined, async () => ({
        success: false,
        errorReason: "insufficient_funds",
        network: "eip155:8453",
      })),
    );

    await f.settle(payload, requirements);

    expect(logger.warn).toHaveBeenCalledWith(
      "x402: settle result",
      expect.objectContaining({ success: false, errorReason: "insufficient_funds" }),
    );
  });

  it("logs error when settle throws, and re-throws", async () => {
    const f = attachFacilitatorLogging(new x402Facilitator());
    f.register(
      "eip155:8453",
      new MockSchemeFacilitator(undefined, async () => {
        throw new Error("rpc down");
      }),
    );

    await expect(f.settle(payload, requirements)).rejects.toThrow("rpc down");
    expect(logger.error).toHaveBeenCalledWith(
      "x402: settle threw",
      expect.objectContaining({ error: "rpc down" }),
    );
  });

  it("coexists with a third-party hook (additive, not overwritten)", async () => {
    const f = attachFacilitatorLogging(new x402Facilitator());
    f.register("eip155:8453", new MockSchemeFacilitator());

    const thirdParty = vi.fn(async () => {});
    f.onAfterSettle(thirdParty);

    await f.settle(payload, requirements);

    expect(logger.info).toHaveBeenCalledWith("x402: settle result", expect.any(Object));
    expect(thirdParty).toHaveBeenCalledTimes(1);
  });
});

describe("createFacilitator", () => {
  afterEach(() => resetLogger());

  it("returns a facilitator with logging pre-attached", async () => {
    const logger = makeSpyLogger();
    setLogger(logger);

    const f = createFacilitator();
    f.register("eip155:8453", new MockSchemeFacilitator());

    await f.settle(payload, requirements);

    expect(logger.info).toHaveBeenCalledWith("x402: settle result", expect.any(Object));
  });
});

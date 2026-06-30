import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  attachResourceServerLogging,
  createResourceServer,
} from "../../../src/observability/resourceServerLogging";
import { setLogger, resetLogger, type Logger } from "../../../src/observability/logger";
import { x402ResourceServer } from "../../../src/server/x402ResourceServer";
import {
  MockFacilitatorClient,
  MockSchemeNetworkServer,
  buildPaymentPayload,
  buildPaymentRequirements,
  buildVerifyResponse,
  buildSettleResponse,
  buildSupportedResponse,
} from "../../mocks";
import { Network } from "../../../src/types";

/**
 * Unit tests for the resource-server logging overlay.
 *
 * Verifies observability is registered on the resource server's hook surface
 * (so x402ResourceServer stays byte-identical to upstream) and that logs flow
 * through the injectable global logger with the SAME shape as the facilitator
 * side (shared paymentLogFormat). The role asymmetry — invalid verify surfaces
 * on onAfterVerify here vs onVerifyFailure on the facilitator — is exercised.
 */

const NETWORK = "test:network" as Network;

const makeSpyLogger = (): Logger => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

/** Build a server wired to a mock facilitator with the given verify/settle outcomes. */
function makeServer(
  verify: ReturnType<typeof buildVerifyResponse> | Error,
  settle: ReturnType<typeof buildSettleResponse> | Error = buildSettleResponse(),
): x402ResourceServer {
  const client = new MockFacilitatorClient(buildSupportedResponse(), verify, settle);
  const server = attachResourceServerLogging(new x402ResourceServer(client));
  server.register(NETWORK, new MockSchemeNetworkServer("test-scheme"));
  return server;
}

describe("attachResourceServerLogging", () => {
  let logger: Logger;

  beforeEach(() => {
    logger = makeSpyLogger();
    setLogger(logger);
  });

  afterEach(() => {
    resetLogger();
  });

  it("returns the same server instance (chainable)", () => {
    const server = new x402ResourceServer(new MockFacilitatorClient(buildSupportedResponse()));
    expect(attachResourceServerLogging(server)).toBe(server);
  });

  it("logs info on successful verify and settle", async () => {
    const server = makeServer(buildVerifyResponse({ isValid: true, payer: "0xPayer" }));

    await server.verifyPayment(buildPaymentPayload(), buildPaymentRequirements());
    await server.settlePayment(buildPaymentPayload(), buildPaymentRequirements());

    expect(logger.info).toHaveBeenCalledWith(
      "x402: verify result",
      expect.objectContaining({ isValid: true, payer: "0xPayer" }),
    );
    expect(logger.info).toHaveBeenCalledWith("x402: settle start", expect.any(Object));
    expect(logger.info).toHaveBeenCalledWith(
      "x402: settle result",
      expect.objectContaining({ success: true }),
    );
  });

  it("logs warn on invalid verify (surfaced via onAfterVerify, not a throw)", async () => {
    const server = makeServer(buildVerifyResponse({ isValid: false, invalidReason: "bad sig" }));

    await server.verifyPayment(buildPaymentPayload(), buildPaymentRequirements());

    expect(logger.warn).toHaveBeenCalledWith(
      "x402: verify failed",
      expect.objectContaining({ reason: "bad sig" }),
    );
  });

  it("logs warn on unsuccessful settle result", async () => {
    const server = makeServer(
      buildVerifyResponse({ isValid: true }),
      buildSettleResponse({ success: false, errorReason: "insufficient_funds" }),
    );

    await server.settlePayment(buildPaymentPayload(), buildPaymentRequirements());

    expect(logger.warn).toHaveBeenCalledWith(
      "x402: settle result",
      expect.objectContaining({ success: false, errorReason: "insufficient_funds" }),
    );
  });

  it("logs warn when verify throws, and re-throws", async () => {
    const server = makeServer(new Error("rpc down"));

    await expect(
      server.verifyPayment(buildPaymentPayload(), buildPaymentRequirements()),
    ).rejects.toThrow("rpc down");

    expect(logger.warn).toHaveBeenCalledWith(
      "x402: verify failed",
      expect.objectContaining({ reason: "rpc down" }),
    );
  });

  it("logs error when settle throws, and re-throws", async () => {
    const server = makeServer(buildVerifyResponse({ isValid: true }), new Error("settle boom"));

    await expect(
      server.settlePayment(buildPaymentPayload(), buildPaymentRequirements()),
    ).rejects.toThrow("settle boom");

    expect(logger.error).toHaveBeenCalledWith(
      "x402: settle threw",
      expect.objectContaining({ error: "settle boom" }),
    );
  });
});

describe("createResourceServer", () => {
  afterEach(() => resetLogger());

  it("returns a resource server with logging pre-attached", async () => {
    const logger = makeSpyLogger();
    setLogger(logger);

    const client = new MockFacilitatorClient(
      buildSupportedResponse(),
      buildVerifyResponse({ isValid: true }),
      buildSettleResponse(),
    );
    const server = createResourceServer(client);
    server.register(NETWORK, new MockSchemeNetworkServer("test-scheme"));

    await server.settlePayment(buildPaymentPayload(), buildPaymentRequirements());

    expect(logger.info).toHaveBeenCalledWith("x402: settle result", expect.any(Object));
  });
});

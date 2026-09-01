import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TronWeb } from "tronweb";
import { privateKeyTronWallet } from "../helpers";
import { normalizeAddressForSigning } from "../../../src/utils";
import { BatchSettlementTronScheme } from "../../../src/batch-settlement/server/scheme";
import { InMemoryChannelStorage, type Channel } from "../../../src/batch-settlement/server/storage";
import { computeChannelId } from "../../../src/shared/batch-settlement/utils";
import { signVoucher } from "../../../src/batch-settlement/client/voucher";
import type { ClientTronSigner } from "../../../src/signer";
import type {
  ChannelConfig,
  BatchSettlementVoucherPayload,
  BatchSettlementDepositPayload,
  BatchSettlementRefundPayload,
} from "../../../src/batch-settlement/types";
import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  VerifyResponse,
} from "@bankofai/x402-core/types";
import * as Errors from "../../../src/batch-settlement/errors";

/**
 * Offline coverage of the batch-settlement server lifecycle hooks — the
 * off-chain accounting engine: cumulative charging, gasless settle short-circuit,
 * pending-request concurrency control, corrective-402 resync, and cleanup.
 *
 * These are pure logic over an in-memory channel store; no chain access.
 */

const NETWORK = "tron:3448148188";
const PAYER_PK = "da146374a75310b9666e834ee4ad0866d6f4035967bfc76217c5a495fff9f0d0";
const RECEIVER = "0x9876543210987654321098765432109876543210";
const RECEIVER_AUTHORIZER = "0x1111111111111111111111111111111111111111";
const ASSET = "0x5555555555555555555555555555555555555555";

function makeRequirements(overrides: Partial<PaymentRequirements> = {}): PaymentRequirements {
  return {
    scheme: "batch-settlement",
    network: NETWORK,
    amount: "1000",
    asset: ASSET,
    payTo: RECEIVER,
    maxTimeoutSeconds: 3600,
    extra: { receiverAuthorizer: RECEIVER_AUTHORIZER, withdrawDelay: 900 },
    ...overrides,
  } as unknown as PaymentRequirements;
}

function buildChannelConfig(payer: string, overrides: Partial<ChannelConfig> = {}): ChannelConfig {
  return {
    payer,
    payerAuthorizer: payer,
    receiver: RECEIVER,
    receiverAuthorizer: RECEIVER_AUTHORIZER,
    token: ASSET,
    withdrawDelay: 900,
    salt: `0x${"00".repeat(32)}` as `0x${string}`,
    ...overrides,
  };
}

function voucherPayload(
  channelId: string,
  maxClaimableAmount: string,
  config: ChannelConfig,
  signature: `0x${string}` = "0xdeadbeef",
): PaymentPayload {
  const payload: BatchSettlementVoucherPayload = {
    type: "voucher",
    channelConfig: config,
    voucher: { channelId: channelId as `0x${string}`, maxClaimableAmount, signature },
  };
  return { x402Version: 2, accepted: makeRequirements(), payload } as unknown as PaymentPayload;
}

function depositPayload(
  channelId: string,
  maxClaimableAmount: string,
  config: ChannelConfig,
): PaymentPayload {
  const payload: BatchSettlementDepositPayload = {
    type: "deposit",
    channelConfig: config,
    voucher: { channelId: channelId as `0x${string}`, maxClaimableAmount, signature: "0xbeef" },
    deposit: {
      amount: "5000",
      authorization: {
        permit2Authorization: {
          from: config.payer,
          permitted: { token: ASSET, amount: "5000" },
          spender: "0x2222222222222222222222222222222222222222",
          nonce: "1",
          deadline: "99999999999",
          witness: { channelId: channelId as `0x${string}` },
          signature: "0xbeef",
        },
      },
    },
  };
  return { x402Version: 2, accepted: makeRequirements(), payload } as unknown as PaymentPayload;
}

function storedChannel(
  channelId: string,
  config: ChannelConfig,
  o: Partial<Channel> = {},
): Channel {
  return {
    channelId,
    channelConfig: config,
    chargedCumulativeAmount: "0",
    signedMaxClaimable: "0",
    signature: "0x",
    balance: "10000",
    totalClaimed: "0",
    withdrawRequestedAt: 0,
    refundNonce: 0,
    lastRequestTimestamp: 0,
    ...o,
  };
}

describe("batch-settlement server hooks (TRON, offline)", () => {
  let server: BatchSettlementTronScheme;
  let storage: InMemoryChannelStorage;
  let signer: ClientTronSigner;
  let payer: string;

  beforeAll(() => {
    const tronWeb = new TronWeb({ fullHost: "https://nile.trongrid.io", privateKey: PAYER_PK });
    const wallet = privateKeyTronWallet(tronWeb, PAYER_PK);
    payer = normalizeAddressForSigning(TronWeb.address.fromPrivateKey(PAYER_PK) as string);
    signer = {
      address: payer,
      signTypedData: args => wallet.signTypedData(args),
      async readContract() {
        throw new Error("not used");
      },
    };
  });

  beforeEach(() => {
    storage = new InMemoryChannelStorage();
    server = new BatchSettlementTronScheme(RECEIVER, { storage });
  });

  // ---- onBeforeVerify ----

  it("onBeforeVerify: ignores non batch-settlement payloads", async () => {
    const result = await server.schemeHooks.onBeforeVerify!({
      paymentPayload: { x402Version: 2, accepted: makeRequirements(), payload: { foo: "bar" } },
      requirements: makeRequirements(),
    } as never);
    expect(result).toBeUndefined();
  });

  it("onBeforeVerify: aborts when the client cumulative does not match server state", async () => {
    const config = buildChannelConfig(payer);
    const channelId = computeChannelId(config, NETWORK);
    await storage.updateChannel(channelId, () =>
      storedChannel(channelId, config, { chargedCumulativeAmount: "1000" }),
    );
    // Expected cumulative = 1000 + 1000 = 2000, but client signs 5000.
    const result = (await server.schemeHooks.onBeforeVerify!({
      paymentPayload: voucherPayload(channelId, "5000", config),
      requirements: makeRequirements(),
    } as never)) as { abort: true; reason: string };
    expect(result.abort).toBe(true);
    expect(result.reason).toBe(Errors.ErrCumulativeAmountMismatch);
  });

  it("onBeforeVerify: reserves (no abort) for a matching deposit with no channel record", async () => {
    const config = buildChannelConfig(payer);
    const channelId = computeChannelId(config, NETWORK);
    // Deposit ceiling = inferred charged (0) + amount (1000).
    const result = await server.schemeHooks.onBeforeVerify!({
      paymentPayload: depositPayload(channelId, "1000", config),
      requirements: makeRequirements(),
    } as never);
    expect(result).toBeUndefined();
    const stored = await storage.get(channelId);
    expect(stored?.pendingRequest).toBeDefined();
  });

  it("onBeforeVerify: rejects a concurrent same-channel request as busy", async () => {
    const config = buildChannelConfig(payer);
    const channelId = computeChannelId(config, NETWORK);
    await storage.updateChannel(channelId, () => storedChannel(channelId, config));

    // First request reserves.
    const first = await server.schemeHooks.onBeforeVerify!({
      paymentPayload: voucherPayload(channelId, "1000", config),
      requirements: makeRequirements(),
    } as never);
    expect(first).toBeUndefined();

    // Second concurrent request on the same channel is rejected.
    const second = (await server.schemeHooks.onBeforeVerify!({
      paymentPayload: voucherPayload(channelId, "1000", config),
      requirements: makeRequirements(),
    } as never)) as { abort: true; reason: string };
    expect(second.abort).toBe(true);
    expect(second.reason).toBe(Errors.ErrChannelBusy);
  });

  it("onBeforeVerify: locally verifies a fresh EOA voucher and short-circuits", async () => {
    const config = buildChannelConfig(payer);
    const channelId = computeChannelId(config, NETWORK);
    await storage.updateChannel(channelId, () =>
      storedChannel(channelId, config, { balance: "10000", onchainSyncedAt: Date.now() }),
    );
    const voucher = await signVoucher(signer, channelId, "1000", NETWORK);
    const result = (await server.schemeHooks.onBeforeVerify!({
      paymentPayload: voucherPayload(channelId, "1000", config, voucher.signature),
      requirements: makeRequirements(),
    } as never)) as { skip: true; result: VerifyResponse };
    expect(result.skip).toBe(true);
    expect(result.result.isValid).toBe(true);
  });

  // ---- onBeforeSettle ----

  it("onBeforeSettle: aborts a voucher when no channel record exists", async () => {
    const config = buildChannelConfig(payer);
    const channelId = computeChannelId(config, NETWORK);
    const payload = voucherPayload(channelId, "1000", config);
    server.mergeRequestContext(payload, { channelId, pendingId: "p1" });
    const result = (await server.schemeHooks.onBeforeSettle!({
      paymentPayload: payload,
      requirements: makeRequirements(),
    } as never)) as { abort: true; reason: string };
    expect(result.abort).toBe(true);
    expect(result.reason).toBe(Errors.ErrMissingChannel);
  });

  it("onBeforeSettle: aborts when the charge would exceed the signed cap", async () => {
    const config = buildChannelConfig(payer);
    const channelId = computeChannelId(config, NETWORK);
    await storage.updateChannel(channelId, () =>
      storedChannel(channelId, config, {
        chargedCumulativeAmount: "1000",
        pendingRequest: {
          pendingId: "p1",
          signedMaxClaimable: "1000",
          expiresAt: Date.now() + 60000,
        },
      }),
    );
    const payload = voucherPayload(channelId, "1000", config); // signed cap 1000 < 1000+1000
    server.mergeRequestContext(payload, { channelId, pendingId: "p1" });
    const result = (await server.schemeHooks.onBeforeSettle!({
      paymentPayload: payload,
      requirements: makeRequirements({ amount: "1000" }),
    } as never)) as { abort: true; reason: string };
    expect(result.abort).toBe(true);
    expect(result.reason).toBe(Errors.ErrChargeExceedsSignedCumulative);
  });

  it("onBeforeSettle: charges off-chain (no tx) and advances the cumulative", async () => {
    const config = buildChannelConfig(payer);
    const channelId = computeChannelId(config, NETWORK);
    await storage.updateChannel(channelId, () =>
      storedChannel(channelId, config, {
        balance: "10000",
        pendingRequest: {
          pendingId: "p1",
          signedMaxClaimable: "1000",
          expiresAt: Date.now() + 60000,
        },
      }),
    );
    const payload = voucherPayload(channelId, "1000", config);
    server.mergeRequestContext(payload, { channelId, pendingId: "p1" });

    const result = (await server.schemeHooks.onBeforeSettle!({
      paymentPayload: payload,
      requirements: makeRequirements({ amount: "1000" }),
    } as never)) as { skip: true; result: SettleResponse };

    expect(result.skip).toBe(true);
    expect(result.result.success).toBe(true);
    expect(result.result.transaction).toBe(""); // gasless: no on-chain settle
    expect(result.result.extra?.chargedAmount).toBe("1000");

    const updated = await storage.get(channelId);
    expect(updated?.chargedCumulativeAmount).toBe("1000");
    expect(updated?.signedMaxClaimable).toBe("1000");
    expect(updated?.pendingRequest).toBeUndefined(); // reservation released
  });

  // ---- onAfterVerify ----

  it("onAfterVerify: persists a channel record from a verified deposit", async () => {
    const config = buildChannelConfig(payer);
    const channelId = computeChannelId(config, NETWORK);
    const payload = depositPayload(channelId, "1000", config);
    await server.schemeHooks.onBeforeVerify!({
      paymentPayload: payload,
      requirements: makeRequirements(),
    } as never);

    await server.schemeHooks.onAfterVerify!({
      paymentPayload: payload,
      requirements: makeRequirements(),
      result: {
        isValid: true,
        payer,
        extra: { balance: "5000", totalClaimed: "0", withdrawRequestedAt: 0, refundNonce: 0 },
      },
    } as never);

    const stored = await storage.get(channelId);
    expect(stored?.balance).toBe("5000");
    expect(stored?.signedMaxClaimable).toBe("1000");
  });

  it("onAfterVerify: clears the reservation when verification is invalid", async () => {
    const config = buildChannelConfig(payer);
    const channelId = computeChannelId(config, NETWORK);
    await storage.updateChannel(channelId, () => storedChannel(channelId, config));
    const payload = voucherPayload(channelId, "1000", config);
    await server.schemeHooks.onBeforeVerify!({
      paymentPayload: payload,
      requirements: makeRequirements(),
    } as never);

    await server.schemeHooks.onAfterVerify!({
      paymentPayload: payload,
      requirements: makeRequirements(),
      result: { isValid: false },
    } as never);

    const stored = await storage.get(channelId);
    expect(stored?.pendingRequest).toBeUndefined();
  });

  it("onAfterVerify: returns a skipHandler directive for a refund voucher", async () => {
    const config = buildChannelConfig(payer);
    const channelId = computeChannelId(config, NETWORK);
    await storage.updateChannel(channelId, () =>
      storedChannel(channelId, config, { chargedCumulativeAmount: "1000", balance: "10000" }),
    );
    const refund: BatchSettlementRefundPayload = {
      type: "refund",
      channelConfig: config,
      voucher: {
        channelId: channelId as `0x${string}`,
        maxClaimableAmount: "1000",
        signature: "0xab",
      },
    };
    const payload = {
      x402Version: 2,
      accepted: makeRequirements(),
      payload: refund,
    } as unknown as PaymentPayload;

    await server.schemeHooks.onBeforeVerify!({
      paymentPayload: payload,
      requirements: makeRequirements(),
    } as never);

    const result = (await server.schemeHooks.onAfterVerify!({
      paymentPayload: payload,
      requirements: makeRequirements(),
      result: {
        isValid: true,
        payer,
        extra: { balance: "10000", totalClaimed: "0", withdrawRequestedAt: 0, refundNonce: 0 },
      },
    } as never)) as { skipHandler: true };
    expect(result?.skipHandler).toBe(true);
  });

  // ---- cleanup ----

  it("onVerifyFailure: releases the pending reservation", async () => {
    const config = buildChannelConfig(payer);
    const channelId = computeChannelId(config, NETWORK);
    await storage.updateChannel(channelId, () => storedChannel(channelId, config));
    const payload = voucherPayload(channelId, "1000", config);
    await server.schemeHooks.onBeforeVerify!({
      paymentPayload: payload,
      requirements: makeRequirements(),
    } as never);
    expect((await storage.get(channelId))?.pendingRequest).toBeDefined();

    await server.schemeHooks.onVerifyFailure!({ paymentPayload: payload } as never);
    expect((await storage.get(channelId))?.pendingRequest).toBeUndefined();
  });

  // ---- corrective 402 ----

  it("enrichPaymentRequiredResponse: attaches channel state on a cumulative mismatch", async () => {
    const config = buildChannelConfig(payer);
    const channelId = computeChannelId(config, NETWORK);
    await storage.updateChannel(channelId, () =>
      storedChannel(channelId, config, {
        chargedCumulativeAmount: "1000",
        signedMaxClaimable: "1000",
        signature: "0xabc",
        balance: "10000",
      }),
    );
    const payload = voucherPayload(channelId, "1000", config);
    const requirements = makeRequirements();

    const updated = await server.enrichPaymentRequiredResponse({
      error: Errors.ErrCumulativeAmountMismatch,
      paymentPayload: payload,
      requirements: [requirements],
    } as never);
    void updated;

    expect(requirements.extra?.channelState).toMatchObject({
      channelId,
      chargedCumulativeAmount: "1000",
    });
    expect(requirements.extra?.voucherState).toMatchObject({ signedMaxClaimable: "1000" });
  });
});

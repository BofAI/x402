import { beforeAll, describe, expect, it } from "vitest";
import { TronWeb } from "tronweb";
import { privateKeyTronWallet } from "../helpers";
import type { ClientTronSigner } from "../../../src/signer";
import { normalizeAddressForSigning } from "../../../src/utils";
import { computeChannelId } from "../../../src/shared/batch-settlement/utils";
import { BatchSettlementTronScheme } from "../../../src/batch-settlement/client/scheme";
import { InMemoryClientChannelStorage } from "../../../src/batch-settlement/client/storage";
import type {
  BatchSettlementDepositPayload,
  BatchSettlementVoucherPayload,
} from "../../../src/batch-settlement/types";
import type { PaymentRequirements } from "@bankofai/x402-core/types";

/**
 * Offline coverage of the batch-settlement client decision logic that drives the
 * on-chain flow: when to issue a gasless voucher vs an on-chain deposit/top-up,
 * and how the cumulative voucher ceiling advances across charges.
 */

const NETWORK = "tron:3448148188";
const PAYER_PK = "da146374a75310b9666e834ee4ad0866d6f4035967bfc76217c5a495fff9f0d0";
const PAY_TO = "TJRyWwFs9wTFGZg3JbrVriFbNfCug5tDeC";

const requirements = {
  scheme: "batch-settlement",
  network: NETWORK,
  asset: "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf",
  amount: "100000",
  payTo: PAY_TO,
  maxTimeoutSeconds: 600,
  extra: {
    name: "Tether USD",
    version: "1",
    receiverAuthorizer: PAY_TO,
    withdrawDelay: 900,
    assetTransferMethod: "permit2",
  },
} as unknown as PaymentRequirements;

describe("batch-settlement client lifecycle (TRON, offline)", () => {
  let wallet: ReturnType<typeof privateKeyTronWallet>;
  let address: string;

  beforeAll(() => {
    const tronWeb = new TronWeb({ fullHost: "https://nile.trongrid.io", privateKey: PAYER_PK });
    wallet = privateKeyTronWallet(tronWeb, PAYER_PK);
    address = TronWeb.address.fromPrivateKey(PAYER_PK) as string;
  });

  /**
   * Build a client signer with a controllable `readContract` for channel reads,
   * so the lifecycle can be exercised without any network access.
   *
   * @param channelState - The `[balance, totalClaimed]` the channel read returns.
   * @returns A {@link ClientTronSigner}.
   */
  function makeSigner(channelState: [bigint, bigint]): ClientTronSigner {
    return {
      address,
      signTypedData: args => wallet.signTypedData(args),
      async readContract() {
        return channelState;
      },
    };
  }

  it("issues an initial deposit when the channel is empty", async () => {
    const signer = makeSigner([0n, 0n]);
    const scheme = new BatchSettlementTronScheme(signer, {
      storage: new InMemoryClientChannelStorage(),
    });
    const result = await scheme.createPaymentPayload(2, requirements);
    const payload = result.payload as BatchSettlementDepositPayload;
    expect(payload.type).toBe("deposit");
    // Default 5x multiplier on the 100000 charge.
    expect(payload.deposit.amount).toBe("500000");
    // Voucher ceiling for the first charge equals the request amount.
    expect(payload.voucher.maxClaimableAmount).toBe("100000");
    // Permit2 deposit path, bound to the channel.
    expect(payload.deposit.authorization.permit2Authorization).toBeDefined();
    expect(payload.deposit.authorization.permit2Authorization!.witness.channelId).toBe(
      payload.voucher.channelId,
    );
  });

  it("issues a gasless voucher (no deposit) when the channel has surplus balance", async () => {
    const storage = new InMemoryClientChannelStorage();
    const config = {
      payer: normalizeAddressForSigning(address),
      payerAuthorizer: normalizeAddressForSigning(address),
      receiver: normalizeAddressForSigning(PAY_TO),
      receiverAuthorizer: normalizeAddressForSigning(PAY_TO),
      token: normalizeAddressForSigning(requirements.asset),
      withdrawDelay: 900,
      salt: `0x${"00".repeat(32)}` as `0x${string}`,
    };
    const channelId = computeChannelId(config, NETWORK);
    // Surplus balance already on-chain, one prior charge of 100000.
    await storage.set(channelId.toLowerCase(), {
      balance: "500000",
      chargedCumulativeAmount: "100000",
      totalClaimed: "0",
    });

    const signer = makeSigner([500000n, 0n]);
    const scheme = new BatchSettlementTronScheme(signer, { storage });
    const result = await scheme.createPaymentPayload(2, requirements);
    const payload = result.payload as BatchSettlementVoucherPayload;
    expect(payload.type).toBe("voucher");
    // Cumulative ceiling advances: prior 100000 + this 100000.
    expect(payload.voucher.maxClaimableAmount).toBe("200000");
    expect(payload.voucher.channelId).toBe(channelId);
  });

  it("tops up with a deposit when the next charge would exceed the balance", async () => {
    const storage = new InMemoryClientChannelStorage();
    const config = {
      payer: normalizeAddressForSigning(address),
      payerAuthorizer: normalizeAddressForSigning(address),
      receiver: normalizeAddressForSigning(PAY_TO),
      receiverAuthorizer: normalizeAddressForSigning(PAY_TO),
      token: normalizeAddressForSigning(requirements.asset),
      withdrawDelay: 900,
      salt: `0x${"00".repeat(32)}` as `0x${string}`,
    };
    const channelId = computeChannelId(config, NETWORK);
    // Balance below the next cumulative ceiling (150000 < 100000 + 100000).
    await storage.set(channelId.toLowerCase(), {
      balance: "150000",
      chargedCumulativeAmount: "100000",
      totalClaimed: "0",
    });

    const signer = makeSigner([150000n, 0n]);
    const scheme = new BatchSettlementTronScheme(signer, { storage });
    const result = await scheme.createPaymentPayload(2, requirements);
    const payload = result.payload as BatchSettlementDepositPayload;
    expect(payload.type).toBe("deposit");
    expect(payload.voucher.maxClaimableAmount).toBe("200000");
  });

  it("advances the cumulative ceiling across successive vouchers", async () => {
    const storage = new InMemoryClientChannelStorage();
    // Empty channel on-chain → first charge opens it with a deposit; later charges
    // read the pre-seeded storage below (no further chain reads).
    const signer = makeSigner([0n, 0n]);
    const scheme = new BatchSettlementTronScheme(signer, { storage });

    // First charge → deposit, ceiling 100000.
    const first = (await scheme.createPaymentPayload(2, requirements))
      .payload as BatchSettlementDepositPayload;
    expect(first.type).toBe("deposit");
    const channelId = first.voucher.channelId;

    // Simulate the server crediting the channel after the deposit settled.
    await storage.set(channelId.toLowerCase(), {
      balance: "500000",
      chargedCumulativeAmount: "100000",
      totalClaimed: "0",
    });

    // Second and third charges → gasless vouchers, ceiling climbs 200000 → 300000.
    const second = (await scheme.createPaymentPayload(2, requirements))
      .payload as BatchSettlementVoucherPayload;
    expect(second.type).toBe("voucher");
    expect(second.voucher.maxClaimableAmount).toBe("200000");

    await storage.set(channelId.toLowerCase(), {
      balance: "500000",
      chargedCumulativeAmount: "200000",
      totalClaimed: "0",
    });

    const third = (await scheme.createPaymentPayload(2, requirements))
      .payload as BatchSettlementVoucherPayload;
    expect(third.type).toBe("voucher");
    expect(third.voucher.maxClaimableAmount).toBe("300000");
  });
});

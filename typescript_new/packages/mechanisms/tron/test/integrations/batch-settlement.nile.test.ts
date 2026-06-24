import { beforeAll, describe, expect, it } from "vitest";
import { TronWeb } from "tronweb";
import type { PaymentPayload, PaymentRequirements } from "@bankofai/x402-core/types";
import type { FacilitatorClient } from "@bankofai/x402-core/server";
import { BatchSettlementTronScheme } from "../../src/batch-settlement/server/scheme";
import { BatchSettlementChannelManager } from "../../src/batch-settlement/server/channelManager";
import { BatchSettlementTronScheme as BatchSettlementFacilitator } from "../../src/batch-settlement/facilitator/scheme";
import { BatchSettlementTronScheme as BatchSettlementClient } from "../../src/batch-settlement/client/scheme";
import type { Channel } from "../../src/batch-settlement/server/storage";
import type {
  TronAuthorizerSigner,
  BatchSettlementDepositPayload,
} from "../../src/batch-settlement/types";
import { computeChannelId } from "../../src/shared/batch-settlement/utils";
import {
  createClientTronSigner,
  createFacilitatorTronSigner,
  type ClientTronSigner,
  type FacilitatorTronSigner,
} from "../../src/signer";
import {
  PERMIT2_ADDRESSES,
  erc20AllowanceAbi,
  transferWithAuthorizationABI,
} from "../../src/constants";
import {
  loadNileEnv,
  nileTronWeb,
  tronAgentWallet,
  toClientAgentWallet,
  toFacilitatorAgentWallet,
  toBigInt,
  NILE,
} from "./helpers";

/**
 * Real on-chain e2e for the `batch-settlement` scheme on TRON Nile.
 *
 * Exercises the three chain-specific contract calls end-to-end:
 *   1. deposit()             — open/top-up the channel via Permit2 collector
 *   2. claimWithSignature()  — receiver-authorizer batch claim of one voucher
 *   3. settle()              — transfer claimed funds to payTo
 *
 * Skips without credentials, and skips the on-chain case if the payer has not
 * granted the one-time Permit2 allowance.
 */

const env = loadNileEnv();
const ABI_ALLOWANCE = erc20AllowanceAbi as unknown as readonly Record<string, unknown>[];
const ABI_ERC20 = transferWithAuthorizationABI as unknown as readonly Record<string, unknown>[];

/**
 * Build a {@link TronAuthorizerSigner} from a raw private key (receiver-authorizer
 * that signs claim/refund digests).
 *
 * @param tronWeb - TronWeb instance used for TIP-712 signing.
 * @param privateKey - The authorizer private key.
 * @returns An authorizer signer.
 */
function authorizerFromKey(tronWeb: TronWeb, privateKey: string): TronAuthorizerSigner {
  const clean = privateKey.replace(/^0x/, "");
  const address = TronWeb.address.fromPrivateKey(clean) as string;
  return {
    address,
    async signTypedData(args) {
      const sig = await tronWeb.trx._signTypedData(args.domain, args.types, args.message, clean);
      return (sig.startsWith("0x") ? sig : `0x${sig}`) as `0x${string}`;
    },
  };
}

describe.skipIf(!env)("Nile e2e — batch-settlement lifecycle", () => {
  const e = env!;
  let server: BatchSettlementTronScheme;
  let facilitator: BatchSettlementFacilitator;
  let client: BatchSettlementClient;
  let clientSigner: ClientTronSigner;
  let facSigner: FacilitatorTronSigner;
  let authorizer: TronAuthorizerSigner;
  let req: PaymentRequirements;

  beforeAll(async () => {
    // facTw is still needed for the receiver-authorizer below; the signer
    // factories build their own TronWeb internally from the network.
    const facTw = nileTronWeb(e.facilitatorPk, e.apiKey);

    clientSigner = await createClientTronSigner(toClientAgentWallet(tronAgentWallet(e.payerPk)), {
      network: NILE,
      apiKey: e.apiKey,
    });
    const facWallet = toFacilitatorAgentWallet(tronAgentWallet(e.facilitatorPk));
    facSigner = await createFacilitatorTronSigner(facWallet, { network: NILE, apiKey: e.apiKey });

    // Receiver-authorizer signs claim/refund digests. Use a dedicated key when
    // provided, else reuse the facilitator key.
    authorizer = authorizerFromKey(facTw, process.env.AUTHORIZER_PRIVATE_KEY ?? e.facilitatorPk);

    // Random salt → a fresh channel per run, so deposit→claim→settle is clean
    // and repeatable (channels are keyed by ChannelConfig incl. salt).
    const saltBytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
    const salt = `0x${Array.from(saltBytes)
      .map(b => b.toString(16).padStart(2, "0"))
      .join("")}` as `0x${string}`;

    server = new BatchSettlementTronScheme(e.payTo, { receiverAuthorizerSigner: authorizer });
    facilitator = new BatchSettlementFacilitator(facSigner, authorizer);
    client = new BatchSettlementClient(clientSigner, { salt });

    const amount = await server.parsePrice("$0.1", NILE);
    const supported = facilitator.getExtra(NILE) ?? {};
    const base = {
      scheme: "batch-settlement",
      network: NILE,
      asset: amount.asset,
      amount: amount.amount,
      payTo: e.payTo,
      maxTimeoutSeconds: 600,
      extra: amount.extra ?? {},
    } as unknown as PaymentRequirements;
    req = await server.enhancePaymentRequirements(
      base,
      { x402Version: 2, scheme: "batch-settlement", network: NILE, extra: supported },
      [],
    );
  });

  it("negotiates a batch-settlement requirement with receiverAuthorizer", () => {
    expect(req.amount).toBe("100000"); // 0.1 USDT, 6 decimals
    expect(req.extra?.receiverAuthorizer).toBe(authorizer.address);
    expect(req.extra?.assetTransferMethod).toBe("permit2");
  });

  it("deposits, claims a voucher, and settles to payTo", async ctx => {
    // Permit2 deposit collector pulls via Permit2 → payer must have approved Permit2.
    const permit2 = PERMIT2_ADDRESSES[NILE]!;
    const allowance = toBigInt(
      await clientSigner.readContract({
        address: req.asset,
        abi: ABI_ALLOWANCE,
        functionName: "allowance",
        args: [clientSigner.address, permit2],
      }),
    );
    if (allowance < 500_000n) {
      // One-time Permit2 approval not granted (need ≥ 0.5 USDT for the 5x deposit).
      ctx.skip();
      return;
    }

    const config = client.buildChannelConfig(req);
    const channelId = computeChannelId(config, NILE);

    // 1) DEPOSIT — first payment opens the channel (deposit + voucher payload).
    const depositResult = await client.createPaymentPayload(2, req);
    const depositPayload = {
      x402Version: 2,
      accepted: req,
      payload: depositResult.payload,
    } as unknown as PaymentPayload;
    const depositRaw = depositResult.payload as BatchSettlementDepositPayload;
    expect(depositRaw.type).toBe("deposit");

    const depVerify = await facilitator.verify(depositPayload, req);
    expect(depVerify.isValid).toBe(true);

    const depSettle = await facilitator.settle(depositPayload, req);
    if (!depSettle.success) {
      console.error("[e2e deposit failed]", depSettle);
    }
    expect(depSettle.success).toBe(true);
    expect(depSettle.transaction).toBeTruthy();

    const channelStateExtra = depSettle.extra?.channelState as
      | { balance: string; totalClaimed: string }
      | undefined;
    expect(channelStateExtra).toBeDefined();
    expect(BigInt(channelStateExtra!.balance)).toBeGreaterThanOrEqual(BigInt(req.amount));

    // 2) Record the channel server-side so the manager can claim the voucher.
    // (In production the server hooks persist this during verify/settle.)
    const charged = depositRaw.voucher.maxClaimableAmount; // == req.amount on first deposit
    const channel: Channel = {
      channelId,
      channelConfig: config,
      chargedCumulativeAmount: charged,
      signedMaxClaimable: depositRaw.voucher.maxClaimableAmount,
      signature: depositRaw.voucher.signature,
      balance: channelStateExtra!.balance,
      totalClaimed: channelStateExtra!.totalClaimed,
      withdrawRequestedAt: 0,
      refundNonce: 0,
      lastRequestTimestamp: Date.now(),
    };
    await server.getStorage().updateChannel(channelId, () => channel);

    const payToBefore = toBigInt(
      await facSigner.readContract({
        address: req.asset,
        abi: ABI_ERC20,
        functionName: "balanceOf",
        args: [e.payTo],
      }),
    );

    // 3) CLAIM + SETTLE on-chain via the channel manager.
    // The manager only calls facilitator.settle(); adapt the scheme to the
    // FacilitatorClient shape it expects.
    const facilitatorClient: FacilitatorClient = {
      verify: (p, r) => facilitator.verify(p, r),
      settle: (p, r) => facilitator.settle(p, r),
      getSupported: async () => ({ kinds: [], extensions: [], signers: {} }),
    };
    const manager = new BatchSettlementChannelManager({
      scheme: server,
      facilitator: facilitatorClient,
      receiver: e.payTo,
      token: req.asset,
      network: NILE,
    });

    const claims = await manager.claim();
    expect(claims.length).toBeGreaterThan(0);
    expect(claims[0].vouchers).toBe(1);
    expect(claims[0].transaction).toBeTruthy();

    const settle = await manager.settle();
    expect(settle?.transaction).toBeTruthy();

    const payToAfter = toBigInt(
      await facSigner.readContract({
        address: req.asset,
        abi: ABI_ERC20,
        functionName: "balanceOf",
        args: [e.payTo],
      }),
    );

    console.log("[e2e batch-settlement]", {
      payer: clientSigner.address,
      payTo: e.payTo,
      channelId,
      deposit: depSettle.transaction,
      claim: claims[0].transaction,
      settle: settle?.transaction,
      payToBefore: payToBefore.toString(),
      payToAfter: payToAfter.toString(),
    });

    // settle() transfers the outstanding claimed balance to payTo. It drains all
    // unsettled claims for (payTo, token), so the credit is at least this run's
    // claimed amount (more if a prior run claimed without settling).
    expect(payToAfter - payToBefore).toBeGreaterThanOrEqual(BigInt(req.amount));
  }, 600_000);

  it("deposits then cooperatively refunds the remaining balance to the payer", async ctx => {
    const permit2 = PERMIT2_ADDRESSES[NILE]!;
    const allowance = toBigInt(
      await clientSigner.readContract({
        address: req.asset,
        abi: ABI_ALLOWANCE,
        functionName: "allowance",
        args: [clientSigner.address, permit2],
      }),
    );
    if (allowance < 500_000n) {
      ctx.skip();
      return;
    }

    // Fresh channel for an isolated refund lifecycle.
    const saltBytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
    const salt = `0x${Array.from(saltBytes)
      .map(b => b.toString(16).padStart(2, "0"))
      .join("")}` as `0x${string}`;
    const refundClient = new BatchSettlementClient(clientSigner, { salt });
    const config = refundClient.buildChannelConfig(req);
    const channelId = computeChannelId(config, NILE);

    // 1) DEPOSIT (5x → 500000), charging 100000.
    const depositResult = await refundClient.createPaymentPayload(2, req);
    const depositRaw = depositResult.payload as BatchSettlementDepositPayload;
    expect(depositRaw.type).toBe("deposit");
    const depSettle = await facilitator.settle(
      {
        x402Version: 2,
        accepted: req,
        payload: depositResult.payload,
      } as unknown as PaymentPayload,
      req,
    );
    expect(depSettle.success).toBe(true);
    const depState = depSettle.extra?.channelState as { balance: string; totalClaimed: string };

    // Record the channel so the manager can build the cooperative refund.
    await server.getStorage().updateChannel(channelId, () => ({
      channelId,
      channelConfig: config,
      chargedCumulativeAmount: depositRaw.voucher.maxClaimableAmount,
      signedMaxClaimable: depositRaw.voucher.maxClaimableAmount,
      signature: depositRaw.voucher.signature,
      balance: depState.balance,
      totalClaimed: depState.totalClaimed,
      withdrawRequestedAt: 0,
      refundNonce: 0,
      lastRequestTimestamp: Date.now(),
    }));

    // 2) REFUND — claims the charged 100000 and refunds the remaining 400000 via
    // the contract's multicall(claimWithSignature, refundWithSignature).
    const facilitatorClient: FacilitatorClient = {
      verify: (p, r) => facilitator.verify(p, r),
      settle: (p, r) => facilitator.settle(p, r),
      getSupported: async () => ({ kinds: [], extensions: [], signers: {} }),
    };
    const manager = new BatchSettlementChannelManager({
      scheme: server,
      facilitator: facilitatorClient,
      receiver: e.payTo,
      token: req.asset,
      network: NILE,
    });

    const refunds = await manager.refund([channelId]);
    console.log("[e2e refund]", refunds);
    expect(refunds.length).toBe(1);
    expect(refunds[0].transaction).toBeTruthy();
    expect(refunds[0].channel.toLowerCase()).toBe(channelId.toLowerCase());

    // Channel record is removed after a successful cooperative refund.
    expect(await server.getStorage().get(channelId)).toBeUndefined();

    // On-chain channel balance dropped (refund drained the unclaimed remainder).
    const onchain = await facSigner.readContract({
      address: "TWBwWHZWwH8TzrZnbxit1J645VGYY1K2fA",
      abi: [
        {
          type: "function",
          name: "channels",
          inputs: [{ name: "channelId", type: "bytes32" }],
          outputs: [
            { name: "balance", type: "uint128" },
            { name: "totalClaimed", type: "uint128" },
          ],
          stateMutability: "view",
        },
      ] as unknown as readonly Record<string, unknown>[],
      functionName: "channels",
      args: [channelId],
    });
    const balAfter = toBigInt(Array.isArray(onchain) ? onchain[0] : onchain);
    console.log("[e2e refund channel balance after]", balAfter.toString());
    expect(balAfter).toBeLessThan(BigInt(depState.balance));
  }, 600_000);
});

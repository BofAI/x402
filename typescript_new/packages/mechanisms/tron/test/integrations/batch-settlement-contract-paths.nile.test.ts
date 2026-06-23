import { beforeAll, describe, expect, it } from "vitest";
import { TronWeb } from "tronweb";
import type { PaymentPayload, PaymentRequirements } from "@bankofai/x402-core/types";
import { BatchSettlementServerScheme } from "../../src/batch-settlement/server/scheme";
import { BatchSettlementTronScheme as BatchSettlementFacilitator } from "../../src/batch-settlement/facilitator/scheme";
import { BatchSettlementTronScheme as BatchSettlementClient } from "../../src/batch-settlement/client/scheme";
import type {
  TronAuthorizerSigner,
  BatchSettlementDepositPayload,
  ChannelConfig,
} from "../../src/batch-settlement/types";
import { computeChannelId } from "../../src/shared/batch-settlement/utils";
import { batchSettlementABI } from "../../src/shared/batch-settlement/abi";
import { getBatchSettlementAddress } from "../../src/shared/batch-settlement/constants";
import { toContractChannelConfig } from "../../src/batch-settlement/facilitator/utils";
import { buildVoucherClaimArgs } from "../../src/batch-settlement/facilitator/claim";
import {
  createClientTronSigner,
  createFacilitatorTronSigner,
  type ClientTronSigner,
  type FacilitatorTronSigner,
} from "../../src/signer";
import { PERMIT2_ADDRESSES, erc20AllowanceAbi } from "../../src/constants";
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
 * On-chain e2e for batch-settlement contract functions that the SDK schemes do
 * not wrap (mirroring EVM, which also exposes them only at the contract level):
 *   - claim()            — no-signature batch claim by the receiver-authorizer
 *   - refund()           — no-signature cooperative refund by the receiver-authorizer
 *   - initiateWithdraw() — payer-initiated uncooperative withdrawal (starts timelock)
 *   - finalizeWithdraw() — must revert before withdrawDelay elapses
 *
 * The test env uses one key for payer = facilitator = receiverAuthorizer = payTo,
 * which satisfies the contract's msg.sender checks for these direct calls.
 */

const env = loadNileEnv();
const ABI = batchSettlementABI as unknown as readonly Record<string, unknown>[];
const ABI_ALLOWANCE = erc20AllowanceAbi as unknown as readonly Record<string, unknown>[];
const CHANNELS_ABI = [
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
  {
    type: "function",
    name: "pendingWithdrawals",
    inputs: [{ name: "channelId", type: "bytes32" }],
    outputs: [
      { name: "amount", type: "uint128" },
      { name: "initiatedAt", type: "uint40" },
    ],
    stateMutability: "view",
  },
] as unknown as readonly Record<string, unknown>[];

/**
 * Build an authorizer signer from a raw private key.
 *
 * @param tronWeb - TronWeb instance for TIP-712 signing.
 * @param privateKey - The authorizer private key.
 * @returns An authorizer signer.
 */
function authorizerFromKey(tronWeb: TronWeb, privateKey: string): TronAuthorizerSigner {
  const clean = privateKey.replace(/^0x/, "");
  return {
    address: TronWeb.address.fromPrivateKey(clean) as string,
    async signTypedData(args) {
      const sig = await tronWeb.trx._signTypedData(args.domain, args.types, args.message, clean);
      return (sig.startsWith("0x") ? sig : `0x${sig}`) as `0x${string}`;
    },
  };
}

describe.skipIf(!env)("Nile e2e — batch-settlement contract direct paths", () => {
  const e = env!;
  let facSigner: FacilitatorTronSigner;
  let clientSigner: ClientTronSigner;
  let facilitator: BatchSettlementFacilitator;
  let req: PaymentRequirements;

  beforeAll(async () => {
    // facTw is still needed for the receiver-authorizer below; the signer
    // factories build their own TronWeb internally from the network.
    const facTw = nileTronWeb(e.facilitatorPk, e.apiKey);
    clientSigner = await createClientTronSigner(toClientAgentWallet(tronAgentWallet(e.payerPk)), {
      network: NILE,
      apiKey: e.apiKey,
    });
    facSigner = await createFacilitatorTronSigner(
      toFacilitatorAgentWallet(tronAgentWallet(e.facilitatorPk)),
      { network: NILE, apiKey: e.apiKey },
    );
    const authorizer = authorizerFromKey(
      facTw,
      process.env.AUTHORIZER_PRIVATE_KEY ?? e.facilitatorPk,
    );

    const server = new BatchSettlementServerScheme(e.payTo, {
      receiverAuthorizerSigner: authorizer,
    });
    facilitator = new BatchSettlementFacilitator(facSigner, authorizer);

    const amount = await server.parsePrice("$0.1", NILE);
    req = await server.enhancePaymentRequirements(
      {
        scheme: "batch-settlement",
        network: NILE,
        asset: amount.asset,
        amount: amount.amount,
        payTo: e.payTo,
        maxTimeoutSeconds: 600,
        extra: amount.extra ?? {},
      } as unknown as PaymentRequirements,
      {
        x402Version: 2,
        scheme: "batch-settlement",
        network: NILE,
        extra: facilitator.getExtra(NILE) ?? {},
      },
      [],
    );
  });

  /**
   * Open a fresh channel by depositing through the facilitator.
   *
   * @returns The channel config, id, deposit payload, and on-chain balance.
   */
  async function openChannel(): Promise<{
    config: ChannelConfig;
    channelId: `0x${string}`;
    depositRaw: BatchSettlementDepositPayload;
    balance: string;
  }> {
    const saltBytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
    const salt = `0x${Array.from(saltBytes)
      .map(b => b.toString(16).padStart(2, "0"))
      .join("")}` as `0x${string}`;
    const client = new BatchSettlementClient(clientSigner, { salt });
    const config = client.buildChannelConfig(req);
    const channelId = computeChannelId(config, NILE);
    const result = await client.createPaymentPayload(2, req);
    const depositRaw = result.payload as BatchSettlementDepositPayload;
    const settle = await facilitator.settle(
      { x402Version: 2, accepted: req, payload: result.payload } as unknown as PaymentPayload,
      req,
    );
    expect(settle.success).toBe(true);
    const balance = (settle.extra?.channelState as { balance: string }).balance;
    return { config, channelId, depositRaw, balance };
  }

  /**
   * Read a channel's on-chain `[balance, totalClaimed]`.
   *
   * @param channelId - The channel id.
   * @returns Tuple of balance and totalClaimed.
   */
  async function readChannel(channelId: `0x${string}`): Promise<[bigint, bigint]> {
    const r = await facSigner.readContract({
      address: getBatchSettlementAddress(NILE),
      abi: CHANNELS_ABI,
      functionName: "channels",
      args: [channelId],
    });
    return Array.isArray(r)
      ? [toBigInt(r[0]), toBigInt(r[1])]
      : [
          toBigInt((r as Record<string, unknown>).balance),
          toBigInt((r as Record<string, unknown>).totalClaimed),
        ];
  }

  function ensureAllowance(ctx: { skip: () => void }): Promise<boolean> {
    return clientSigner
      .readContract({
        address: req.asset,
        abi: ABI_ALLOWANCE,
        functionName: "allowance",
        args: [clientSigner.address, PERMIT2_ADDRESSES[NILE]!],
      })
      .then(a => {
        if (toBigInt(a) < 500_000n) {
          ctx.skip();
          return false;
        }
        return true;
      });
  }

  it("claim() and refund() with no signature, called by the receiver-authorizer", async ctx => {
    if (!(await ensureAllowance(ctx))) return;
    const { config, channelId, depositRaw } = await openChannel();

    // No-signature claim(): valid because msg.sender == receiverAuthorizer.
    const claimArgs = buildVoucherClaimArgs([
      {
        voucher: { channel: config, maxClaimableAmount: depositRaw.voucher.maxClaimableAmount },
        signature: depositRaw.voucher.signature,
        totalClaimed: depositRaw.voucher.maxClaimableAmount,
      },
    ]);
    const claimTx = await facSigner.writeContract({
      address: getBatchSettlementAddress(NILE),
      abi: ABI,
      functionName: "claim",
      args: [claimArgs],
    });
    expect((await facSigner.waitForTransactionReceipt({ hash: claimTx })).status).toBe("success");
    const [, claimedAfter] = await readChannel(channelId);
    expect(claimedAfter).toBe(BigInt(depositRaw.voucher.maxClaimableAmount));

    // No-signature refund(): refunds the unclaimed remainder to the payer.
    const [balBefore] = await readChannel(channelId);
    const unclaimed = balBefore - claimedAfter;
    const refundTx = await facSigner.writeContract({
      address: getBatchSettlementAddress(NILE),
      abi: ABI,
      functionName: "refund",
      args: [toContractChannelConfig(config), unclaimed],
    });
    expect((await facSigner.waitForTransactionReceipt({ hash: refundTx })).status).toBe("success");
    const [balAfter] = await readChannel(channelId);
    console.log("[e2e no-sig claim/refund]", {
      claimTx,
      refundTx,
      balBefore: balBefore.toString(),
      balAfter: balAfter.toString(),
    });
    expect(balAfter).toBeLessThan(balBefore);
  }, 600_000);

  it("initiateWithdraw() succeeds and finalizeWithdraw() reverts before the delay", async ctx => {
    if (!(await ensureAllowance(ctx))) return;
    const { config, channelId, balance } = await openChannel();

    // Payer initiates an uncooperative withdrawal (msg.sender == payer).
    const initTx = await facSigner.writeContract({
      address: getBatchSettlementAddress(NILE),
      abi: ABI,
      functionName: "initiateWithdraw",
      args: [toContractChannelConfig(config), BigInt(balance)],
    });
    expect((await facSigner.waitForTransactionReceipt({ hash: initTx })).status).toBe("success");

    const pending = await facSigner.readContract({
      address: getBatchSettlementAddress(NILE),
      abi: CHANNELS_ABI,
      functionName: "pendingWithdrawals",
      args: [channelId],
    });
    const initiatedAt = Array.isArray(pending)
      ? toBigInt(pending[1])
      : toBigInt((pending as Record<string, unknown>).initiatedAt);
    console.log("[e2e withdraw] initiated", { initTx, initiatedAt: initiatedAt.toString() });
    expect(initiatedAt).toBeGreaterThan(0n);

    // finalizeWithdraw() before withdrawDelay (≥15min) must fail.
    let finalizeFailed = false;
    try {
      const finTx = await facSigner.writeContract({
        address: getBatchSettlementAddress(NILE),
        abi: ABI,
        functionName: "finalizeWithdraw",
        args: [toContractChannelConfig(config)],
      });
      const receipt = await facSigner.waitForTransactionReceipt({ hash: finTx });
      finalizeFailed = receipt.status !== "success";
    } catch {
      // triggerSmartContract rejects the reverting call at build time.
      finalizeFailed = true;
    }
    expect(finalizeFailed).toBe(true);
  }, 600_000);
});

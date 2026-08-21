import { describe, expect, it } from "vitest";
import { TronWeb } from "tronweb";
import { x402Facilitator } from "@bankofai/x402-core/facilitator";
import type { PaymentPayload, PaymentRequirements } from "@bankofai/x402-core/types";
import {
  createTrc20ApprovalResourceSponsoringExtension,
  declareTrc20ApprovalResourceSponsoringExtension,
} from "../../../../extensions/src/trc20-approval-resource-sponsoring";
import { PERMIT2_ADDRESSES, TRON_NILE } from "../../src/constants";
import { ExactTronScheme as ExactClient } from "../../src/exact/client/scheme";
import {
  ExactTronScheme as ExactFacilitator,
  createTrc20ResourceSponsoringRuntime,
  InMemoryTrc20SponsoringCoordinator,
} from "../../src/exact/facilitator";
import { ExactTronScheme as ExactServer } from "../../src/exact/server/scheme";
import {
  createClientTronSigner,
  createFacilitatorTronSigner,
  type ClientTronWallet,
  type FacilitatorTronWallet,
} from "../../src/signer";

const USDT_NILE = "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf";
const PERMIT2_NILE = PERMIT2_ADDRESSES[TRON_NILE];
if (!PERMIT2_NILE) throw new Error("Nile Permit2 address is not configured");
const RESET_APPROVAL_FEE_LIMIT_SUN = 100_000_000;
const FRESH_PAYER_TRX_SUN = 2_000_000;
const FRESH_PAYER_USDT_UNITS = 1_000_000;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the Nile integration test`);
  return value;
}

function privateKeyWallet(
  tronWeb: TronWeb,
  privateKey: string,
): ClientTronWallet & FacilitatorTronWallet {
  const clean = privateKey.replace(/^0x/, "");
  const address = TronWeb.address.fromPrivateKey(clean) as string;
  return {
    getAddress: () => address,
    async signTypedData(args) {
      return (await tronWeb.trx._signTypedData(
        args.domain,
        args.types,
        args.message,
        clean,
      )) as `0x${string}`;
    },
    signTransaction: transaction => tronWeb.trx.sign(transaction, clean),
  };
}

async function readAllowance(tronWeb: TronWeb, payer: string): Promise<bigint> {
  const token = await tronWeb.contract().at(USDT_NILE);
  return BigInt(await token.allowance(payer, PERMIT2_NILE).call());
}

async function waitForPackedTransaction(tronWeb: TronWeb, txID: string): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const info = (await tronWeb.fullNode.request(
      "wallet/gettransactioninfobyid",
      { value: txID },
      "post",
    )) as { blockNumber?: number; receipt?: { result?: string } };
    if (info.blockNumber) {
      // System transactions such as TransferContract omit receipt.result on
      // success; TVM contract calls report the explicit SUCCESS value.
      if (info.receipt?.result && info.receipt.result !== "SUCCESS") {
        throw new Error(`Nile setup transaction failed: ${txID}`);
      }
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 1_000));
  }
  throw new Error(`Timed out waiting for Nile setup transaction ${txID}`);
}

async function signBroadcastAndWait(
  tronWeb: TronWeb,
  transaction: Record<string, unknown>,
  privateKey: string,
): Promise<string> {
  const signed = await tronWeb.trx.sign(transaction, privateKey);
  const broadcast = await tronWeb.trx.sendRawTransaction(signed);
  if (!broadcast.result || !broadcast.txid) {
    throw new Error(`Nile setup broadcast failed: ${JSON.stringify(broadcast)}`);
  }
  await waitForPackedTransaction(tronWeb, broadcast.txid);
  return broadcast.txid;
}

async function fundFreshPayer(
  tronWeb: TronWeb,
  resourceOwner: string,
  resourceOwnerKey: string,
  payer: string,
  permissionId: number,
): Promise<void> {
  const permission = permissionId > 0 ? { permissionId } : {};
  const activation = await tronWeb.transactionBuilder.sendTrx(
    payer,
    FRESH_PAYER_TRX_SUN,
    resourceOwner,
    permission,
  );
  const activationTxID = await signBroadcastAndWait(
    tronWeb,
    activation as unknown as Record<string, unknown>,
    resourceOwnerKey,
  );

  const transfer = await tronWeb.transactionBuilder.triggerSmartContract(
    USDT_NILE,
    "transfer(address,uint256)",
    { feeLimit: RESET_APPROVAL_FEE_LIMIT_SUN, callValue: 0, ...permission },
    [
      { type: "address", value: payer },
      { type: "uint256", value: FRESH_PAYER_USDT_UNITS },
    ],
    resourceOwner,
  );
  if (!transfer.result.result) throw new Error("Unable to build the Nile payer funding transfer");
  const fundingTxID = await signBroadcastAndWait(
    tronWeb,
    transfer.transaction as unknown as Record<string, unknown>,
    resourceOwnerKey,
  );
  console.info("[nile] fresh payer funded", { payer, activationTxID, fundingTxID });
}

async function waitForActivatedAccount(tronWeb: TronWeb, payer: string): Promise<void> {
  // Nile may expose the activation transaction receipt before the account
  // index used by wallet/getaccount catches up.
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if ((await tronWeb.trx.getAccount(payer)).address) return;
    await new Promise(resolve => setTimeout(resolve, 1_000));
  }
  throw new Error(`Timed out waiting for fresh Nile payer activation: ${payer}`);
}

async function resetAllowanceForRepeatableRun(tronWeb: TronWeb, payer: string): Promise<void> {
  if ((await readAllowance(tronWeb, payer)) === 0n) return;

  const token = await tronWeb.contract().at(USDT_NILE);
  const transaction = await token
    .approve(PERMIT2_NILE, 0)
    .send({ feeLimit: RESET_APPROVAL_FEE_LIMIT_SUN });
  console.info("[nile] reset allowance", transaction);

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if ((await readAllowance(tronWeb, payer)) === 0n) return;
    await new Promise(resolve => setTimeout(resolve, 1_000));
  }
  throw new Error("Timed out waiting for the Nile Permit2 allowance reset");
}

const configured =
  (!!process.env.TRON_NILE_CLIENT_KEY || process.env.TRON_NILE_FRESH_PAYER === "true") &&
  !!process.env.TRON_NILE_FACILITATOR_KEY &&
  !!process.env.TRON_NILE_PAY_TO;

describe.skipIf(!configured)("TRC-20 Approval Resource Sponsoring on Nile", () => {
  it("runs the local Server, Client, and Facilitator lifecycle on-chain", async () => {
    const rpcUrl = process.env.TRON_NILE_RPC_URL?.trim() || "https://api.nileex.io";
    const resourceOwnerKey = required("TRON_NILE_FACILITATOR_KEY").replace(/^0x/, "");
    const payTo = required("TRON_NILE_PAY_TO");
    const permissionId = Number.parseInt(
      process.env.TRON_NILE_FACILITATOR_PERMISSION_ID || "0",
      10,
    );
    const freshPayer = process.env.TRON_NILE_FRESH_PAYER === "true";
    const payerKey = freshPayer
      ? (await TronWeb.createAccount()).privateKey
      : required("TRON_NILE_CLIENT_KEY").replace(/^0x/, "");

    const payerTronWeb = new TronWeb({ fullHost: rpcUrl, privateKey: payerKey });
    const ownerTronWeb = new TronWeb({ fullHost: rpcUrl, privateKey: resourceOwnerKey });
    const payerWallet = privateKeyWallet(payerTronWeb, payerKey);
    const resourceOwnerWallet = privateKeyWallet(ownerTronWeb, resourceOwnerKey);
    const payer = await payerWallet.getAddress();
    const resourceOwner = await resourceOwnerWallet.getAddress();

    if (freshPayer) {
      await fundFreshPayer(ownerTronWeb, resourceOwner, resourceOwnerKey, payer, permissionId);
      await waitForActivatedAccount(payerTronWeb, payer);
    }

    const clientSigner = await createClientTronSigner(payerWallet, {
      network: TRON_NILE,
      rpcUrl,
    });
    const facilitatorSigner = await createFacilitatorTronSigner(resourceOwnerWallet, {
      network: TRON_NILE,
      rpcUrl,
      ...(permissionId > 0 ? { permissionId } : {}),
    });
    const runtime = await createTrc20ResourceSponsoringRuntime({
      network: TRON_NILE,
      rpcUrl,
      resourceOwnerWallet,
      coordinator: new InMemoryTrc20SponsoringCoordinator(),
      allowedAssets: [USDT_NILE],
      confirmationMode: "packed",
      ...(permissionId > 0 ? { permissionId } : {}),
    });

    const server = new ExactServer();
    const client = new ExactClient(clientSigner);
    const facilitatorScheme = new ExactFacilitator(facilitatorSigner);
    const facilitator = new x402Facilitator()
      .register(TRON_NILE, facilitatorScheme)
      .registerExtension(createTrc20ApprovalResourceSponsoringExtension(runtime));

    // A successful run leaves MaxUint allowance by design. Reset it before the
    // measured Sponsor flow so the same funded Nile accounts can run this test
    // repeatedly. The reset is test setup and is excluded from the zero-TRX
    // assertion below.
    if (!freshPayer) await resetAllowanceForRepeatableRun(payerTronWeb, payer);
    const payerTrxBefore = await payerTronWeb.trx.getBalance(payer);

    const parsed = await server.parsePrice("0.001 USDT", TRON_NILE);
    const requirements = await server.enhancePaymentRequirements(
      {
        scheme: "exact",
        network: TRON_NILE,
        asset: parsed.asset,
        amount: parsed.amount,
        payTo,
        maxTimeoutSeconds: 600,
        extra: { ...parsed.extra, assetTransferMethod: "permit2" },
      } as PaymentRequirements,
      {
        x402Version: 2,
        scheme: "exact",
        network: TRON_NILE,
        extra: facilitatorScheme.getExtra(TRON_NILE),
      },
      ["trc20ApprovalResourceSponsoring"],
    );
    const extensionDeclaration = declareTrc20ApprovalResourceSponsoringExtension();
    const payloadResult = await client.createPaymentPayload(2, requirements, {
      extensions: extensionDeclaration,
    });
    const paymentPayload = {
      x402Version: 2,
      accepted: requirements,
      payload: payloadResult.payload,
      extensions: payloadResult.extensions,
    } as PaymentPayload;

    expect(paymentPayload.extensions?.trc20ApprovalResourceSponsoring).toBeDefined();
    expect(await readAllowance(payerTronWeb, payer)).toBe(0n);

    const verification = await facilitator.verify(paymentPayload, requirements);
    console.info("[nile] verification", verification);
    expect(verification.isValid).toBe(true);

    const settlement = await facilitator.settle(paymentPayload, requirements);
    console.info("[nile] settlement", settlement);
    expect(settlement.success).toBe(true);
    expect(settlement.transaction).toMatch(/^[0-9a-f]{64}$/i);

    expect(await readAllowance(payerTronWeb, payer)).toBeGreaterThanOrEqual(
      BigInt(requirements.amount),
    );
    expect(await payerTronWeb.trx.getBalance(payer)).toBe(payerTrxBefore);
    const delegated = await ownerTronWeb.trx.getDelegatedResourceV2(resourceOwner, payer, {
      confirmed: false,
    });
    expect(delegated.delegatedResource ?? []).toHaveLength(0);
  }, 180_000);
});

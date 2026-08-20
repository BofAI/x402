import { describe, expect, it } from "vitest";
import { TronWeb } from "tronweb";
import { x402Facilitator } from "@bankofai/x402-core/facilitator";
import type { PaymentPayload, PaymentRequirements } from "@bankofai/x402-core/types";
import {
  createTrc20ApprovalResourceSponsoringExtension,
  declareTrc20ApprovalResourceSponsoringExtension,
} from "../../../../extensions/src/trc20-approval-resource-sponsoring";
import { TRON_NILE } from "../../src/constants";
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

const configured =
  !!process.env.TRON_NILE_CLIENT_KEY &&
  !!process.env.TRON_NILE_FACILITATOR_KEY &&
  !!process.env.TRON_NILE_PAY_TO;

describe.skipIf(!configured)("TRC-20 Approval Resource Sponsoring on Nile", () => {
  it("runs the local Server, Client, and Facilitator lifecycle on-chain", async () => {
    const rpcUrl = process.env.TRON_NILE_RPC_URL?.trim() || "https://api.nileex.io";
    const payerKey = required("TRON_NILE_CLIENT_KEY").replace(/^0x/, "");
    const resourceOwnerKey = required("TRON_NILE_FACILITATOR_KEY").replace(/^0x/, "");
    const payTo = required("TRON_NILE_PAY_TO");
    const permissionId = Number.parseInt(
      process.env.TRON_NILE_FACILITATOR_PERMISSION_ID || "0",
      10,
    );

    const payerTronWeb = new TronWeb({ fullHost: rpcUrl, privateKey: payerKey });
    const ownerTronWeb = new TronWeb({ fullHost: rpcUrl, privateKey: resourceOwnerKey });
    const payerWallet = privateKeyWallet(payerTronWeb, payerKey);
    const resourceOwnerWallet = privateKeyWallet(ownerTronWeb, resourceOwnerKey);
    const payer = await payerWallet.getAddress();
    const resourceOwner = await resourceOwnerWallet.getAddress();

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
    const allowanceBefore = await payerTronWeb
      .contract()
      .at(USDT_NILE)
      .then(contract => contract.allowance(payer, "TYQuuhGbEMxF7nZxUHV3uHJxAVVAegNU9h").call());
    expect(BigInt(allowanceBefore)).toBe(0n);
    const payerTrxBefore = await payerTronWeb.trx.getBalance(payer);

    const verification = await facilitator.verify(paymentPayload, requirements);
    console.info("[nile] verification", verification);
    expect(verification.isValid).toBe(true);

    const settlement = await facilitator.settle(paymentPayload, requirements);
    console.info("[nile] settlement", settlement);
    expect(settlement.success).toBe(true);
    expect(settlement.transaction).toMatch(/^[0-9a-f]{64}$/i);

    const allowanceAfter = await payerTronWeb
      .contract()
      .at(USDT_NILE)
      .then(contract => contract.allowance(payer, "TYQuuhGbEMxF7nZxUHV3uHJxAVVAegNU9h").call());
    expect(BigInt(allowanceAfter)).toBeGreaterThanOrEqual(BigInt(requirements.amount));
    expect(await payerTronWeb.trx.getBalance(payer)).toBe(payerTrxBefore);
    const delegated = await ownerTronWeb.trx.getDelegatedResourceV2(resourceOwner, payer, {
      confirmed: false,
    });
    expect(delegated.delegatedResource ?? []).toHaveLength(0);
  }, 180_000);
});

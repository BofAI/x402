import {
  TRC20_APPROVAL_RESOURCE_SPONSORING_KEY,
  type Trc20ApprovalResourceSponsoringFacilitatorExtension,
} from "@bankofai/x402-tron/exact/extensions";
import {
  createClientTronSigner,
  createFacilitatorTronSigner,
  type ClientTronWallet,
  type FacilitatorTronWallet,
} from "@bankofai/x402-tron";
import assert from "node:assert/strict";
import { x402Client } from "@x402/core/client";
import { x402Facilitator } from "@x402/core/facilitator";
import { x402ResourceServer } from "@x402/core/server";
import {
  toClientTronSigner,
  type ClientTronSigner,
  type FacilitatorTronSigner,
} from "@bankofai/x402-tron";
import { ExactTronScheme as ExactClient } from "@bankofai/x402-tron/exact/client";
import { ExactTronScheme as ExactServer } from "@bankofai/x402-tron/exact/server";
import { ExactTronScheme as ExactFacilitator } from "@bankofai/x402-tron/exact/facilitator";
import * as UptoClient from "@bankofai/x402-tron/upto/client";
import * as UptoServer from "@bankofai/x402-tron/upto/server";
import * as UptoFacilitator from "@bankofai/x402-tron/upto/facilitator";
import * as GasClient from "@bankofai/x402-tron/gasfree/client";
import * as GasServer from "@bankofai/x402-tron/gasfree/server";
import * as GasFacilitator from "@bankofai/x402-tron/gasfree/facilitator";
import * as BatchClient from "@bankofai/x402-tron/batch-settlement/client";
import * as BatchServer from "@bankofai/x402-tron/batch-settlement/server";
import * as BatchFacilitator from "@bankofai/x402-tron/batch-settlement/facilitator";

async function main() {
  const network = "tron:3448148188";
  const wallet: ClientTronWallet = {
    getAddress: () => "TJRyWwFs9wTFGZg3JbrVriFbNfCug5tDeC",
    signTypedData: async () => "1234",
  };
  const walletSigner = await createClientTronSigner(wallet, {
    network,
    rpcUrl: "http://127.0.0.1:1",
  });
  assert.equal(
    await walletSigner.signTypedData({ domain: {}, types: {}, primaryType: "Test", message: {} }),
    "0x1234",
  );
  const settlementWallet: FacilitatorTronWallet = {
    getAddress: wallet.getAddress,
    signTransaction: async tx => tx,
  };
  const settlementAdapter = await createFacilitatorTronSigner(settlementWallet, {
    network,
    rpcUrl: "http://127.0.0.1:1",
    permissionId: 2,
  });
  assert.equal(settlementAdapter.getAddresses()[0], walletSigner.address);
  const extension: Trc20ApprovalResourceSponsoringFacilitatorExtension = {
    key: TRC20_APPROVAL_RESOURCE_SPONSORING_KEY,
  };
  assert.equal(extension.key, "trc20ApprovalResourceSponsoring");
  const signer: ClientTronSigner = toClientTronSigner({
    address: "0x1111111111111111111111111111111111111111",
    signTypedData: async () => "0x1234",
  });
  const settlementSigner: FacilitatorTronSigner = {
    getAddresses: () => ["0x2222222222222222222222222222222222222222"],
    readContract: async () => 1000000n,
    verifyTypedData: async () => true,
    writeContract: async () => "11".repeat(32),
    waitForTransactionReceipt: async () => ({ status: "success" }),
  };
  const facilitator = new x402Facilitator().register(
    network,
    new ExactFacilitator(settlementSigner),
  );
  const server = new x402ResourceServer({
    getSupported: async () => {
      const supported = facilitator.getSupported();
      return {
        ...supported,
        kinds: supported.kinds.map(kind => {
          assert.equal(kind.network, network);
          return { ...kind, network };
        }),
      };
    },
    verify: (p, r) => facilitator.verify(p, r),
    settle: (p, r) => facilitator.settle(p, r),
  }).register(network, new ExactServer());
  await server.initialize();
  const accepts = await server.buildPaymentRequirements({
    scheme: "exact",
    network,
    payTo: "0x2222222222222222222222222222222222222222",
    maxTimeoutSeconds: 600,
    price: {
      asset: "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf",
      amount: "1",
      extra: { name: "Test", version: "1", assetTransferMethod: "eip3009" },
    },
  });
  const client = new x402Client().register(network, new ExactClient(signer));
  const payment = await client.createPaymentPayload({
    x402Version: 2,
    accepts,
    resource: { url: "https://example.test/paid", description: "test", mimeType: "text/plain" },
  });
  assert.equal((await server.verifyPayment(payment, accepts[0])).isValid, true);
  assert.equal((await server.settlePayment(payment, accepts[0])).success, true);
  assert.equal(new UptoClient.UptoTronScheme(signer).scheme, "upto");
  assert.equal(new UptoServer.UptoTronScheme().scheme, "upto");
  assert.equal(new UptoFacilitator.UptoTronScheme(settlementSigner).scheme, "upto");
  assert.equal(
    new GasClient.ExactGasFreeTronScheme(signer, { apiClients: {} }).scheme,
    "exact_gasfree",
  );
  assert.equal(new GasServer.ExactGasFreeTronScheme().scheme, "exact_gasfree");
  assert.equal(
    new GasFacilitator.ExactGasFreeTronScheme(settlementSigner, {}).scheme,
    "exact_gasfree",
  );
  assert.equal(new BatchClient.BatchSettlementTronScheme(signer).scheme, "batch-settlement");
  assert.equal(
    new BatchServer.BatchSettlementTronScheme(signer.address).scheme,
    "batch-settlement",
  );
  assert.equal(
    new BatchFacilitator.BatchSettlementTronScheme(settlementSigner).scheme,
    "batch-settlement",
  );
}
void main();

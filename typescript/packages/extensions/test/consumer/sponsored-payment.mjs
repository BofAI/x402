import assert from "node:assert/strict";
import { createRequire } from "node:module";
const load =
  process.argv[2] === "cjs" ? createRequire(import.meta.url) : specifier => import(specifier);
const { TronWeb, utils } = await load("tronweb");
const tronSdk = await load("@bankofai/x402-tron");
const { ExactTronScheme: Client } = await load("@bankofai/x402-tron/exact/client");
const { ExactTronScheme: Facilitator } = await load("@bankofai/x402-tron/exact/facilitator");
const ext = await load("@bankofai/x402-tron-extensions");
const { x402Client } = await load("@x402/core/client");
const { x402Facilitator } = await load("@x402/core/facilitator");
const network = "tron:3448148188";
const key = "1".padStart(64, "0"); // Ephemeral fixture identity; never funded or used on a network.
const owner = TronWeb.address.fromPrivateKey(key);
const token = "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf";
const permit2 = tronSdk.PERMIT2_ADDRESSES[network];
const tw = new TronWeb({ fullHost: "http://127.0.0.1:1" });
let allowance = 0n;
const events = [];
const signer = {
  address: owner,
  network,
  readContract: async () => allowance,
  signTypedData: args => tw.trx._signTypedData(args.domain, args.types, args.message, key),
  ensureAllowance: async () => {
    throw new Error("Unexpected self-funded approve");
  },
  signPermit2Approval: async () => {
    const tx = {
      visible: false,
      raw_data: {
        contract: [
          {
            type: "TriggerSmartContract",
            parameter: {
              type_url: "type.googleapis.com/protocol.TriggerSmartContract",
              value: {
                owner_address: TronWeb.address.toHex(owner),
                contract_address: TronWeb.address.toHex(token),
                data:
                  "095ea7b3" +
                  tronSdk.normalizeAddressForSigning(permit2).slice(2).padStart(64, "0") +
                  "f".repeat(64),
                call_value: 0,
              },
            },
          },
        ],
        ref_block_bytes: "1234",
        ref_block_hash: "0102030405060708",
        timestamp: Date.now(),
        expiration: Date.now() + 600000,
        fee_limit: 100000000,
      },
    };
    const pb = utils.transaction.txJsonToPb(tx);
    tx.raw_data_hex = utils.transaction.txPbToRawDataHex(pb);
    tx.txID = utils.transaction.txPbToTxID(pb).replace(/^0x/, "");
    return tronSdk.serializeSignedTronTransaction(await tw.trx.sign(tx, key));
  },
};
const required = {
  x402Version: 2,
  resource: { url: "https://test.invalid/paid" },
  accepts: [
    {
      scheme: "exact",
      network,
      asset: token,
      amount: "1000",
      payTo: owner,
      maxTimeoutSeconds: 600,
      extra: { assetTransferMethod: "permit2" },
    },
  ],
  extensions: ext.declareTrc20ApprovalResourceSponsoringExtension(),
};
const snapshot = structuredClone(required);
const client = new x402Client()
  .register(network, new Client(signer))
  .registerExtension(ext.createTrc20ApprovalResourceSponsoringClientExtension(signer));
const payment = await client.createPaymentPayload(required);
assert.deepEqual(required, snapshot);
assert.ok(payment.extensions.trc20ApprovalResourceSponsoring.info.signedTransaction);
const facilitatorSigner = {
  getAddresses: () => [owner],
  readContract: async args => (args.functionName === "allowance" ? allowance : 1000000n),
  verifyTypedData: async args =>
    tronSdk.normalizeAddressForSigning(
      utils.typedData.verifyTypedData(args.domain, args.types, args.message, args.signature),
    ) === tronSdk.normalizeAddressForSigning(args.address),
  writeContract: async () => "11".repeat(32),
  waitForTransactionReceipt: async () => ({ status: "success" }),
};
const facilitator = new x402Facilitator().register(network, new Facilitator(facilitatorSigner));
assert.equal(
  (await facilitator.verify(payment, required.accepts[0])).invalidReason,
  "sponsor_runtime_unavailable",
);
facilitator.registerExtension(
  ext.createTrc20ApprovalResourceSponsoringExtension({
    verify: async request => {
      assert.equal(request.requiredAllowance, "1000");
      events.push("verify");
      return { isValid: true };
    },
    sponsor: async request => {
      allowance = BigInt(ext.TRC20_APPROVAL_MAX_AMOUNT);
      events.push("sponsor");
      return { success: true, approvalTransaction: request.approvalTxID };
    },
  }),
);
assert.equal((await facilitator.verify(payment, required.accepts[0])).isValid, true);
assert.equal((await facilitator.settle(payment, required.accepts[0])).success, true);
assert.equal(events.filter(event => event === "sponsor").length, 1);
const ordinary = await client.createPaymentPayload(required);
assert.equal(ordinary.extensions.trc20ApprovalResourceSponsoring, undefined);
assert.equal((await facilitator.verify(ordinary, required.accepts[0])).isValid, true);
assert.deepEqual(required, snapshot);

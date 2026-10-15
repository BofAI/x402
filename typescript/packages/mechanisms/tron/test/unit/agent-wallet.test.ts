import { afterEach, describe, expect, it } from "vitest";
import { TronWeb, utils } from "tronweb";
import { x402Client } from "@x402/core/client";
import { x402Facilitator } from "@x402/core/facilitator";
import {
  createClientTronSigner,
  createFacilitatorTronSigner,
  normalizeSignedTronTransaction,
} from "../../src/signer";
import { ExactTronScheme as ExactClient } from "../../src/exact/client";
import { ExactTronScheme as ExactFacilitator } from "../../src/exact/facilitator";
import { permit2WitnessTypes } from "../../src/constants";
import { TRC20_APPROVAL_RESOURCE_SPONSORING_KEY } from "../../src/exact/extensions";
import { decodeSignedTrc20Approval } from "../../src/shared/trc20approval";
import {
  NETWORK,
  TOKEN,
  PERMIT2,
  PROXY,
  MAX,
  localRpc,
  testWallet,
  unsignedContract,
} from "./fixtures/local-rpc";
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanups.splice(0)) await close();
});
async function setup() {
  const rpc = await localRpc();
  cleanups.push(rpc.close);
  const payer = await testWallet(),
    facilitator = await testWallet(),
    owner = await testWallet();
  const signer = await createClientTronSigner(payer.wallet, { network: NETWORK, rpcUrl: rpc.url });
  const facSigner = await createFacilitatorTronSigner(facilitator.wallet, {
    network: NETWORK,
    rpcUrl: rpc.url,
    permissionId: 2,
  });
  const requirements = {
    scheme: "exact",
    network: NETWORK,
    asset: TOKEN,
    amount: "1000",
    payTo: facilitator.address,
    maxTimeoutSeconds: 60,
    extra: { assetTransferMethod: "permit2", paymentFlow: "authorization" },
  };
  const client = new x402Client().register(NETWORK, new ExactClient(signer));
  const fac = new x402Facilitator().register(NETWORK, new ExactFacilitator(facSigner));
  const required = {
    x402Version: 2,
    resource: { url: "https://offline-test.invalid/" },
    accepts: [requirements],
  };
  return { rpc, payer, facilitator, owner, signer, facSigner, requirements, client, fac, required };
}

describe("real BOA 2.4.0 wallet + existing TRON adapters + official Core", () => {
  it("creates a genuine Permit2 signature verified against the BOA wallet address", async () => {
    const e = await setup();
    e.rpc.state.allowance = MAX;
    const payment = await e.client.createPaymentPayload(e.required);
    expect(payment.payload.signature).toMatch(/^0x[0-9a-f]{130}$/i);
    const a = payment.payload.permit2Authorization as any;
    const recovered = utils.typedData.verifyTypedData(
      {
        name: "Permit2",
        chainId: 3448148188,
        verifyingContract: "0x" + TronWeb.address.toHex(PERMIT2).slice(2),
      },
      permit2WitnessTypes,
      {
        permitted: { token: a.permitted.token, amount: BigInt(a.permitted.amount) },
        spender: a.spender,
        nonce: BigInt(a.nonce),
        deadline: BigInt(a.deadline),
        witness: { to: a.witness.to, validAfter: BigInt(a.witness.validAfter) },
      },
      payment.payload.signature as string,
    );
    expect(TronWeb.address.toHex(recovered).toLowerCase()).toBe(
      TronWeb.address.toHex(e.payer.address).toLowerCase(),
    );
    expect((await e.fac.verify(payment, e.requirements)).isValid).toBe(true);
    const tampered = structuredClone(payment);
    (tampered.payload.permit2Authorization as any).permitted.amount = "1001";
    expect((await e.fac.verify(tampered, e.requirements)).isValid).toBe(false);
    expect(e.rpc.state.broadcasts).toHaveLength(0);
  });

  it("first payment signs and broadcasts a real approve transaction through the BOA wallet", async () => {
    const e = await setup();
    await e.client.createPaymentPayload(e.required);
    expect(e.rpc.state.broadcasts).toHaveLength(1);
    const tx = e.rpc.state.broadcasts[0],
      value = tx.raw_data.contract[0].parameter.value;
    expect(value.data.slice(0, 8)).toBe("095ea7b3");
    expect(BigInt("0x" + value.data.slice(-64))).toBe(MAX);
    expect(utils.crypto.ecRecover(tx.txID, tx.signature[0]).toLowerCase()).toBe(
      TronWeb.address.toHex(e.payer.address).toLowerCase(),
    );
    expect(["00", "01"]).toContain(tx.signature[0].slice(-2));
    await e.client.createPaymentPayload(e.required);
    expect(e.rpc.state.broadcasts).toHaveLength(1);
  });

  it("BOA JSON transaction and 27/28 recovery bytes need the existing normalization", async () => {
    const e = await setup();
    const unsigned = unsignedContract({
      owner_address: TronWeb.address.toHex(e.payer.address),
      contract_address: TronWeb.address.toHex(TOKEN),
      function_selector: "approve(address,uint256)",
      parameter: "0".repeat(128),
    });
    const raw = await e.payer.wallet.signTransaction(unsigned);
    expect(typeof raw).toBe("string");
    const decoded = JSON.parse(raw);
    expect(["1b", "1c"]).toContain(decoded.signature[0].slice(-2));
    const normalized = normalizeSignedTronTransaction(raw, unsigned);
    expect(["00", "01"]).toContain((normalized.signature as string[])[0].slice(-2));
    const tw = new TronWeb({ fullHost: e.rpc.url });
    await expect(tw.trx.sendRawTransaction(raw as never)).rejects.toThrow("Invalid transaction");
    const detached = e.payer.wallet.signTransaction;
    await expect(detached(unsigned)).rejects.toThrow();
  });

  it("official facilitator settles using the real BOA settlement wallet and permissionId", async () => {
    const e = await setup();
    e.rpc.state.allowance = MAX;
    const payment = await e.client.createPaymentPayload(e.required);
    const result = await e.fac.settle(payment, e.requirements);
    expect(result.success).toBe(true);
    expect(e.rpc.state.broadcasts).toHaveLength(1);
    const tx = e.rpc.state.broadcasts[0];
    expect(tx.raw_data.contract[0].Permission_id).toBe(2);
    expect(tx.raw_data.contract[0].parameter.value.contract_address.toLowerCase()).toBe(
      TronWeb.address.toHex(PROXY).toLowerCase(),
    );
    expect(utils.crypto.ecRecover(tx.txID, tx.signature[0]).toLowerCase()).toBe(
      TronWeb.address.toHex(e.facilitator.address).toLowerCase(),
    );
  });

  it("official extension context rejects missing runtime and executes a registered runtime", async () => {
    const e = await setup();
    const required = {
      ...e.required,
      extensions: { [TRC20_APPROVAL_RESOURCE_SPONSORING_KEY]: { info: { version: "1" } } },
    };
    const payment = await e.client.createPaymentPayload(required);
    expect(await e.fac.verify(payment, e.requirements)).toMatchObject({
      isValid: false,
      invalidReason: "sponsor_runtime_unavailable",
    });
    e.fac.registerExtension({
      key: TRC20_APPROVAL_RESOURCE_SPONSORING_KEY,
      runtime: {
        verify: async () => ({ isValid: true }),
        sponsor: async () => {
          e.rpc.state.allowance = MAX;
          return { success: true };
        },
      },
    });
    expect(await e.fac.verify(payment, e.requirements)).toMatchObject({ isValid: true });
    const invalid = structuredClone(payment);
    invalid.extensions = { [TRC20_APPROVAL_RESOURCE_SPONSORING_KEY]: { info: { version: "1" } } };
    expect(await e.fac.verify(invalid, e.requirements)).toMatchObject({
      isValid: false,
      invalidReason: "approval_extension_invalid",
    });
    expect(await e.fac.settle(payment, e.requirements)).toMatchObject({ success: true });
    expect(e.rpc.state.broadcasts).toHaveLength(1);
  });

  it("resource sponsoring pre-signs a verifiable Approval without client broadcast", async () => {
    const e = await setup();
    e.required.extensions = {
      [TRC20_APPROVAL_RESOURCE_SPONSORING_KEY]: { info: { version: "1" } },
    };
    const payment = await e.client.createPaymentPayload(e.required);
    expect(e.rpc.state.broadcasts).toHaveLength(0);
    const info = (payment.extensions as any)[TRC20_APPROVAL_RESOURCE_SPONSORING_KEY].info;
    const approval = decodeSignedTrc20Approval(info.signedTransaction);
    expect(TronWeb.address.toHex(approval.owner).toLowerCase()).toBe(
      TronWeb.address.toHex(e.payer.address).toLowerCase(),
    );
    expect(TronWeb.address.toHex(approval.spender).toLowerCase()).toBe(
      TronWeb.address.toHex(PERMIT2).toLowerCase(),
    );
    expect(approval.amount).toBe(MAX.toString());
    expect(approval.expiration - approval.timestamp).toBeGreaterThanOrEqual(120000n);
  });
});

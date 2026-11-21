import { describe, expect, it, vi } from "vitest";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { ExactTronScheme as Client } from "../../src/exact/client/scheme";
import { ExactTronScheme as Server } from "../../src/exact/server/scheme";
import { ExactTronScheme as Facilitator } from "../../src/exact/facilitator/scheme";
import { PERMIT2_ADDRESSES, X402_PERMIT2_PROXY_ADDRESSES } from "../../src/constants";
import { normalizeAddressForSigning } from "../../src/utils";
import type { ClientTronSigner, FacilitatorTronSigner } from "../../src/signer";

const NETWORK = "tron:728126428";
const USDT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const CUSTOM = "0x" + "ab".repeat(20);
const PAYER = "0x" + "12".repeat(20);
const PAYTO = "0x" + "34".repeat(20);
const SIGNATURE = ("0x" + "11".repeat(65)) as `0x${string}`;
const TX = "11".repeat(32);
function requirements(extra: Record<string, unknown> = {}): PaymentRequirements {
  return {
    scheme: "exact",
    network: NETWORK,
    asset: USDT,
    amount: "1",
    payTo: PAYTO,
    maxTimeoutSeconds: 120,
    extra: { name: "Tether USD", version: "1", ...extra },
  };
}
function payload(req: PaymentRequirements, method = "eip3009"): PaymentPayload {
  const deadline = String(Math.floor(Date.now() / 1000) + 120);
  const authorization =
    method === "permit2"
      ? {
          permit2Authorization: {
            from: PAYER,
            permitted: { token: normalizeAddressForSigning(req.asset), amount: req.amount },
            spender: normalizeAddressForSigning(X402_PERMIT2_PROXY_ADDRESSES[NETWORK]!),
            nonce: "1",
            deadline,
            witness: { to: PAYTO, validAfter: "0" },
          },
        }
      : {
          authorization: {
            from: PAYER,
            to: PAYTO,
            value: req.amount,
            validAfter: "0",
            validBefore: deadline,
            nonce: "0x" + "22".repeat(32),
          },
        };
  return { x402Version: 2, accepted: req, payload: { ...authorization, signature: SIGNATURE } };
}
function client() {
  const signer: ClientTronSigner = {
    address: PAYER,
    signTypedData: vi.fn().mockResolvedValue(SIGNATURE),
    ensureAllowance: vi.fn().mockResolvedValue(undefined),
  };
  return { signer, scheme: new Client(signer) };
}
function facilitator() {
  const signer: FacilitatorTronSigner = {
    getAddresses: () => [PAYTO],
    verifyTypedData: vi.fn().mockResolvedValue(true),
    readContract: vi.fn().mockResolvedValue(100n),
    writeContract: vi.fn().mockResolvedValue(TX),
    waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: "success" }),
  };
  return { signer, scheme: new Facilitator(signer) };
}
const supported = {
  x402Version: 2,
  scheme: "exact",
  network: NETWORK as `${string}:${string}`,
  extra: { supportedAssetTransferMethods: ["eip3009", "permit2"] },
};

describe("exact TRON requirements and payload validation", () => {
  it.each([USDT, normalizeAddressForSigning(USDT)])(
    "infers Permit2 for custom USDT price %s",
    async asset => {
      const server = new Server();
      const price = await server.parsePrice({ asset, amount: "1" }, NETWORK);
      expect(price.extra?.assetTransferMethod).toBe("permit2");
      const enhanced = await server.enhancePaymentRequirements(
        { ...requirements(), ...price },
        supported,
        [],
      );
      expect(enhanced.extra?.assetTransferMethod).toBe("permit2");
    },
  );
  it("infers Permit2 during enhancement even when parsePrice was bypassed", async () => {
    expect(
      (await new Server().enhancePaymentRequirements(requirements(), supported, [])).extra
        ?.assetTransferMethod,
    ).toBe("permit2");
  });
  it("does not select a method the facilitator cannot handle", async () => {
    await expect(
      new Server().enhancePaymentRequirements(
        requirements(),
        {
          ...supported,
          extra: { supportedAssetTransferMethods: ["eip3009"] },
        },
        [],
      ),
    ).rejects.toThrow();
  });
  it("client infers Permit2 for registered USDT without a method", async () => {
    const { scheme, signer } = client();
    const result = await scheme.createPaymentPayload(2, requirements());
    expect(result.payload).toHaveProperty("permit2Authorization");
    expect(signer.ensureAllowance).toHaveBeenCalled();
  });
  it.each(["typo", "", "eip3009"])("rejects invalid USDT method %j across roles", async method => {
    const req = requirements({ assetTransferMethod: method });
    const { scheme, signer } = client();
    await expect(scheme.createPaymentPayload(2, req)).rejects.toThrow();
    expect(signer.signTypedData).not.toHaveBeenCalled();
    await expect(new Server().enhancePaymentRequirements(req, supported, [])).rejects.toThrow();
    const fac = facilitator();
    expect(await fac.scheme.verify(payload(req), req)).toMatchObject({
      isValid: false,
      invalidReason: "invalid_exact_tron_asset_transfer_method",
    });
    expect(await fac.scheme.settle(payload(req), req)).toMatchObject({
      success: false,
      errorReason: "invalid_exact_tron_asset_transfer_method",
    });
    expect(fac.signer.writeContract).not.toHaveBeenCalled();
  });
  it.each([PERMIT2_ADDRESSES[NETWORK]!, X402_PERMIT2_PROXY_ADDRESSES[NETWORK]!])(
    "rejects infrastructure contract as asset %s",
    async asset => {
      const req = { ...requirements(), asset };
      await expect(client().scheme.createPaymentPayload(2, req)).rejects.toThrow();
      await expect(new Server().parsePrice({ asset, amount: "1" }, NETWORK)).rejects.toThrow();
      const fac = facilitator();
      expect(await fac.scheme.settle(payload(req), req)).toMatchObject({
        success: false,
        errorReason: "invalid_exact_tron_asset",
      });
      expect(fac.signer.writeContract).not.toHaveBeenCalled();
    },
  );
  it.each(["0", "-1", "1.5", "garbage"])(
    "rejects amount %s before signing or broadcasting",
    async amount => {
      const req = { ...requirements({ assetTransferMethod: "permit2" }), amount };
      await expect(client().scheme.createPaymentPayload(2, req)).rejects.toThrow();
      await expect(new Server().parsePrice({ asset: USDT, amount }, NETWORK)).rejects.toThrow();
      const fac = facilitator();
      expect(await fac.scheme.verify(payload(req, "permit2"), req)).toMatchObject({
        isValid: false,
        invalidReason: "invalid_exact_tron_amount",
      });
      expect(await fac.scheme.settle(payload(req, "permit2"), req)).toMatchObject({
        success: false,
        errorReason: "invalid_exact_tron_amount",
      });
      expect(fac.signer.writeContract).not.toHaveBeenCalled();
    },
  );
  it("rejects an EIP3009 payload when Permit2 is required", async () => {
    const req = requirements({ assetTransferMethod: "permit2" });
    const fac = facilitator();
    expect(await fac.scheme.verify(payload(req), req)).toMatchObject({
      isValid: false,
      invalidReason: "invalid_exact_tron_asset_transfer_method",
    });
    expect(await fac.scheme.settle(payload(req), req)).toMatchObject({ success: false });
    expect(fac.signer.verifyTypedData).not.toHaveBeenCalled();
    expect(fac.signer.writeContract).not.toHaveBeenCalled();
  });
  it.each([
    {},
    { authorization: null },
    { permit2Authorization: {} },
    { permit2Authorization: { from: PAYER, permitted: null } },
  ])("returns a protocol error for malformed authorization %j", async raw => {
    const req = requirements({ assetTransferMethod: "permit2" });
    const pp = { ...payload(req), payload: { ...raw, signature: SIGNATURE } };
    const fac = facilitator();
    expect(await fac.scheme.verify(pp, req)).toMatchObject({
      isValid: false,
      invalidReason: "invalid_exact_tron_payload_authorization",
    });
    expect(await fac.scheme.settle(pp, req)).toMatchObject({
      success: false,
      errorReason: "invalid_exact_tron_payload_authorization",
    });
    expect(fac.signer.writeContract).not.toHaveBeenCalled();
  });
  it("rejects a Permit2 payload against custom EIP3009 requirements", async () => {
    const req = { ...requirements({ assetTransferMethod: "eip3009" }), asset: CUSTOM };
    const fac = facilitator();
    expect(await fac.scheme.verify(payload(req, "permit2"), req)).toMatchObject({
      isValid: false,
      invalidReason: "invalid_exact_tron_asset_transfer_method",
    });
    expect(await fac.scheme.settle(payload(req, "permit2"), req)).toMatchObject({ success: false });
    expect(fac.signer.verifyTypedData).not.toHaveBeenCalled();
    expect(fac.signer.writeContract).not.toHaveBeenCalled();
  });
  it.each(["garbage", "-1", "1.5", "", (1n << 256n).toString()])(
    "rejects malformed numeric authorization field %j",
    async validBefore => {
      const req = { ...requirements(), asset: CUSTOM };
      const pp = payload(req);
      (pp.payload.authorization as Record<string, unknown>).validBefore = validBefore;
      const fac = facilitator();
      expect(await fac.scheme.verify(pp, req)).toMatchObject({
        isValid: false,
        invalidReason: "invalid_exact_tron_payload_authorization",
      });
      expect(await fac.scheme.settle(pp, req)).toMatchObject({
        success: false,
        errorReason: "invalid_exact_tron_payload_authorization",
      });
      expect(fac.signer.writeContract).not.toHaveBeenCalled();
    },
  );
  it("fails closed when custom EIP3009 balance reads fail", async () => {
    const req = { ...requirements({ assetTransferMethod: "eip3009" }), asset: CUSTOM };
    const fac = facilitator();
    vi.mocked(fac.signer.readContract).mockRejectedValue(new Error("RPC unavailable"));
    expect(await fac.scheme.verify(payload(req), req)).toMatchObject({
      isValid: false,
      invalidReason: "chain_read_failed",
    });
    expect(await fac.scheme.settle(payload(req), req)).toMatchObject({
      success: false,
      errorReason: "chain_read_failed",
    });
    expect(fac.signer.writeContract).not.toHaveBeenCalled();
  });
  it("preserves valid custom EIP3009 payments", async () => {
    const req = { ...requirements(), asset: CUSTOM };
    const signed = await client().scheme.createPaymentPayload(2, req);
    expect(signed.payload).toHaveProperty("authorization");
    const fac = facilitator();
    expect(await fac.scheme.verify(payload(req), req)).toMatchObject({ isValid: true });
    expect(await fac.scheme.settle(payload(req), req)).toMatchObject({ success: true });
  });
  it("settles inferred Permit2 USDT payments through the proxy", async () => {
    const req = requirements();
    const fac = facilitator();
    expect(await fac.scheme.verify(payload(req, "permit2"), req)).toMatchObject({ isValid: true });
    expect(await fac.scheme.settle(payload(req, "permit2"), req)).toMatchObject({ success: true });
    expect(fac.signer.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: X402_PERMIT2_PROXY_ADDRESSES[NETWORK],
        functionName: "settle",
      }),
    );
  });
});

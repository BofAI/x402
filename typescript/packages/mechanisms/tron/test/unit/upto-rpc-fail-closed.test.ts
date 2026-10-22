import { describe, expect, it, vi } from "vitest";
import { x402Facilitator } from "@x402/core/facilitator";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { UptoTronScheme } from "../../src/upto/facilitator/scheme";
import { verifyUptoPermit2 } from "../../src/upto/facilitator/permit2";
import { X402_UPTO_PERMIT2_PROXY_ADDRESSES } from "../../src/constants";
import type { FacilitatorTronSigner } from "../../src/signer";
import type { UptoPermit2Payload } from "../../src/types";
import { normalizeAddressForSigning } from "../../src/utils";

const network = "tron:3448148188";
const payer = "TJRyWwFs9wTFGZg3JbrVriFbNfCug5tDeC";
const asset = "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf";
const tx = "11".repeat(32);

function fixture(amount = "1000000") {
  const requirements: PaymentRequirements = {
    scheme: "upto",
    network,
    asset,
    amount,
    payTo: payer,
    maxTimeoutSeconds: 600,
    extra: { assetTransferMethod: "permit2", permit2FacilitatorAddress: payer },
  };
  const body: UptoPermit2Payload = {
    signature: "0xsigned-authorization",
    permit2Authorization: {
      from: payer,
      permitted: { token: normalizeAddressForSigning(asset), amount },
      spender: normalizeAddressForSigning(X402_UPTO_PERMIT2_PROXY_ADDRESSES[network]!),
      nonce: "1",
      deadline: String(Math.floor(Date.now() / 1000) + 600),
      witness: {
        to: normalizeAddressForSigning(payer),
        facilitator: normalizeAddressForSigning(payer),
        validAfter: "0",
      },
    },
  };
  const payload: PaymentPayload = { x402Version: 2, accepted: requirements, payload: body };
  const signer: FacilitatorTronSigner = {
    getAddresses: () => [payer],
    verifyTypedData: vi.fn(async () => true),
    readContract: vi.fn(async () => 2_000_000n),
    writeContract: vi.fn(async () => tx),
    waitForTransactionReceipt: vi.fn(async () => ({ status: "success" })),
  };
  const scheme = new UptoTronScheme(signer);
  const facilitator = new x402Facilitator().register(network, scheme);
  return { requirements, payload, body, signer, scheme, facilitator };
}

describe("upto account RPC errors fail closed", () => {
  for (const read of ["allowance", "balanceOf"]) {
    it(`rejects ${read} RPC failures through official Core and never broadcasts`, async () => {
      const { signer, facilitator, payload, requirements } = fixture();
      vi.mocked(signer.readContract).mockImplementation(async args => {
        if (args.functionName === read)
          throw new Error("RPC failed at https://rpc.invalid/?api_key=private-marker");
        return 2_000_000n;
      });
      const result = await facilitator.verify(payload, requirements);
      expect(result).toMatchObject({
        isValid: false,
        invalidReason: "chain_read_failed",
        invalidMessage: "TRON contract read failed",
        payer,
      });
      expect(JSON.stringify(result)).not.toContain("private-marker");
      for (const amount of ["400000", "0"]) {
        const settled = await facilitator.settle(payload, { ...requirements, amount });
        expect(settled).toMatchObject({
          success: false,
          errorReason: "chain_read_failed",
          transaction: "",
          payer,
        });
        expect(JSON.stringify(settled)).not.toContain("private-marker");
      }
      expect(signer.writeContract).not.toHaveBeenCalled();
      expect(signer.waitForTransactionReceipt).not.toHaveBeenCalled();
    });

    it.each([
      undefined,
      null,
      true,
      {},
      [],
      "garbage",
      "",
      -1n,
      1n << 256n,
      NaN,
      Infinity,
      1.5,
      Number.MAX_SAFE_INTEGER + 1,
    ])(`rejects malformed ${read} result %s`, async value => {
      const { signer, scheme, payload, requirements } = fixture("1");
      vi.mocked(signer.readContract).mockImplementation(async args =>
        args.functionName === read ? value : 2_000_000n,
      );
      await expect(scheme.verify(payload, requirements)).resolves.toMatchObject({
        isValid: false,
        invalidReason: "chain_read_failed",
        payer,
      });
    });
  }

  it.each([2_000_000n, "2000000", "0x1e8480", 2_000_000, (1n << 256n) - 1n])(
    "accepts valid uint256 reads %s and still settles partial amounts",
    async value => {
      const { signer, scheme, payload, requirements } = fixture();
      vi.mocked(signer.readContract).mockResolvedValue(value);
      await expect(scheme.verify(payload, requirements)).resolves.toMatchObject({ isValid: true });
      await expect(
        scheme.settle(payload, { ...requirements, amount: "400000" }),
      ).resolves.toMatchObject({
        success: true,
        amount: "400000",
        transaction: tx,
      });
    },
  );

  it.each([
    ["allowance", "permit2_allowance_required"],
    ["balanceOf", "insufficient_funds"],
  ])(
    "preserves insufficient %s error instead of treating it as an RPC failure",
    async (read, reason) => {
      const { signer, scheme, payload, requirements } = fixture();
      vi.mocked(signer.readContract).mockImplementation(async args =>
        args.functionName === read ? 0n : 2_000_000n,
      );
      await expect(scheme.verify(payload, requirements)).resolves.toMatchObject({
        isValid: false,
        invalidReason: reason,
      });
    },
  );

  it("defers allowance in Approval revalidation but still rejects unavailable balances", async () => {
    const { signer, payload, requirements, body } = fixture();
    vi.mocked(signer.readContract).mockImplementation(async args => {
      if (args.functionName === "allowance") throw new Error("allowance must be deferred");
      return 2_000_000n;
    });
    const options = { verifySponsorship: false, requireAllowance: false };
    await expect(
      verifyUptoPermit2(signer, payload, requirements, body, undefined, options),
    ).resolves.toMatchObject({ isValid: true });
    expect(signer.readContract).toHaveBeenCalledTimes(1);
    expect(signer.readContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "balanceOf" }),
    );
    vi.mocked(signer.readContract).mockRejectedValue(new Error("balance RPC unavailable"));
    await expect(
      verifyUptoPermit2(signer, payload, requirements, body, undefined, options),
    ).resolves.toMatchObject({ isValid: false, invalidReason: "chain_read_failed" });
  });
});

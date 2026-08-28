import { describe, expect, it, vi } from "vitest";
import { PERMIT2_ADDRESSES } from "../../src/constants";
import { ExactTronScheme } from "../../src/exact/client/scheme";
import {
  TRC20_APPROVAL_MAX_AMOUNT,
  TRC20_APPROVAL_RESOURCE_SPONSORING_KEY,
} from "../../src/shared/extensions/trc20ApprovalContract";
import type { ClientTronSigner } from "../../src/signer";
import { trySignTrc20ApprovalExtension } from "../../src/shared/extensions";
import { createTrc20ApprovalPolicy } from "../../src/approvalPolicy";

const NETWORK = "tron:0xcd8690dc";
const OTHER_NETWORK = "tron:0x2b6653dc";
const PAYER = "TJRyWwFs9wTFGZg3JbrVriFbNfCug5tDeC";
const TOKEN = "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf";
const SIGNED_APPROVAL = "0a02abcd";

const requirements = {
  scheme: "exact",
  network: NETWORK,
  asset: TOKEN,
  amount: "1000000",
  payTo: PAYER,
  maxTimeoutSeconds: 600,
  extra: { assetTransferMethod: "permit2" },
};

const context = {
  extensions: {
    [TRC20_APPROVAL_RESOURCE_SPONSORING_KEY]: {
      info: {
        description: "Sponsor TRON resources for Approval",
        version: "1",
      },
      schema: {},
    },
  },
};

function signer(allowance: bigint): ClientTronSigner {
  return {
    address: PAYER,
    network: NETWORK,
    readContract: vi.fn(async () => allowance),
    signTypedData: vi.fn(async () => "0xpermit2-signature" as `0x${string}`),
    ensureAllowance: vi.fn(async () => true),
    signPermit2Approval: vi.fn(async () => SIGNED_APPROVAL),
  };
}

describe("TRC-20 Approval Resource Sponsoring client", () => {
  it("rejects a signer network mismatch before any RPC or signing call", async () => {
    const clientSigner = signer(0n) as ClientTronSigner & { readonly network: string };
    Object.defineProperty(clientSigner, "network", { value: NETWORK, enumerable: true });
    const readContract = vi.mocked(clientSigner.readContract);

    await expect(
      trySignTrc20ApprovalExtension(
        clientSigner,
        { ...requirements, network: OTHER_NETWORK } as never,
        context,
      ),
    ).rejects.toThrow("approval_signer_network_mismatch");

    expect(readContract).not.toHaveBeenCalled();
    expect(clientSigner.signPermit2Approval).not.toHaveBeenCalled();
  });

  it("uses the selected Permit2 operation amount as the allowance threshold", async () => {
    const clientSigner = signer(1_500_000n);

    await expect(
      trySignTrc20ApprovalExtension(clientSigner, requirements as never, context, "2000000"),
    ).rejects.toThrow("approval_reset_required");

    expect(clientSigner.signPermit2Approval).not.toHaveBeenCalled();
  });

  it("signs the Approval without broadcasting when the Server advertises version 1", async () => {
    const clientSigner = signer(0n);
    const result = await new ExactTronScheme(clientSigner).createPaymentPayload(
      2,
      requirements as never,
      context,
    );

    expect(clientSigner.signPermit2Approval).toHaveBeenCalledWith({
      token: TOKEN,
      network: NETWORK,
      minimumLifetimeSeconds: 300,
    });
    expect(clientSigner.ensureAllowance).not.toHaveBeenCalled();
    expect(result.extensions).toEqual({
      [TRC20_APPROVAL_RESOURCE_SPONSORING_KEY]: {
        info: {
          from: PAYER,
          asset: TOKEN,
          spender: PERMIT2_ADDRESSES[NETWORK],
          amount: TRC20_APPROVAL_MAX_AMOUNT,
          signedTransaction: SIGNED_APPROVAL,
          version: "1",
        },
      },
    });
  });

  it("signs the scheme authorization before the sponsored Approval", async () => {
    const calls: string[] = [];
    const clientSigner = signer(0n);
    clientSigner.signTypedData = vi.fn(async () => {
      calls.push("scheme-authorization");
      return "0xpermit2-signature" as `0x${string}`;
    });
    clientSigner.signPermit2Approval = vi.fn(async () => {
      calls.push("approval");
      return SIGNED_APPROVAL;
    });

    await new ExactTronScheme(clientSigner).createPaymentPayload(2, requirements as never, context);

    expect(calls).toEqual(["scheme-authorization", "approval"]);
  });

  it("does not create an Approval when allowance is already sufficient", async () => {
    const clientSigner = signer(1_000_000n);
    const result = await new ExactTronScheme(clientSigner).createPaymentPayload(
      2,
      requirements as never,
      context,
    );

    expect(result.extensions).toBeUndefined();
    expect(clientSigner.signPermit2Approval).not.toHaveBeenCalled();
    expect(clientSigner.ensureAllowance).not.toHaveBeenCalled();
  });

  it("preserves the self-funded Approval flow when the extension is absent", async () => {
    const clientSigner = signer(0n);
    await new ExactTronScheme(clientSigner).createPaymentPayload(2, requirements as never);

    expect(clientSigner.ensureAllowance).toHaveBeenCalledWith({
      token: TOKEN,
      amount: 1_000_000n,
      network: NETWORK,
    });
    expect(clientSigner.signPermit2Approval).not.toHaveBeenCalled();
  });

  it("rejects a non-zero insufficient allowance instead of signing an unsafe Approval", async () => {
    const clientSigner = signer(1n);
    await expect(
      new ExactTronScheme(clientSigner).createPaymentPayload(2, requirements as never, context),
    ).rejects.toThrow("approval_reset_required");
  });

  it("signs over a partial allowance only under direct-overwrite policy", async () => {
    const clientSigner = signer(1n);
    Object.defineProperty(clientSigner, "approvalPolicy", {
      value: createTrc20ApprovalPolicy({
        strategies: { [NETWORK]: { [TOKEN]: "direct-overwrite" } },
      }),
      enumerable: true,
    });

    const result = await new ExactTronScheme(clientSigner).createPaymentPayload(
      2,
      requirements as never,
      context,
    );

    expect(clientSigner.signPermit2Approval).toHaveBeenCalledTimes(1);
    expect(result.extensions?.[TRC20_APPROVAL_RESOURCE_SPONSORING_KEY]).toBeDefined();
  });

  it("rejects an unsupported extension version", async () => {
    const clientSigner = signer(0n);
    await expect(
      new ExactTronScheme(clientSigner).createPaymentPayload(2, requirements as never, {
        extensions: {
          [TRC20_APPROVAL_RESOURCE_SPONSORING_KEY]: {
            info: { description: "future", version: "2" },
          },
        },
      }),
    ).rejects.toThrow("unsupported extension version");
  });
});

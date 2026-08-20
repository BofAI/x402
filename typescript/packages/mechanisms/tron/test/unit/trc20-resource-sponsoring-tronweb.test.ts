import { describe, expect, it, vi } from "vitest";
import { TronWeb } from "tronweb";
import type { FacilitatorWallet } from "@bankofai/x402-core/wallets";
import type { Trc20ApprovalResourceSponsoringRequest } from "../../src/exact/extensions";
import { createTronWebResourceSponsoringChain } from "../../src/resource-sponsoring";

const PAYER = "TJRyWwFs9wTFGZg3JbrVriFbNfCug5tDeC";
const TOKEN = "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf";
const SPENDER = "TYQuuhGbEMxF7nZxUHV3uHJxAVVAegNU9h";
const OWNER = "TFpPyDCKAqfWwMrh5GXdLTr1Emjo4DxsDm";
const BLOCK_HASH_REF = "0102030405060708";

function runtimeRequest(): Trc20ApprovalResourceSponsoringRequest {
  return {
    network: "tron:0xcd8690dc",
    approvalTxID: "a".repeat(64),
    approvalTimestamp: String(Date.now()),
    approvalExpiration: String(Date.now() + 120_000),
    approvalFeeLimitSun: "100000000",
    approvalRefBlockBytes: "1234",
    approvalRefBlockHash: BLOCK_HASH_REF,
    payer: PAYER,
    asset: TOKEN,
    spender: SPENDER,
    amount: String((1n << 256n) - 1n),
    signedTransaction: "0a02abcd",
    paymentPayload: {
      x402Version: 2,
      accepted: {
        scheme: "exact",
        network: "tron:0xcd8690dc",
        asset: TOKEN,
        amount: "1000000",
        payTo: PAYER,
        maxTimeoutSeconds: 600,
      },
      payload: {},
    },
    paymentRequirements: {
      scheme: "exact",
      network: "tron:0xcd8690dc",
      asset: TOKEN,
      amount: "1000000",
      payTo: PAYER,
      maxTimeoutSeconds: 600,
    },
  };
}

function createTronWebMock() {
  const sendHexTransaction = vi.fn(async () => ({ result: true, txid: "b".repeat(64) }));
  const getAccountResources = vi.fn(async (address: string) =>
    address === OWNER
      ? {
          NetLimit: 2_000,
          NetUsed: 100,
          freeNetLimit: 600,
          freeNetUsed: 0,
          EnergyLimit: 10_000,
          EnergyUsed: 0,
          TotalEnergyLimit: 180_000_000_000,
          TotalEnergyWeight: 18_000_000_000,
          TotalNetLimit: 43_200_000_000,
          TotalNetWeight: 27_000_000_000,
        }
      : {
          NetLimit: 0,
          NetUsed: 0,
          freeNetLimit: 600,
          freeNetUsed: 10,
          EnergyLimit: 1_000,
          EnergyUsed: 100,
          TotalEnergyLimit: 180_000_000_000,
          TotalEnergyWeight: 18_000_000_000,
          TotalNetLimit: 43_200_000_000,
          TotalNetWeight: 27_000_000_000,
        },
  );
  return {
    tronWeb: {
      fullNode: {
        request: vi.fn(async () => ({
          blockNumber: 1,
          receipt: { result: "SUCCESS" },
        })),
      },
      trx: {
        getAccount: vi.fn(async (address: string) =>
          address === TOKEN ? { address, type: 2, code: "6000" } : { address, type: 0, code: "" },
        ),
        getCurrentBlock: vi.fn(async () => ({
          blockID: "0".repeat(64),
          block_header: { raw_data: { number: 0x1234 } },
        })),
        getBlockByNumber: vi.fn(async () => ({
          blockID: `${"0".repeat(16)}${BLOCK_HASH_REF}${"0".repeat(32)}`,
          block_header: { raw_data: { number: 0x1234 } },
        })),
        getAccountResources,
        getChainParameters: vi.fn(async () => [
          { key: "getEnergyFee", value: 100 },
          { key: "getTransactionFee", value: 1_000 },
        ]),
        sendHexTransaction,
        getTransactionInfo: vi.fn(async () => ({
          blockNumber: 1,
          receipt: { result: "SUCCESS" },
        })),
      },
      transactionBuilder: {
        estimateEnergy: vi.fn(async () => ({
          result: { result: true },
          energy_required: 500,
        })),
      },
    } as unknown as TronWeb,
    sendHexTransaction,
  };
}

const wallet: FacilitatorWallet = {
  getAddress: vi.fn(async () => OWNER),
  signTransaction: vi.fn(async transaction => transaction),
};

describe("TronWeb resource-sponsoring chain", () => {
  it("performs exact chain preflight and broadcasts the unchanged Approval bytes", async () => {
    const mock = createTronWebMock();
    const readContract = vi.fn().mockResolvedValueOnce(0n).mockResolvedValueOnce(2_000_000n);
    const chain = await createTronWebResourceSponsoringChain({
      tronWeb: mock.tronWeb,
      resourceOwnerWallet: wallet,
      readContract,
      allowedAssets: [TOKEN],
    });

    const result = await chain.preflight(runtimeRequest());
    const txID = await chain.broadcastApproval("0a02abcd");
    const confirmation = await chain.confirm(txID);

    expect(result).toMatchObject({
      accountActivated: true,
      accountIsContract: false,
      allowance: 0n,
      tokenBalance: 2_000_000n,
      estimatedEnergy: 500n,
      estimatedBandwidth: 68n,
      replacementCost: 118_000n,
      managementBandwidthAvailable: 1_900n,
    });
    expect(txID).toBe("b".repeat(64));
    expect(confirmation).toBe("confirmed");
    expect(mock.sendHexTransaction).toHaveBeenCalledWith("0a02abcd");
  });

  it("fails closed when the signed Approval TAPOS hash is not current", async () => {
    const mock = createTronWebMock();
    const chain = await createTronWebResourceSponsoringChain({
      tronWeb: mock.tronWeb,
      resourceOwnerWallet: wallet,
      readContract: vi.fn(async () => 0n),
      allowedAssets: [TOKEN],
    });

    await expect(
      chain.preflight({ ...runtimeRequest(), approvalRefBlockHash: "ff".repeat(8) }),
    ).rejects.toThrow("approval_tapos_invalid");
    expect(mock.sendHexTransaction).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from "vitest";
import { TronWeb, utils as tronUtils } from "tronweb";
import type { Trc20ApprovalResourceSponsoringRequest } from "../../src/exact/extensions";
import {
  createTronWebResourceSponsoringChain,
  type TronResourceOwnerSigner,
} from "../../src/resource-sponsoring";

const PAYER = "TJRyWwFs9wTFGZg3JbrVriFbNfCug5tDeC";
const PAYER_EVM_HEX = "0x5cd0fb0ab3ce40f3051414c604b27756e69e43db";
const TOKEN = "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf";
const SPENDER = "TYQuuhGbEMxF7nZxUHV3uHJxAVVAegNU9h";
const OWNER = TronWeb.address.fromHex(`41${"11".repeat(20)}`);
const BLOCK_HASH_REF = "0102030405060708";
const RESOURCE_PERMISSION_OPERATIONS = `${"00".repeat(7)}06${"00".repeat(24)}`;

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
          receipt: { net_usage: 281 },
        })),
      },
      trx: {
        getAccount: vi.fn(async (address: string) =>
          address === TOKEN
            ? { address, type: "Contract", code: "6000" }
            : address === OWNER
              ? {
                  address,
                  type: 0,
                  code: "",
                  active_permission: [{ id: 2, operations: RESOURCE_PERMISSION_OPERATIONS }],
                }
              : { address, type: 0, code: "" },
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
        delegateResource: vi.fn(),
        undelegateResource: vi.fn(),
      },
    } as unknown as TronWeb,
    sendHexTransaction,
  };
}

function systemTransaction(
  kind: "DelegateResourceContract" | "UnDelegateResourceContract",
  overrides: Record<string, unknown> = {},
  permissionId = 2,
): Record<string, unknown> {
  const value = {
    owner_address: TronWeb.address.toHex(OWNER),
    receiver_address: TronWeb.address.toHex(PAYER),
    balance: 100_000,
    resource: "ENERGY",
    ...(kind === "DelegateResourceContract" ? { lock: false, lock_period: 0 } : {}),
    ...overrides,
  };
  const transaction = {
    visible: false,
    raw_data: {
      contract: [
        {
          parameter: {
            value,
            type_url: `type.googleapis.com/protocol.${kind}`,
          },
          type: kind,
          Permission_id: permissionId,
        },
      ],
      ref_block_bytes: "1234",
      ref_block_hash: BLOCK_HASH_REF,
      expiration: Date.now() + 60_000,
      timestamp: Date.now(),
    },
  } as Record<string, unknown> & { raw_data: Record<string, unknown> };
  const transactionPb = tronUtils.transaction.txJsonToPb(transaction);
  return {
    ...transaction,
    raw_data_hex: tronUtils.transaction.txPbToRawDataHex(transactionPb),
    txID: tronUtils.transaction.txPbToTxID(transactionPb).replace(/^0x/, ""),
  };
}

const resourceOwnerSigner: TronResourceOwnerSigner = {
  getAddress: vi.fn(async () => OWNER),
  signResourceTransaction: vi.fn(async ({ transaction }) => transaction),
};

describe("TronWeb resource-sponsoring chain", () => {
  it("performs exact chain preflight and broadcasts the unchanged Approval bytes", async () => {
    const mock = createTronWebMock();
    const readContract = vi.fn().mockResolvedValueOnce(0n).mockResolvedValueOnce(2_000_000n);
    const chain = await createTronWebResourceSponsoringChain({
      tronWeb: mock.tronWeb,
      network: "tron:0xcd8690dc",
      resourceOwnerSigner,
      readContract,
      allowedAssets: [TOKEN],
      permissionId: 2,
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

  it("normalizes a Permit2-recovered 0x payer before TRON account and contract reads", async () => {
    const mock = createTronWebMock();
    const readContract = vi.fn().mockResolvedValueOnce(0n).mockResolvedValueOnce(2_000_000n);
    const chain = await createTronWebResourceSponsoringChain({
      tronWeb: mock.tronWeb,
      network: "tron:0xcd8690dc",
      resourceOwnerSigner,
      readContract,
      allowedAssets: [TOKEN],
      permissionId: 2,
    });

    await chain.preflight({ ...runtimeRequest(), payer: PAYER_EVM_HEX });

    expect(mock.tronWeb.trx.getAccount).toHaveBeenCalledWith(PAYER);
    expect(mock.tronWeb.trx.getAccountResources).toHaveBeenCalledWith(PAYER);
    expect(readContract).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ args: [PAYER, SPENDER] }),
    );
    expect(readContract).toHaveBeenNthCalledWith(2, expect.objectContaining({ args: [PAYER] }));
  });

  it("fails closed when the signed Approval TAPOS hash is not current", async () => {
    const mock = createTronWebMock();
    const chain = await createTronWebResourceSponsoringChain({
      tronWeb: mock.tronWeb,
      network: "tron:0xcd8690dc",
      resourceOwnerSigner,
      readContract: vi.fn(async () => 0n),
      allowedAssets: [TOKEN],
      permissionId: 2,
    });

    await expect(
      chain.preflight({ ...runtimeRequest(), approvalRefBlockHash: "ff".repeat(8) }),
    ).rejects.toThrow("approval_tapos_invalid");
    expect(mock.sendHexTransaction).not.toHaveBeenCalled();
  });

  it.each([
    ["wrong owner", { owner_address: `41${"22".repeat(20)}` }],
    ["wrong receiver", { receiver_address: `41${"33".repeat(20)}` }],
    ["wrong stake", { balance: 100_001 }],
    ["wrong resource", { resource: "BANDWIDTH" }],
    ["locked delegation", { lock: true }],
  ])("rejects a Resource Owner %s transaction before signing", async (_label, mutation) => {
    const mock = createTronWebMock();
    const unsigned = systemTransaction("DelegateResourceContract", mutation);
    vi.mocked(mock.tronWeb.transactionBuilder.delegateResource).mockResolvedValue(
      unsigned as never,
    );
    const signTransaction = vi.fn(async transaction => ({
      ...transaction,
      signature: ["11".repeat(65)],
    }));
    const chain = await createTronWebResourceSponsoringChain({
      tronWeb: mock.tronWeb,
      network: "tron:0xcd8690dc",
      resourceOwnerSigner: {
        getAddress: async () => OWNER,
        signResourceTransaction: ({ transaction }) => signTransaction(transaction),
      },
      readContract: vi.fn(async () => 0n),
      allowedAssets: [TOKEN],
      permissionId: 2,
    });

    await expect(
      chain.prepareDelegate(runtimeRequest(), {
        resource: "ENERGY",
        requiredUnits: 100n,
        delegatedUnits: 100n,
        stakeSun: 100_000n,
      }),
    ).rejects.toThrow("resource_owner_transaction_invalid");
    expect(signTransaction).not.toHaveBeenCalled();
  });

  it.each([
    ["wrong contract type", systemTransaction("UnDelegateResourceContract")],
    ["unexpected permission", systemTransaction("DelegateResourceContract", {}, 3)],
  ])("rejects a Resource Owner %s before signing", async (_label, unsigned) => {
    const mock = createTronWebMock();
    vi.mocked(mock.tronWeb.transactionBuilder.delegateResource).mockResolvedValue(
      unsigned as never,
    );
    const signTransaction = vi.fn(async transaction => transaction);
    const chain = await createTronWebResourceSponsoringChain({
      tronWeb: mock.tronWeb,
      network: "tron:0xcd8690dc",
      resourceOwnerSigner: {
        getAddress: async () => OWNER,
        signResourceTransaction: ({ transaction }) => signTransaction(transaction),
      },
      readContract: vi.fn(async () => 0n),
      allowedAssets: [TOKEN],
      permissionId: 2,
    });

    await expect(
      chain.prepareDelegate(runtimeRequest(), {
        resource: "ENERGY",
        requiredUnits: 100n,
        delegatedUnits: 100n,
        stakeSun: 100_000n,
      }),
    ).rejects.toThrow("resource_owner_transaction_invalid");
    expect(signTransaction).not.toHaveBeenCalled();
  });

  it("rejects an extra Resource Owner contract before signing", async () => {
    const mock = createTronWebMock();
    const unsigned = systemTransaction("DelegateResourceContract");
    const rawData = unsigned.raw_data as { contract: Array<Record<string, unknown>> };
    rawData.contract.push(structuredClone(rawData.contract[0]!));
    const transactionPb = tronUtils.transaction.txJsonToPb(unsigned);
    unsigned.raw_data_hex = tronUtils.transaction.txPbToRawDataHex(transactionPb);
    unsigned.txID = tronUtils.transaction.txPbToTxID(transactionPb).replace(/^0x/, "");
    vi.mocked(mock.tronWeb.transactionBuilder.delegateResource).mockResolvedValue(
      unsigned as never,
    );
    const signTransaction = vi.fn(async transaction => ({
      ...transaction,
      signature: ["11".repeat(65)],
    }));
    const chain = await createTronWebResourceSponsoringChain({
      tronWeb: mock.tronWeb,
      network: "tron:0xcd8690dc",
      resourceOwnerSigner: {
        getAddress: async () => OWNER,
        signResourceTransaction: ({ transaction }) => signTransaction(transaction),
      },
      readContract: vi.fn(async () => 0n),
      allowedAssets: [TOKEN],
      permissionId: 2,
    });

    await expect(
      chain.prepareDelegate(runtimeRequest(), {
        resource: "ENERGY",
        requiredUnits: 100n,
        delegatedUnits: 100n,
        stakeSun: 100_000n,
      }),
    ).rejects.toThrow("resource_owner_transaction_invalid");
    expect(signTransaction).not.toHaveBeenCalled();
  });

  it("rejects a wallet-signed transaction whose raw data differs from the validated intent", async () => {
    const mock = createTronWebMock();
    const unsigned = systemTransaction("DelegateResourceContract");
    const replacement = systemTransaction("DelegateResourceContract", {
      receiver_address: `41${"33".repeat(20)}`,
    });
    vi.mocked(mock.tronWeb.transactionBuilder.delegateResource).mockResolvedValue(
      unsigned as never,
    );
    const signTransaction = vi.fn(async () => ({
      ...replacement,
      signature: ["11".repeat(65)],
    }));
    const chain = await createTronWebResourceSponsoringChain({
      tronWeb: mock.tronWeb,
      network: "tron:0xcd8690dc",
      resourceOwnerSigner: {
        getAddress: async () => OWNER,
        signResourceTransaction: ({ transaction }) => signTransaction(transaction),
      },
      readContract: vi.fn(async () => 0n),
      allowedAssets: [TOKEN],
      permissionId: 2,
    });

    await expect(
      chain.prepareDelegate(runtimeRequest(), {
        resource: "ENERGY",
        requiredUnits: 100n,
        delegatedUnits: 100n,
        stakeSun: 100_000n,
      }),
    ).rejects.toThrow("resource_owner_signed_transaction_mismatch");
  });

  it("passes an exact network-bound resource intent to the Resource Owner signer", async () => {
    const mock = createTronWebMock();
    const unsigned = systemTransaction("DelegateResourceContract");
    vi.mocked(mock.tronWeb.transactionBuilder.delegateResource).mockResolvedValue(
      unsigned as never,
    );
    const signResourceTransaction = vi.fn(async ({ transaction }) => ({
      ...transaction,
      signature: ["11".repeat(65)],
    }));
    const chain = await createTronWebResourceSponsoringChain({
      tronWeb: mock.tronWeb,
      network: "tron:0xcd8690dc",
      resourceOwnerSigner: { getAddress: async () => OWNER, signResourceTransaction },
      readContract: vi.fn(async () => 0n),
      allowedAssets: [TOKEN],
      permissionId: 2,
    });

    await chain.prepareDelegate(runtimeRequest(), {
      resource: "ENERGY",
      requiredUnits: 100n,
      delegatedUnits: 100n,
      stakeSun: 100_000n,
    });

    expect(signResourceTransaction).toHaveBeenCalledWith({
      intent: {
        network: "tron:0xcd8690dc",
        action: "delegate",
        owner: OWNER,
        receiver: PAYER,
        resource: "ENERGY",
        stakeSun: "100000",
        lock: false,
        permissionId: 2,
      },
      transaction: unsigned,
    });
  });

  it("rejects a permission that is not an Active Permission for both resource actions", async () => {
    const mock = createTronWebMock();
    const unsigned = systemTransaction("DelegateResourceContract");
    vi.mocked(mock.tronWeb.transactionBuilder.delegateResource).mockResolvedValue(
      unsigned as never,
    );
    vi.mocked(mock.tronWeb.trx.getAccount).mockImplementation(async address =>
      address === OWNER
        ? ({
            address,
            type: 0,
            active_permission: [{ id: 2, operations: "00".repeat(32) }],
          } as never)
        : ({ address, type: 0 } as never),
    );
    const signResourceTransaction = vi.fn(async ({ transaction }) => ({
      ...transaction,
      signature: ["11".repeat(65)],
    }));
    const chain = await createTronWebResourceSponsoringChain({
      tronWeb: mock.tronWeb,
      network: "tron:0xcd8690dc",
      resourceOwnerSigner: { getAddress: async () => OWNER, signResourceTransaction },
      readContract: vi.fn(async () => 0n),
      allowedAssets: [TOKEN],
      permissionId: 2,
    });

    await expect(
      chain.prepareDelegate(runtimeRequest(), {
        resource: "ENERGY",
        requiredUnits: 100n,
        delegatedUnits: 100n,
        stakeSun: 100_000n,
      }),
    ).rejects.toThrow("resource_owner_permission_invalid");
    expect(signResourceTransaction).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from "vitest";
import type { Trc20ApprovalResourceSponsoringRequest } from "../../src/exact/extensions";
import {
  buildTrc20SponsoringPlan,
  createTrc20ApprovalResourceSponsoringRuntime,
  InMemoryTrc20SponsoringCoordinator,
  type PreparedTronAction,
  type Trc20ResourceSponsoringChain,
  type Trc20SponsoringCoordinator,
  type Trc20SponsoringOperation,
  type Trc20SponsoringPreflight,
  type TronActionResult,
} from "../../src/resource-sponsoring";

const APPROVAL_TX_ID = "a".repeat(64);
const PAYER = "TJRyWwFs9wTFGZg3JbrVriFbNfCug5tDeC";
const TOKEN = "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf";
const SPENDER = "TYQuuhGbEMxF7nZxUHV3uHJxAVVAegNU9h";

const request: Trc20ApprovalResourceSponsoringRequest = {
  network: "tron:0xcd8690dc",
  approvalTxID: APPROVAL_TX_ID,
  approvalTimestamp: String(Date.now()),
  approvalExpiration: String(Date.now() + 120_000),
  approvalFeeLimitSun: "100000000",
  approvalRefBlockBytes: "1234",
  approvalRefBlockHash: "0102030405060708",
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

function preflight(): Trc20SponsoringPreflight {
  return {
    accountActivated: true,
    accountIsContract: false,
    allowance: 0n,
    tokenBalance: 2_000_000n,
    estimatedEnergy: 100n,
    estimatedBandwidth: 300n,
    managementBandwidthAvailable: 2_000n,
    replacementCost: 10n,
    resources: {
      energyAvailable: 0n,
      stakedBandwidthAvailable: 0n,
      freeBandwidthAvailable: 0n,
      totalEnergyLimit: 1_000n,
      totalEnergyWeight: 1n,
      totalBandwidthLimit: 1_000n,
      totalBandwidthWeight: 1n,
    },
  };
}

function prepared(txID: string): PreparedTronAction {
  return { txID, signedTransaction: `signed-${txID}` };
}

function instrumentedCoordinator(persisted: Set<string>): Trc20SponsoringCoordinator {
  const base = new InMemoryTrc20SponsoringCoordinator({
    energyStakeSunCapacity: 1_000_000n,
    bandwidthStakeSunCapacity: 1_000_000n,
    managementBandwidthCapacity: 10_000n,
    budgetCapacity: 1_000n,
  });
  const remember = (operation: Trc20SponsoringOperation) => {
    operation.actions.forEach(action => persisted.add(action.txID));
  };
  return {
    runExclusive: (scope, work) => base.runExclusive(scope, work),
    async admit(operation) {
      const result = await base.admit(operation);
      if (result.kind === "created" || result.kind === "existing") remember(result.operation);
      return result;
    },
    async save(operation) {
      const saved = await base.save(operation);
      remember(saved);
      return saved;
    },
    listRecoverable: limit => base.listRecoverable(limit),
    markRecovered: operation => base.markRecovered(operation),
  };
}

function createHarness() {
  const persisted = new Set<string>();
  const broadcasts: string[] = [];
  const results = new Map<string, TronActionResult>();
  let allowanceSufficient = true;
  let resourcesDelegated = false;
  const ids = {
    delegateEnergy: "1".repeat(64),
    delegateBandwidth: "2".repeat(64),
    undelegateEnergy: "3".repeat(64),
    undelegateBandwidth: "4".repeat(64),
  };
  const chain: Trc20ResourceSponsoringChain = {
    preflight: vi.fn(async () => {
      const value = preflight();
      return resourcesDelegated
        ? {
            ...value,
            resources: {
              ...value.resources,
              energyAvailable: 100n,
              stakedBandwidthAvailable: 300n,
            },
          }
        : value;
    }),
    prepareDelegate: vi.fn(async (_request, leg) =>
      prepared(leg.resource === "ENERGY" ? ids.delegateEnergy : ids.delegateBandwidth),
    ),
    prepareUndelegate: vi.fn(async (_request, leg) =>
      prepared(leg.resource === "ENERGY" ? ids.undelegateEnergy : ids.undelegateBandwidth),
    ),
    broadcast: vi.fn(async action => {
      expect(persisted.has(action.txID)).toBe(true);
      broadcasts.push(action.txID);
      return action.txID;
    }),
    broadcastApproval: vi.fn(async () => {
      expect(persisted.has(APPROVAL_TX_ID)).toBe(true);
      broadcasts.push(APPROVAL_TX_ID);
      return APPROVAL_TX_ID;
    }),
    confirm: vi.fn(async txID => results.get(txID) ?? "confirmed"),
    resourcesVisible: vi.fn(async () => {
      resourcesDelegated = true;
      return true;
    }),
    allowanceSufficient: vi.fn(async () => allowanceSufficient),
    capacityRecovered: vi.fn(async () => true),
  };
  const runtime = createTrc20ApprovalResourceSponsoringRuntime({
    chain,
    coordinator: instrumentedCoordinator(persisted),
    policy: { preview: vi.fn(async () => ({ allowed: true, budgetUnits: 10n })) },
    energySafetyBps: 10_000n,
    bandwidthSafetyBps: 10_000n,
    maxEnergyPerApproval: 1_000n,
    maxBandwidthPerApproval: 1_000n,
    managementBandwidthPerAction: 300n,
  });
  return {
    runtime,
    chain,
    broadcasts,
    results,
    ids,
    setAllowanceSufficient(value: boolean) {
      allowanceSufficient = value;
    },
  };
}

describe("TRC-20 resource sizing", () => {
  it("does not combine free and staked Bandwidth pools", () => {
    const snapshot = preflight();
    const plan = buildTrc20SponsoringPlan(
      {
        ...snapshot,
        resources: {
          ...snapshot.resources,
          stakedBandwidthAvailable: 150n,
          freeBandwidthAvailable: 150n,
        },
      },
      {
        energySafetyBps: 10_000n,
        bandwidthSafetyBps: 10_000n,
        maxEnergyPerApproval: 1_000n,
        maxBandwidthPerApproval: 1_000n,
        managementBandwidthPerAction: 300n,
      },
    );

    expect(plan.legs).toEqual([
      { resource: "ENERGY", requiredUnits: 100n, delegatedUnits: 100n, stakeSun: 100_000n },
      {
        resource: "BANDWIDTH",
        requiredUnits: 300n,
        delegatedUnits: 150n,
        stakeSun: 150_000n,
      },
    ]);
    expect(plan.managementBandwidthRequired).toBe(1_200n);
  });
});

describe("TRC-20 Approval resource-sponsoring runtime", () => {
  it("persists, delegates, approves, and reclaims both resource legs in order", async () => {
    const harness = createHarness();
    const verified = await harness.runtime.verify(request);
    const result = await harness.runtime.sponsor(request);

    expect(verified).toEqual({ isValid: true });
    expect(result).toEqual({ success: true, approvalTransaction: APPROVAL_TX_ID });
    expect(harness.broadcasts).toEqual([
      harness.ids.delegateEnergy,
      harness.ids.delegateBandwidth,
      APPROVAL_TX_ID,
      harness.ids.undelegateEnergy,
      harness.ids.undelegateBandwidth,
    ]);
  });

  it("deduplicates concurrent retries by network, payer, and approval txID", async () => {
    const harness = createHarness();
    const results = await Promise.all([
      harness.runtime.sponsor(request),
      harness.runtime.sponsor(request),
      harness.runtime.sponsor(request),
    ]);

    expect(results.every(result => result.success)).toBe(true);
    expect(harness.broadcasts).toHaveLength(5);
  });

  it("does not undelegate while an Approval may still be included", async () => {
    const harness = createHarness();
    harness.results.set(APPROVAL_TX_ID, "unknown");
    harness.setAllowanceSufficient(false);

    const first = await harness.runtime.sponsor(request);
    expect(first).toMatchObject({ success: false, errorReason: "unknown_chain_state" });
    expect(harness.broadcasts).toEqual([
      harness.ids.delegateEnergy,
      harness.ids.delegateBandwidth,
      APPROVAL_TX_ID,
    ]);

    harness.results.set(APPROVAL_TX_ID, "confirmed");
    harness.setAllowanceSufficient(true);
    const retried = await harness.runtime.sponsor(request);
    expect(retried).toEqual({ success: true, approvalTransaction: APPROVAL_TX_ID });
    expect(harness.broadcasts.slice(-2)).toEqual([
      harness.ids.undelegateEnergy,
      harness.ids.undelegateBandwidth,
    ]);
  });

  it("treats a node-returned Approval txID mismatch as unknown, not safe to reclaim", async () => {
    const harness = createHarness();
    vi.mocked(harness.chain.broadcastApproval).mockResolvedValue("c".repeat(64));

    const result = await harness.runtime.sponsor(request);

    expect(result).toMatchObject({ success: false, errorReason: "broadcast_txid_mismatch" });
    expect(harness.broadcasts).toEqual([harness.ids.delegateEnergy, harness.ids.delegateBandwidth]);
    expect(harness.chain.prepareUndelegate).not.toHaveBeenCalled();
  });

  it("reclaims every confirmed leg when a later delegation fails", async () => {
    const harness = createHarness();
    harness.results.set(harness.ids.delegateBandwidth, "failed");

    const result = await harness.runtime.sponsor(request);

    expect(result).toMatchObject({ success: false, errorReason: "delegate_failed" });
    expect(harness.broadcasts).toEqual([
      harness.ids.delegateEnergy,
      harness.ids.delegateBandwidth,
      harness.ids.undelegateEnergy,
    ]);
    expect(harness.chain.broadcastApproval).not.toHaveBeenCalled();
  });

  it("reclaims resources without broadcasting Approval when visibility is insufficient", async () => {
    const harness = createHarness();
    vi.mocked(harness.chain.resourcesVisible).mockResolvedValue(false);

    const result = await harness.runtime.sponsor(request);

    expect(result).toMatchObject({
      success: false,
      errorReason: "delegated_resources_not_visible",
    });
    expect(harness.broadcasts).toEqual([
      harness.ids.delegateEnergy,
      harness.ids.delegateBandwidth,
      harness.ids.undelegateEnergy,
      harness.ids.undelegateBandwidth,
    ]);
    expect(harness.chain.broadcastApproval).not.toHaveBeenCalled();
  });

  it("re-estimates after delegation and refuses to expose the payer to a larger cost", async () => {
    const harness = createHarness();
    const initial = preflight();
    vi.mocked(harness.chain.preflight)
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce({
        ...initial,
        estimatedEnergy: 200n,
        resources: {
          ...initial.resources,
          energyAvailable: 100n,
          stakedBandwidthAvailable: 300n,
        },
      });

    const result = await harness.runtime.sponsor(request);

    expect(result).toMatchObject({ success: false, errorReason: "resource_estimate_changed" });
    expect(harness.chain.broadcastApproval).not.toHaveBeenCalled();
    expect(harness.broadcasts.slice(-2)).toEqual([
      harness.ids.undelegateEnergy,
      harness.ids.undelegateBandwidth,
    ]);
  });

  it("keeps consumed capacity reserved until explicit recovery reconciliation", async () => {
    const harness = createHarness();
    await harness.runtime.sponsor(request);
    const reconciled = await harness.runtime.reconcile();

    expect(reconciled).toEqual({ examined: 1, recovered: 1 });
    expect(harness.chain.capacityRecovered).toHaveBeenCalledTimes(1);
  });
});

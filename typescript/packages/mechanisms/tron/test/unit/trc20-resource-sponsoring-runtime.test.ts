import { describe, expect, it, vi } from "vitest";
import type { Trc20ApprovalResourceSponsoringRequest } from "../../src/shared/extensions/trc20ApprovalContract";
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
  requiredAllowance: "1000000",
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
    get: key => base.get(key),
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

function createHarness(
  approvalStrategy: "zero-first" | "direct-overwrite" | "unsupported" = "zero-first",
) {
  const persisted = new Set<string>();
  const broadcasts: string[] = [];
  const results = new Map<string, TronActionResult>();
  let allowanceSufficient = true;
  let preflightAllowance = 0n;
  let resourcesDelegated = false;
  const ids = {
    delegateEnergy: "1".repeat(64),
    delegateBandwidth: "2".repeat(64),
    undelegateEnergy: "3".repeat(64),
    undelegateBandwidth: "4".repeat(64),
  };
  const chain: Trc20ResourceSponsoringChain = {
    preflight: vi.fn(async () => {
      const value = { ...preflight(), allowance: preflightAllowance };
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
  const coordinator = instrumentedCoordinator(persisted);
  const runtime = createTrc20ApprovalResourceSponsoringRuntime({
    chain,
    coordinator,
    policy: { preview: vi.fn(async () => ({ allowed: true, budgetUnits: 10n })) },
    energySafetyBps: 10_000n,
    bandwidthSafetyBps: 10_000n,
    maxEnergyPerApproval: 1_000n,
    maxBandwidthPerApproval: 1_000n,
    managementBandwidthPerAction: 300n,
    approvalPolicy: { strategyFor: () => approvalStrategy },
  } as never);
  return {
    runtime,
    chain,
    coordinator,
    broadcasts,
    results,
    ids,
    setAllowanceSufficient(value: boolean) {
      allowanceSufficient = value;
    },
    setPreflightAllowance(value: bigint) {
      preflightAllowance = value;
    },
  };
}

function seededOperation(
  status: Trc20SponsoringOperation["status"],
  approvalStatus: "prepared" | "submitted" | "confirmed" = "confirmed",
): Trc20SponsoringOperation {
  return {
    key: `${request.network}:${request.approvalTxID}`,
    network: request.network,
    approvalTxID: request.approvalTxID,
    payer: request.payer,
    requestDigest: "seeded-operation",
    request: structuredClone(request),
    plan: {
      energyRequired: 100n,
      bandwidthRequired: 300n,
      managementBandwidthRequired: 1_200n,
      replacementCost: 10n,
      legs: [
        {
          resource: "ENERGY",
          requiredUnits: 100n,
          delegatedUnits: 100n,
          stakeSun: 100_000n,
        },
        {
          resource: "BANDWIDTH",
          requiredUnits: 300n,
          delegatedUnits: 300n,
          stakeSun: 300_000n,
        },
      ],
    },
    budgetUnits: 10n,
    status,
    actions: [
      {
        kind: "delegate",
        resource: "ENERGY",
        txID: "1".repeat(64),
        signedTransaction: "signed-energy-delegation",
        status: "confirmed",
      },
      {
        kind: "delegate",
        resource: "BANDWIDTH",
        txID: "2".repeat(64),
        signedTransaction: "signed-bandwidth-delegation",
        status: "confirmed",
      },
      {
        kind: "approval",
        txID: APPROVAL_TX_ID,
        signedTransaction: request.signedTransaction,
        status: approvalStatus,
      },
    ],
    revision: 0,
    createdAtMs: Date.now(),
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
  it("rejects an insufficient payment deadline before delegating resources", async () => {
    const harness = createHarness();

    const result = await harness.runtime.sponsor(request, {
      paymentDeadlineMs: Date.now() + 1_000,
      revalidate: async () => ({ isValid: true }),
    } as never);

    expect(result).toMatchObject({
      success: false,
      errorReason: "payment_deadline_too_short",
    });
    expect(harness.chain.prepareDelegate).not.toHaveBeenCalled();
    expect(harness.broadcasts).toEqual([]);
  });

  it("rejects a short Approval lifetime before delegating resources", async () => {
    const harness = createHarness();

    const result = await harness.runtime.sponsor({
      ...request,
      approvalExpiration: String(Date.now() + 1_000),
    });

    expect(result).toMatchObject({
      success: false,
      errorReason: "approval_transaction_expiring",
    });
    expect(harness.chain.prepareDelegate).not.toHaveBeenCalled();
    expect(harness.broadcasts).toEqual([]);
  });

  it("uses the selected operation allowance instead of the request price", async () => {
    const harness = createHarness();
    const result = await harness.runtime.verify({
      ...request,
      requiredAllowance: "3000000",
    });

    expect(result).toEqual({
      isValid: false,
      invalidReason: "insufficient_funds",
      invalidMessage: "insufficient_funds",
    });
  });

  it("permits a partial allowance only for an explicit direct-overwrite token", async () => {
    const harness = createHarness("direct-overwrite");
    harness.setPreflightAllowance(1n);

    const result = await harness.runtime.sponsor(request);

    expect(result).toEqual({ success: true, approvalTransaction: APPROVAL_TX_ID });
    expect(harness.chain.broadcastApproval).toHaveBeenCalledTimes(1);
  });

  it("resumes a 1.1 exact operation when the new request carries the default allowance", async () => {
    const harness = createHarness();
    harness.results.set(harness.ids.undelegateEnergy, "unknown");
    harness.results.set(harness.ids.undelegateBandwidth, "unknown");
    const legacyRequest = structuredClone(request);
    delete (legacyRequest as { requiredAllowance?: string }).requiredAllowance;

    const first = await harness.runtime.sponsor(legacyRequest);
    const retried = await harness.runtime.sponsor(request);

    expect(first.success).toBe(true);
    expect(retried).toMatchObject({ success: true });
    expect(retried).not.toHaveProperty("errorReason", "approval_transaction_reused");
  });

  it("revalidates the scheme after delegation and reclaims without broadcasting Approval", async () => {
    const harness = createHarness();
    const result = await harness.runtime.sponsor(request, {
      revalidate: async () => ({
        isValid: false,
        invalidReason: "scheme_authorization_expired",
        invalidMessage: "scheme authorization expired during delegation",
      }),
    });

    expect(result).toMatchObject({
      success: false,
      errorReason: "scheme_authorization_expired",
    });
    expect(harness.broadcasts).toEqual([
      harness.ids.delegateEnergy,
      harness.ids.delegateBandwidth,
      harness.ids.undelegateEnergy,
      harness.ids.undelegateBandwidth,
    ]);
    expect(harness.broadcasts).not.toContain(APPROVAL_TX_ID);
  });

  it("revalidates after Approval confirmation and reclaims before returning failure", async () => {
    const harness = createHarness();
    const revalidate = vi.fn().mockResolvedValueOnce({ isValid: true }).mockResolvedValueOnce({
      isValid: false,
      invalidReason: "scheme_authorization_expired",
      invalidMessage: "scheme authorization expired after Approval",
    });

    const result = await harness.runtime.sponsor(request, { revalidate });

    expect(result).toMatchObject({
      success: false,
      errorReason: "scheme_authorization_expired",
      approvalTransaction: APPROVAL_TX_ID,
    });
    expect(revalidate).toHaveBeenCalledTimes(2);
    expect(harness.broadcasts).toEqual([
      harness.ids.delegateEnergy,
      harness.ids.delegateBandwidth,
      APPROVAL_TX_ID,
      harness.ids.undelegateEnergy,
      harness.ids.undelegateBandwidth,
    ]);
  });

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

  it("fails closed without broadcasting when persistence is unavailable", async () => {
    const harness = createHarness();
    vi.spyOn(harness.coordinator, "save").mockRejectedValue(new Error("storage unavailable"));

    await expect(harness.runtime.sponsor(request)).rejects.toThrow("storage unavailable");

    expect(harness.broadcasts).toEqual([]);
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
    expect(result.approvalTransaction).toBeUndefined();
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

  it("recovers an existing operation before taking the sufficient-allowance shortcut", async () => {
    const harness = createHarness();
    harness.results.set(APPROVAL_TX_ID, "unknown");
    harness.setAllowanceSufficient(false);
    await harness.runtime.sponsor(request);

    harness.results.set(APPROVAL_TX_ID, "confirmed");
    harness.setAllowanceSufficient(true);
    harness.setPreflightAllowance(1_000_000n);
    const retried = await harness.runtime.sponsor(request);

    expect(retried).toEqual({ success: true, approvalTransaction: APPROVAL_TX_ID });
    expect(harness.broadcasts.slice(-2)).toEqual([
      harness.ids.undelegateEnergy,
      harness.ids.undelegateBandwidth,
    ]);
  });

  it.each([
    "delegating",
    "resources_visible",
    "approval_submitted",
    "approval_confirmed",
    "reclaiming",
  ] as const)("reconciles the %s crash window", async status => {
    const harness = createHarness();
    await harness.coordinator.admit(seededOperation(status));

    const reconciled = await harness.runtime.reconcile();

    expect(reconciled.examined).toBe(1);
    expect(harness.broadcasts).toEqual([
      harness.ids.undelegateEnergy,
      harness.ids.undelegateBandwidth,
    ]);
  });

  it("reconciles a submitted Approval action after restart", async () => {
    const harness = createHarness();
    await harness.coordinator.admit(seededOperation("approval_submitted", "submitted"));

    const reconciled = await harness.runtime.reconcile();

    expect(reconciled.examined).toBe(1);
    expect(harness.chain.confirm).toHaveBeenCalledWith(APPROVAL_TX_ID);
    expect(harness.broadcasts).toEqual([
      harness.ids.undelegateEnergy,
      harness.ids.undelegateBandwidth,
    ]);
  });

  it("does not reclaim when a prepared Approval may have been broadcast before the crash", async () => {
    const harness = createHarness();
    harness.results.set(APPROVAL_TX_ID, "unknown");
    harness.setAllowanceSufficient(false);
    await harness.coordinator.admit(seededOperation("approval_submitted", "prepared"));

    const reconciled = await harness.runtime.reconcile();

    expect(reconciled).toEqual({ examined: 1, recovered: 0 });
    expect(harness.chain.confirm).toHaveBeenCalledWith(APPROVAL_TX_ID);
    expect(harness.broadcasts).toEqual([]);
  });

  it("continues after durable Undelegate submission without waiting for its confirmation", async () => {
    const harness = createHarness();
    harness.results.set(harness.ids.undelegateEnergy, "unknown");
    harness.results.set(harness.ids.undelegateBandwidth, "unknown");

    const sponsored = await harness.runtime.sponsor(request);

    expect(sponsored).toEqual({ success: true, approvalTransaction: APPROVAL_TX_ID });
    expect(harness.broadcasts).toEqual([
      harness.ids.delegateEnergy,
      harness.ids.delegateBandwidth,
      APPROVAL_TX_ID,
      harness.ids.undelegateEnergy,
      harness.ids.undelegateBandwidth,
    ]);
    expect(harness.chain.confirm).not.toHaveBeenCalledWith(harness.ids.undelegateEnergy);
    expect(harness.chain.confirm).not.toHaveBeenCalledWith(harness.ids.undelegateBandwidth);

    harness.results.set(harness.ids.undelegateEnergy, "confirmed");
    harness.results.set(harness.ids.undelegateBandwidth, "confirmed");
    const reconciled = await harness.runtime.reconcile();
    expect(reconciled).toEqual({ examined: 1, recovered: 1 });
  });

  it("keeps an operation recoverable after a temporary reconciliation persistence failure", async () => {
    const harness = createHarness();
    await harness.coordinator.admit(seededOperation("approval_confirmed"));
    vi.spyOn(harness.coordinator, "save").mockRejectedValueOnce(
      new Error("storage temporarily unavailable"),
    );

    const interrupted = await harness.runtime.reconcile();
    const retried = await harness.runtime.reconcile();

    expect(interrupted).toEqual({ examined: 1, recovered: 0 });
    expect(retried).toEqual({ examined: 1, recovered: 1 });
    expect(harness.broadcasts).toEqual([
      harness.ids.undelegateEnergy,
      harness.ids.undelegateBandwidth,
    ]);
  });

  it("surfaces a recovery scan persistence outage to the worker", async () => {
    const harness = createHarness();
    vi.spyOn(harness.coordinator, "listRecoverable").mockRejectedValueOnce(
      new Error("storage unavailable"),
    );

    await expect(harness.runtime.reconcile()).rejects.toThrow("storage unavailable");
    expect(harness.broadcasts).toEqual([]);
  });

  it("replaces an Undelegate only after the original is confirmed failed", async () => {
    const harness = createHarness();
    await harness.runtime.sponsor(request);
    harness.results.set(harness.ids.undelegateEnergy, "failed");
    harness.results.set(harness.ids.undelegateBandwidth, "confirmed");
    const replacementTxID = "5".repeat(64);
    vi.mocked(harness.chain.prepareUndelegate).mockImplementation(async (_request, leg) =>
      prepared(leg.resource === "ENERGY" ? replacementTxID : harness.ids.undelegateBandwidth),
    );

    const reconciled = await harness.runtime.reconcile();

    expect(reconciled).toEqual({ examined: 1, recovered: 1 });
    expect(harness.broadcasts).toContain(replacementTxID);
  });
});

describe("TRC-20 sponsoring coordinator recovery scan", () => {
  it.each([
    "admitted",
    "delegating",
    "resources_visible",
    "approval_submitted",
    "approval_confirmed",
    "reclaiming",
    "sponsored_recovering",
    "failed_recovering",
  ] as const)("returns the %s state for recovery", async status => {
    const coordinator = new InMemoryTrc20SponsoringCoordinator();
    await coordinator.admit(seededOperation(status));

    const recoverable = await coordinator.listRecoverable(10);

    expect(recoverable.map(operation => operation.status)).toEqual([status]);
  });

  it("blocks a second operation while the payer still has outstanding sponsored resources", async () => {
    const coordinator = new InMemoryTrc20SponsoringCoordinator();
    await coordinator.admit(seededOperation("sponsored_recovering"));
    const secondTxID = "b".repeat(64);
    const second = seededOperation("admitted");

    const admission = await coordinator.admit({
      ...second,
      key: `${second.network}:${secondTxID}`,
      approvalTxID: secondTxID,
      requestDigest: "second-operation",
      request: { ...second.request, approvalTxID: secondTxID },
    });

    expect(admission).toMatchObject({
      kind: "denied",
      reason: "sponsor_operation_in_progress",
    });
  });
});

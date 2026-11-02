import { describe, expect, it } from "vitest";
import {
  buildTrc20SponsoringPlan,
  InMemoryTrc20SponsoringCoordinator,
} from "../../src/trc20-approval-resource-sponsoring/runtime";
import type {
  Trc20SponsoringPreflight,
  Trc20SponsoringOperation,
} from "../../src/trc20-approval-resource-sponsoring/runtime";

const snapshot: Trc20SponsoringPreflight = {
  accountActivated: true,
  accountIsContract: false,
  allowance: 0n,
  tokenBalance: 1_000_000n,
  estimatedEnergy: 34_032n,
  estimatedBandwidth: 380n,
  managementBandwidthAvailable: 10_000n,
  replacementCost: 0n,
  resources: {
    energyAvailable: 0n,
    stakedBandwidthAvailable: 0n,
    freeBandwidthAvailable: 0n,
    totalEnergyWeight: 2_440_848_246n,
    totalEnergyLimit: 180_000_000_000n,
    totalBandwidthWeight: 68_421_341_650n,
    totalBandwidthLimit: 43_200_000_000n,
  },
};
const options = {
  energySafetyBps: 10_000n,
  bandwidthSafetyBps: 10_000n,
  maxEnergyPerApproval: 34_032n,
  maxBandwidthPerApproval: 380n,
  managementBandwidthPerAction: 300n,
};

describe("delegation weight drift", () => {
  it("still supplies the required Energy after the observed Nile weight increase", () => {
    const plan = buildTrc20SponsoringPlan(snapshot, options);
    const stake = plan.legs.find(leg => leg.resource === "ENERGY")!.stakeSun;
    // java-tron floors the resource entitlement using the new network weight.
    expect((stake * 180_000_000_000n) / (2_440_848_528n * 1_000_000n)).toBeGreaterThanOrEqual(
      34_032n,
    );
    expect(plan.energyRequired).toBe(34_032n);
    expect(stake).toBeLessThanOrEqual(466_097_873n);
  });

  it("also tolerates a small Bandwidth weight increase without raising the approval requirement", () => {
    const plan = buildTrc20SponsoringPlan(snapshot, options);
    const stake = plan.legs.find(leg => leg.resource === "BANDWIDTH")!.stakeSun;
    expect((stake * 43_200_000_000n) / (68_421_342_650n * 1_000_000n)).toBeGreaterThanOrEqual(380n);
    expect(plan.bandwidthRequired).toBe(380n);
    expect(stake).toBeLessThanOrEqual(607_872_939n);
  });

  it("does not create delegations when resources already cover the approval", () => {
    const plan = buildTrc20SponsoringPlan(
      {
        ...snapshot,
        resources: {
          ...snapshot.resources,
          energyAvailable: 34_032n,
          freeBandwidthAvailable: 380n,
        },
      },
      options,
    );
    expect(plan.legs).toEqual([]);
    expect(plan.managementBandwidthRequired).toBe(0n);
  });

  it("charges the buffered stake against admission capacity", async () => {
    const plan = buildTrc20SponsoringPlan(snapshot, options);
    const coordinator = new InMemoryTrc20SponsoringCoordinator({
      energyStakeSunCapacity: 461_483_042n,
    });
    const operation = {
      key: "weight-drift",
      network: "tron:3448148188",
      payer: "payer",
      requestDigest: "weight-drift",
      plan,
      actions: [],
      status: "admitted",
      budgetUnits: 0n,
      createdAtMs: Date.now(),
      revision: 0,
    } as unknown as Trc20SponsoringOperation;
    expect((await coordinator.admit(operation)).kind).toBe("denied");
  });
});

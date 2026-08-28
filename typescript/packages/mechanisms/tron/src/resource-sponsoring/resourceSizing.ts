import type { Trc20ResourceLeg, Trc20SponsoringPlan, Trc20SponsoringPreflight } from "./types";

const BPS_DENOMINATOR = 10_000n;
const SUN_PER_TRX = 1_000_000n;

/**
 * Divides non-negative integers and rounds toward positive infinity.
 *
 * @param value - Dividend.
 * @param divisor - Positive divisor.
 * @returns Rounded-up quotient.
 */
function ceilDiv(value: bigint, divisor: bigint): bigint {
  if (divisor <= 0n) throw new Error("resource limit must be positive");
  if (value <= 0n) return 0n;
  return (value + divisor - 1n) / divisor;
}

/**
 * Applies a safety multiplier expressed in basis points.
 *
 * @param value - Resource estimate to expand.
 * @param basisPoints - Multiplier where 10,000 means 100 percent.
 * @returns Resource units after rounding up.
 */
function applySafetyMargin(value: bigint, basisPoints: bigint): bigint {
  if (value < 0n) throw new Error("resource estimate cannot be negative");
  if (basisPoints < BPS_DENOMINATOR) throw new Error("resource safety margin cannot be below 100%");
  return ceilDiv(value * basisPoints, BPS_DENOMINATOR);
}

/**
 * Converts resource units to the Stake 2.0 balance delegated on-chain, in SUN.
 * Total resource weight is denominated in whole TRX by java-tron APIs.
 *
 * @param units - Resource units to provision.
 * @param totalWeightTrx - Current network resource weight in TRX.
 * @param totalLimit - Current total network resource limit.
 * @returns Stake 2.0 balance to delegate in SUN.
 */
export function resourceUnitsToStakeSun(
  units: bigint,
  totalWeightTrx: bigint,
  totalLimit: bigint,
): bigint {
  if (units <= 0n) return 0n;
  if (totalWeightTrx <= 0n || totalLimit <= 0n) {
    throw new Error("invalid network resource parameters");
  }
  return ceilDiv(units * totalWeightTrx * SUN_PER_TRX, totalLimit);
}

/**
 * Builds the immutable Energy/Bandwidth delegation plan for one Approval.
 *
 * @param preflight - Current account and network resource state.
 * @param options - Resource safety margins and hard bounds.
 * @param options.energySafetyBps - Energy safety multiplier in basis points.
 * @param options.bandwidthSafetyBps - Bandwidth safety multiplier in basis points.
 * @param options.maxEnergyPerApproval - Maximum sponsored Energy per Approval.
 * @param options.maxBandwidthPerApproval - Maximum sponsored Bandwidth per Approval.
 * @param options.managementBandwidthPerAction - Reserved owner Bandwidth per system action.
 * @returns Immutable resource and capacity reservation plan.
 */
export function buildTrc20SponsoringPlan(
  preflight: Trc20SponsoringPreflight,
  options: {
    readonly energySafetyBps: bigint;
    readonly bandwidthSafetyBps: bigint;
    readonly maxEnergyPerApproval: bigint;
    readonly maxBandwidthPerApproval: bigint;
    readonly managementBandwidthPerAction: bigint;
  },
): Trc20SponsoringPlan {
  const energyRequired = applySafetyMargin(preflight.estimatedEnergy, options.energySafetyBps);
  const bandwidthRequired = applySafetyMargin(
    preflight.estimatedBandwidth,
    options.bandwidthSafetyBps,
  );
  if (energyRequired > options.maxEnergyPerApproval) {
    throw new Error("approval_energy_exceeds_cap");
  }
  if (bandwidthRequired > options.maxBandwidthPerApproval) {
    throw new Error("approval_bandwidth_exceeds_cap");
  }

  const legs: Trc20ResourceLeg[] = [];
  const energyShortfall =
    energyRequired > preflight.resources.energyAvailable
      ? energyRequired - preflight.resources.energyAvailable
      : 0n;
  if (energyShortfall > 0n) {
    legs.push({
      resource: "ENERGY",
      requiredUnits: energyRequired,
      delegatedUnits: energyShortfall,
      stakeSun: resourceUnitsToStakeSun(
        energyShortfall,
        preflight.resources.totalEnergyWeight,
        preflight.resources.totalEnergyLimit,
      ),
    });
  }

  // TRON does not combine the staked/delegated and free Bandwidth pools for a
  // transaction. Delegate only when neither pool independently covers it, and
  // bring the staked pool up to the complete signed-transaction requirement.
  const bandwidthCovered =
    preflight.resources.stakedBandwidthAvailable >= bandwidthRequired ||
    preflight.resources.freeBandwidthAvailable >= bandwidthRequired;
  if (!bandwidthCovered && bandwidthRequired > 0n) {
    const bandwidthShortfall =
      bandwidthRequired > preflight.resources.stakedBandwidthAvailable
        ? bandwidthRequired - preflight.resources.stakedBandwidthAvailable
        : 0n;
    legs.push({
      resource: "BANDWIDTH",
      requiredUnits: bandwidthRequired,
      delegatedUnits: bandwidthShortfall,
      stakeSun: resourceUnitsToStakeSun(
        bandwidthShortfall,
        preflight.resources.totalBandwidthWeight,
        preflight.resources.totalBandwidthLimit,
      ),
    });
  }

  const managementBandwidthRequired =
    BigInt(legs.length) * 2n * options.managementBandwidthPerAction;
  if (managementBandwidthRequired > preflight.managementBandwidthAvailable) {
    throw new Error("management_bandwidth_unavailable");
  }
  return {
    energyRequired,
    bandwidthRequired,
    managementBandwidthRequired,
    legs,
    replacementCost: preflight.replacementCost ?? 0n,
  };
}

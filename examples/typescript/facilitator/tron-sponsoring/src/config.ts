/** Validated operational configuration for the standalone sponsoring Facilitator. */

const DEFAULT_ASSET = 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf'

function positiveInteger(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] || String(fallback), 10)
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
  return value
}

function positiveBigInt(name: string, fallback: bigint): bigint {
  const raw = process.env[name]?.trim() || fallback.toString()
  try {
    const value = BigInt(raw)
    if (value <= 0n) throw new Error()
    return value
  } catch {
    throw new Error(`${name} must be a positive integer`)
  }
}

const permissionId = positiveInteger('TRON_PERMISSION_ID', 0)

export const facilitatorConfig = {
  port: positiveInteger('FACILITATOR_PORT', 4042),
  permissionId,
  rpcUrl: process.env.TRON_NILE_RPC_URL?.trim() || undefined,
  apiKey: process.env.TRON_GRID_API_KEY?.trim() || undefined,
  allowedAsset: process.env.TRON_SPONSORING_ASSET?.trim() || DEFAULT_ASSET,
  recoveryIntervalMs: positiveInteger('TRON_SPONSORING_RECOVERY_INTERVAL_MS', 15_000),
  energyStakeSunCapacity: positiveBigInt(
    'TRON_SPONSORING_ENERGY_STAKE_SUN_CAPACITY',
    2_000_000_000n,
  ),
  bandwidthStakeSunCapacity: positiveBigInt(
    'TRON_SPONSORING_BANDWIDTH_STAKE_SUN_CAPACITY',
    2_000_000_000n,
  ),
  budgetCapacity: positiveBigInt('TRON_SPONSORING_BUDGET_CAPACITY', 100_000_000n),
  managementBandwidthCapacity: positiveBigInt(
    'TRON_SPONSORING_MANAGEMENT_BANDWIDTH_CAPACITY',
    10_000n,
  ),
} as const

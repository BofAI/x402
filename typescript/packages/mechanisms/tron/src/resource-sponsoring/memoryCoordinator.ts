import type {
  Trc20SponsoringAdmission,
  Trc20SponsoringCoordinator,
  Trc20SponsoringOperation,
} from "./types";

/** Capacity limits for the development/test coordinator. */
export interface InMemoryTrc20SponsoringCoordinatorOptions {
  readonly energyStakeSunCapacity?: bigint;
  readonly bandwidthStakeSunCapacity?: bigint;
  readonly budgetCapacity?: bigint;
  readonly managementBandwidthCapacity?: bigint;
}

/**
 * Sums the delegated Stake 2.0 balance for one resource type.
 *
 * @param operation - Sponsorship operation to inspect.
 * @param resource - Resource type to total.
 * @returns Delegated stake balance in SUN.
 */
function operationResourceStake(
  operation: Trc20SponsoringOperation,
  resource: "ENERGY" | "BANDWIDTH",
): bigint {
  return operation.plan.legs
    .filter(leg => leg.resource === resource)
    .reduce((sum, leg) => sum + leg.stakeSun, 0n);
}

/**
 * Copies an operation so callers cannot mutate coordinator state by reference.
 *
 * @param operation - Operation to copy.
 * @returns A deep copy of the operation.
 */
function cloneOperation(operation: Trc20SponsoringOperation): Trc20SponsoringOperation {
  return structuredClone(operation);
}

/**
 * Detects a confirmed or potentially submitted delegation without confirmed reclamation.
 *
 * @param operation - Operation to inspect.
 * @returns Whether a resource delegation may still be outstanding.
 */
function hasOutstandingDelegation(operation: Trc20SponsoringOperation): boolean {
  return operation.plan.legs.some(leg => {
    const delegated = operation.actions.find(
      action => action.kind === "delegate" && action.resource === leg.resource,
    );
    const reclaimed = operation.actions.find(
      action => action.kind === "undelegate" && action.resource === leg.resource,
    );
    return delegated != null && delegated.status !== "failed" && reclaimed?.status !== "confirmed";
  });
}

/**
 * Process-local coordinator for unit tests and single-process development.
 *
 * It is intentionally never selected by default. Production deployments must
 * provide a shared durable implementation with the same atomic contracts.
 */
export class InMemoryTrc20SponsoringCoordinator implements Trc20SponsoringCoordinator {
  private readonly operations = new Map<string, Trc20SponsoringOperation>();
  private readonly lockTails = new Map<string, Promise<void>>();
  private readonly energyCapacity: bigint;
  private readonly bandwidthCapacity: bigint;
  private readonly budgetCapacity: bigint;
  private readonly managementBandwidthCapacity: bigint;

  /**
   * Creates a process-local coordinator with explicit capacity limits.
   *
   * @param options - Development and test capacity limits.
   */
  constructor(options: InMemoryTrc20SponsoringCoordinatorOptions = {}) {
    this.energyCapacity = options.energyStakeSunCapacity ?? 1n << 255n;
    this.bandwidthCapacity = options.bandwidthStakeSunCapacity ?? 1n << 255n;
    this.budgetCapacity = options.budgetCapacity ?? 1n << 255n;
    this.managementBandwidthCapacity = options.managementBandwidthCapacity ?? 1n << 255n;
  }

  /**
   * Serializes work for a payer scope inside this process.
   *
   * @param scope - Lock scope, normally `(network,payer)`.
   * @param work - Asynchronous operation to run exclusively.
   * @returns The operation result.
   */
  async runExclusive<T>(scope: string, work: () => Promise<T>): Promise<T> {
    const previous = this.lockTails.get(scope) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>(resolve => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.lockTails.set(scope, tail);
    await previous;
    try {
      return await work();
    } finally {
      release();
      if (this.lockTails.get(scope) === tail) this.lockTails.delete(scope);
    }
  }

  /**
   * Atomically checks idempotency, payer activity, budget, and resource capacity.
   *
   * @param operation - Candidate operation and immutable reservation plan.
   * @returns Admission outcome and stored operation when accepted.
   */
  async admit(operation: Trc20SponsoringOperation): Promise<Trc20SponsoringAdmission> {
    const existing = this.operations.get(operation.key);
    if (existing) {
      return existing.requestDigest === operation.requestDigest
        ? { kind: "existing", operation: cloneOperation(existing) }
        : {
            kind: "conflict",
            reason: "approval_transaction_reused",
            message: "approvalTxID is already bound to a different payment",
          };
    }

    const activeForPayer = [...this.operations.values()].find(
      candidate =>
        candidate.network === operation.network &&
        candidate.payer === operation.payer &&
        candidate.key !== operation.key &&
        candidate.status !== "recovered" &&
        candidate.status !== "sponsored_recovering" &&
        hasOutstandingDelegation(candidate),
    );
    if (activeForPayer) {
      return {
        kind: "denied",
        reason: "sponsor_operation_in_progress",
        message: "payer already has an active sponsorship operation",
      };
    }

    const reserved = [...this.operations.values()].filter(
      candidate => candidate.status !== "recovered",
    );
    const energyReserved = reserved.reduce(
      (sum, candidate) => sum + operationResourceStake(candidate, "ENERGY"),
      0n,
    );
    const bandwidthReserved = reserved.reduce(
      (sum, candidate) => sum + operationResourceStake(candidate, "BANDWIDTH"),
      0n,
    );
    const budgetReserved = reserved.reduce((sum, candidate) => sum + candidate.budgetUnits, 0n);
    const managementBandwidthReserved = reserved.reduce(
      (sum, candidate) => sum + candidate.plan.managementBandwidthRequired,
      0n,
    );
    if (
      energyReserved + operationResourceStake(operation, "ENERGY") > this.energyCapacity ||
      bandwidthReserved + operationResourceStake(operation, "BANDWIDTH") > this.bandwidthCapacity ||
      budgetReserved + operation.budgetUnits > this.budgetCapacity ||
      managementBandwidthReserved + operation.plan.managementBandwidthRequired >
        this.managementBandwidthCapacity
    ) {
      return {
        kind: "denied",
        reason: "sponsor_capacity_unavailable",
        message: "resource or sponsorship budget capacity is unavailable",
      };
    }

    const stored = cloneOperation(operation);
    this.operations.set(operation.key, stored);
    return { kind: "created", operation: cloneOperation(stored) };
  }

  /**
   * Persists an optimistic state transition.
   *
   * @param operation - Operation carrying the expected revision.
   * @returns Saved operation with its revision incremented.
   */
  async save(operation: Trc20SponsoringOperation): Promise<Trc20SponsoringOperation> {
    const current = this.operations.get(operation.key);
    if (!current) throw new Error("sponsorship operation does not exist");
    if (current.revision !== operation.revision) {
      throw new Error("sponsorship operation revision conflict");
    }
    const next = { ...cloneOperation(operation), revision: operation.revision + 1 };
    this.operations.set(operation.key, next);
    return cloneOperation(next);
  }

  /**
   * Lists operations requiring reconciliation or capacity recovery checks.
   *
   * @param limit - Maximum number of operations to return.
   * @returns Deep copies of recoverable operations.
   */
  async listRecoverable(limit: number): Promise<readonly Trc20SponsoringOperation[]> {
    return [...this.operations.values()]
      .filter(
        operation =>
          operation.status === "sponsored_recovering" ||
          operation.status === "failed_recovering" ||
          operation.actions.some(action => action.status === "unknown"),
      )
      .slice(0, Math.max(0, limit))
      .map(cloneOperation);
  }

  /**
   * Marks an operation recovered and releases its in-memory reservations.
   *
   * @param operation - Operation whose capacity is clean again.
   * @returns Saved recovered operation.
   */
  async markRecovered(operation: Trc20SponsoringOperation): Promise<Trc20SponsoringOperation> {
    return this.save({ ...operation, status: "recovered" });
  }
}

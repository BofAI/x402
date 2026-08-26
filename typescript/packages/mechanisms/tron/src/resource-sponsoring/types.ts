import type {
  Trc20ApprovalResourceSponsoringRequest,
  Trc20ApprovalResourceSponsoringRuntime,
} from "../exact/extensions";

/** TRON resources that can be delegated with Stake 2.0. */
export type TronResourceType = "ENERGY" | "BANDWIDTH";

/** Resource values observed for the payer and the network. */
export interface TronResourceSnapshot {
  readonly energyAvailable: bigint;
  readonly stakedBandwidthAvailable: bigint;
  readonly freeBandwidthAvailable: bigint;
  readonly totalEnergyLimit: bigint;
  readonly totalEnergyWeight: bigint;
  readonly totalBandwidthLimit: bigint;
  readonly totalBandwidthWeight: bigint;
}

/** Chain state used for read-only verification and settlement admission. */
export interface Trc20SponsoringPreflight {
  readonly accountActivated: boolean;
  readonly accountIsContract: boolean;
  readonly allowance: bigint;
  readonly tokenBalance: bigint;
  readonly estimatedEnergy: bigint;
  readonly estimatedBandwidth: bigint;
  readonly resources: TronResourceSnapshot;
  /** Resource Owner Bandwidth available for Delegate/UnDelegate actions. */
  readonly managementBandwidthAvailable: bigint;
  /** Optional deployment-defined replacement cost used by policy accounting. */
  readonly replacementCost?: bigint;
}

/** One resource delegation required by an Approval. */
export interface Trc20ResourceLeg {
  readonly resource: TronResourceType;
  /** Resource units that must be visible on the payer before broadcast. */
  readonly requiredUnits: bigint;
  /** Resource units missing before delegation. */
  readonly delegatedUnits: bigint;
  /** Stake 2.0 share delegated by the Resource Owner, in SUN. */
  readonly stakeSun: bigint;
}

/** Immutable resource plan admitted for one sponsorship operation. */
export interface Trc20SponsoringPlan {
  readonly energyRequired: bigint;
  readonly bandwidthRequired: bigint;
  /** Bandwidth reserved for every Delegate/UnDelegate system transaction. */
  readonly managementBandwidthRequired: bigint;
  readonly legs: readonly Trc20ResourceLeg[];
  readonly replacementCost: bigint;
}

/** A signed chain action that must be persisted before it is broadcast. */
export interface PreparedTronAction {
  readonly txID: string;
  /** Deployment-defined serialized signed transaction, replayed byte-for-byte. */
  readonly signedTransaction: string;
}

/** Observable terminality of a previously prepared action. */
export type TronActionResult = "confirmed" | "failed" | "unknown";

/** Chain operations required by the resource-sponsoring state machine. */
export interface Trc20ResourceSponsoringChain {
  /** Performs exact Approval simulation and all mutable account/resource reads. */
  preflight(request: Trc20ApprovalResourceSponsoringRequest): Promise<Trc20SponsoringPreflight>;
  /** Builds and signs, but does not broadcast, a Stake 2.0 delegation. */
  prepareDelegate(
    request: Trc20ApprovalResourceSponsoringRequest,
    leg: Trc20ResourceLeg,
  ): Promise<PreparedTronAction>;
  /** Builds and signs, but does not broadcast, the matching undelegation. */
  prepareUndelegate(
    request: Trc20ApprovalResourceSponsoringRequest,
    leg: Trc20ResourceLeg,
  ): Promise<PreparedTronAction>;
  /** Broadcasts the exact prepared bytes. Replaying the same txID must be safe. */
  broadcast(action: PreparedTronAction): Promise<string>;
  /** Broadcasts the Client-signed Approval bytes without reconstructing them. */
  broadcastApproval(signedTransaction: string): Promise<string>;
  /** Waits for a prepared txID to reach the deployment's confirmation threshold. */
  confirm(txID: string): Promise<TronActionResult>;
  /** Confirms every planned resource is visible and sufficient on the payer. */
  resourcesVisible(
    request: Trc20ApprovalResourceSponsoringRequest,
    plan: Trc20SponsoringPlan,
  ): Promise<boolean>;
  /** Confirms the canonical Permit2 allowance is now sufficient. */
  allowanceSufficient(request: Trc20ApprovalResourceSponsoringRequest): Promise<boolean>;
  /** Confirms reserved Resource Owner capacity is clean and reusable again. */
  capacityRecovered(operation: Trc20SponsoringOperation): Promise<boolean>;
}

/** Read-only policy decision. Capacity is reserved later by the coordinator. */
export interface Trc20SponsoringPolicyDecision {
  readonly allowed: boolean;
  readonly reason?: string;
  readonly message?: string;
  /** Deployment-defined credit/budget units atomically reserved at admission. */
  readonly budgetUnits?: bigint;
}

/** Deployment policy for token admission, loss bounds, and tenant credit. */
export interface Trc20ResourceSponsoringPolicy {
  preview(
    request: Trc20ApprovalResourceSponsoringRequest,
    plan: Trc20SponsoringPlan,
  ): Promise<Trc20SponsoringPolicyDecision>;
}

/** Kinds of durable chain actions in one sponsorship saga. */
export type Trc20SponsoringActionKind = "delegate" | "approval" | "undelegate";

/** Durable action status. */
export type Trc20SponsoringActionStatus =
  | "prepared"
  | "submitted"
  | "confirmed"
  | "failed"
  | "unknown";

/** Persisted immutable bytes and mutable observation for one chain action. */
export interface Trc20SponsoringAction {
  readonly kind: Trc20SponsoringActionKind;
  readonly resource?: TronResourceType;
  readonly txID: string;
  readonly signedTransaction: string;
  readonly status: Trc20SponsoringActionStatus;
}

/** Sponsorship lifecycle state, separate from the later Permit2 settlement. */
export type Trc20SponsoringOperationStatus =
  | "admitted"
  | "delegating"
  | "resources_visible"
  | "approval_submitted"
  | "approval_confirmed"
  | "reclaiming"
  | "sponsored_recovering"
  | "failed_recovering"
  | "recovered";

/** Durable sponsorship operation. BigInt values remain native inside the SDK. */
export interface Trc20SponsoringOperation {
  readonly key: string;
  readonly network: string;
  readonly approvalTxID: string;
  readonly payer: string;
  readonly requestDigest: string;
  readonly request: Trc20ApprovalResourceSponsoringRequest;
  readonly plan: Trc20SponsoringPlan;
  readonly budgetUnits: bigint;
  readonly status: Trc20SponsoringOperationStatus;
  readonly actions: readonly Trc20SponsoringAction[];
  readonly revision: number;
  readonly createdAtMs: number;
  readonly recoveryStartedAtMs?: number;
  readonly errorReason?: string;
  readonly errorMessage?: string;
}

/** Atomic admission result returned by a sponsorship coordinator. */
export type Trc20SponsoringAdmission =
  | { readonly kind: "created"; readonly operation: Trc20SponsoringOperation }
  | { readonly kind: "existing"; readonly operation: Trc20SponsoringOperation }
  | { readonly kind: "conflict"; readonly reason: string; readonly message?: string }
  | { readonly kind: "denied"; readonly reason: string; readonly message?: string };

/**
 * Durable operation, idempotency, payer-serialization, capacity, and budget boundary.
 *
 * Production implementations MUST share state across all Facilitator replicas.
 */
export interface Trc20SponsoringCoordinator {
  /** Serializes mutations for one `(network,payer)` scope. */
  runExclusive<T>(scope: string, work: () => Promise<T>): Promise<T>;
  /** Loads an existing operation before mutable chain-state shortcuts are evaluated. */
  get(key: string): Promise<Trc20SponsoringOperation | undefined>;
  /** Atomically creates an operation and reserves its resource/budget capacity. */
  admit(operation: Trc20SponsoringOperation): Promise<Trc20SponsoringAdmission>;
  /** Persists a state transition with optimistic revision checking. */
  save(operation: Trc20SponsoringOperation): Promise<Trc20SponsoringOperation>;
  /** Lists operations requiring unknown-state or recovery reconciliation. */
  listRecoverable(limit: number): Promise<readonly Trc20SponsoringOperation[]>;
  /** Releases capacity only after the chain driver observes it clean and reusable. */
  markRecovered(operation: Trc20SponsoringOperation): Promise<Trc20SponsoringOperation>;
}

/** Configurable bounds for the reference resource-sponsoring runtime. */
export interface Trc20ResourceSponsoringRuntimeOptions {
  readonly chain: Trc20ResourceSponsoringChain;
  readonly coordinator: Trc20SponsoringCoordinator;
  readonly policy: Trc20ResourceSponsoringPolicy;
  /** Safety margin applied to the exact Energy estimate. Default 12000 (120%). */
  readonly energySafetyBps?: bigint;
  /** Safety margin applied to the signed transaction Bandwidth. Default 11000 (110%). */
  readonly bandwidthSafetyBps?: bigint;
  /** Hard upper bound after the safety margin. */
  readonly maxEnergyPerApproval?: bigint;
  /** Hard upper bound after the safety margin. */
  readonly maxBandwidthPerApproval?: bigint;
  /** Reserved per Delegate/UnDelegate action. Default 350 Bandwidth. */
  readonly managementBandwidthPerAction?: bigint;
}

/** Runtime plus explicit background reconciliation entrypoint. */
export interface ManagedTrc20ApprovalResourceSponsoringRuntime
  extends Trc20ApprovalResourceSponsoringRuntime {
  reconcile(limit?: number): Promise<{ examined: number; recovered: number }>;
}

import { utils as tronUtils } from "tronweb";
import { buildTrc20SponsoringPlan } from "./resourceSizing";
import type {
  ManagedTrc20ApprovalResourceSponsoringRuntime,
  PreparedTronAction,
  Trc20ResourceSponsoringRuntimeOptions,
  Trc20SponsoringAction,
  Trc20SponsoringActionKind,
  Trc20SponsoringOperation,
  Trc20SponsoringOperationStatus,
  Trc20SponsoringPlan,
  Trc20SponsoringPreflight,
  TronResourceType,
} from "./types";
import type {
  Trc20ApprovalResourceSponsoringRequest,
  Trc20SponsorshipExecutionOptions,
} from "../shared/extensions/trc20ApprovalContract";

const DEFAULT_ENERGY_SAFETY_BPS = 12_000n;
const DEFAULT_BANDWIDTH_SAFETY_BPS = 11_000n;
const DEFAULT_MAX_ENERGY = 250_000n;
const DEFAULT_MAX_BANDWIDTH = 2_000n;
const DEFAULT_MANAGEMENT_BANDWIDTH_PER_ACTION = 350n;

/** Error carrying a stable sponsorship reason and optional durable operation state. */
class SponsoringFailure extends Error {
  /**
   * Creates a sponsorship failure.
   *
   * @param reason - Stable machine-readable reason.
   * @param message - Optional human-readable message.
   * @param operation - Latest durable operation state, when available.
   */
  constructor(
    readonly reason: string,
    message?: string,
    readonly operation?: Trc20SponsoringOperation,
  ) {
    super(message ?? reason);
  }
}

/**
 * Normalizes thrown values into a stable sponsorship failure.
 *
 * @param error - Value caught from a dependency.
 * @param fallbackReason - Reason used for unrecognized failures.
 * @param fallbackMessage - Message used for unrecognized failures.
 * @returns Normalized sponsorship failure.
 */
function normalizedFailure(error: unknown, fallbackReason: string, fallbackMessage: string) {
  if (error instanceof SponsoringFailure) return error;
  if (error instanceof Error && /^[a-z0-9_]+$/.test(error.message)) {
    return new SponsoringFailure(error.message);
  }
  return new SponsoringFailure(fallbackReason, fallbackMessage);
}

/**
 * Builds the deployment-wide idempotency key.
 *
 * @param request - Sponsorship request.
 * @returns Network-qualified Approval transaction key.
 */
function operationKey(request: Trc20ApprovalResourceSponsoringRequest): string {
  return `${request.network}:${request.approvalTxID.toLowerCase()}`;
}

/**
 * Builds the payer mutation-lock scope.
 *
 * @param request - Sponsorship request.
 * @returns Network-qualified payer scope.
 */
function payerScope(request: Trc20ApprovalResourceSponsoringRequest): string {
  return `${request.network}:${request.payer}`;
}

/**
 * Produces a deterministic JSON representation for request binding.
 *
 * @param value - JSON-compatible value that may contain bigint values.
 * @returns Canonical JSON string.
 */
function canonicalJson(value: unknown): string {
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

/**
 * Hashes every Approval and Payment field bound to an operation.
 *
 * @param request - Sponsorship request.
 * @returns Lowercase SHA-256 digest.
 */
function requestDigest(request: Trc20ApprovalResourceSponsoringRequest): string {
  // Version 1.1 persisted exact requests before `requiredAllowance` existed.
  // Its default value is already bound by paymentRequirements.amount, so omit
  // that redundant representation to keep durable retry digests compatible.
  let normalizedRequest:
    | Omit<Trc20ApprovalResourceSponsoringRequest, "requiredAllowance">
    | typeof request = request;
  if (
    request.requiredAllowance === undefined ||
    request.requiredAllowance === request.paymentRequirements.amount
  ) {
    const { requiredAllowance, ...legacyRequest } = request;
    void requiredAllowance;
    normalizedRequest = legacyRequest;
  }
  const bytes = new TextEncoder().encode(canonicalJson(normalizedRequest));
  return tronUtils.code.byteArray2hexStr(tronUtils.crypto.SHA256(bytes)).toLowerCase();
}

/**
 * Applies account, balance, and allowance state-machine checks.
 *
 * @param request - Sponsorship request.
 * @param preflight - Current chain state.
 * @returns Whether a new Approval is required or already satisfied.
 */
function validatePreflight(
  request: Trc20ApprovalResourceSponsoringRequest,
  preflight: Trc20SponsoringPreflight,
): "approval_required" | "approval_satisfied" {
  const requiredAllowance = BigInt(request.requiredAllowance ?? request.paymentRequirements.amount);
  if (!preflight.accountActivated) throw new SponsoringFailure("payer_account_not_activated");
  if (preflight.accountIsContract) throw new SponsoringFailure("payer_account_not_eoa");
  if (preflight.tokenBalance < requiredAllowance) {
    throw new SponsoringFailure("insufficient_funds");
  }
  if (preflight.allowance === 0n) return "approval_required";
  if (preflight.allowance >= requiredAllowance) return "approval_satisfied";
  throw new SponsoringFailure("approval_reset_required");
}

/**
 * Matches a durable action by logical kind and resource leg.
 *
 * @param action - Action to inspect.
 * @param kind - Expected action kind.
 * @param resource - Optional resource leg.
 * @returns Whether the action has the requested identity.
 */
function actionMatches(
  action: Trc20SponsoringAction,
  kind: Trc20SponsoringActionKind,
  resource?: TronResourceType,
): boolean {
  return action.kind === kind && action.resource === resource;
}

/**
 * Replaces or appends one logical durable action.
 *
 * @param operation - Operation to update.
 * @param nextAction - New immutable transaction bytes and mutable status.
 * @returns Updated operation value.
 */
function replaceAction(
  operation: Trc20SponsoringOperation,
  nextAction: Trc20SponsoringAction,
): Trc20SponsoringOperation {
  const found = operation.actions.some(action =>
    actionMatches(action, nextAction.kind, nextAction.resource),
  );
  const actions = found
    ? operation.actions.map(action =>
        actionMatches(action, nextAction.kind, nextAction.resource) ? nextAction : action,
      )
    : [...operation.actions, nextAction];
  return { ...operation, actions };
}

/**
 * Returns an operation with a new lifecycle status.
 *
 * @param operation - Operation to update.
 * @param status - New lifecycle status.
 * @returns Updated operation value.
 */
function withStatus(
  operation: Trc20SponsoringOperation,
  status: Trc20SponsoringOperationStatus,
): Trc20SponsoringOperation {
  return { ...operation, status };
}

/**
 * Locates one logical action in an operation.
 *
 * @param operation - Operation to inspect.
 * @param kind - Expected action kind.
 * @param resource - Optional resource leg.
 * @returns Matching action, if present.
 */
function actionFor(
  operation: Trc20SponsoringOperation,
  kind: Trc20SponsoringActionKind,
  resource?: TronResourceType,
): Trc20SponsoringAction | undefined {
  return operation.actions.find(action => actionMatches(action, kind, resource));
}

/**
 * Creates the first immutable operation record before chain-side effects.
 *
 * @param request - Fully bound sponsorship request.
 * @param plan - Admitted resource plan.
 * @param budgetUnits - Deployment-defined budget reservation.
 * @returns New operation ready for atomic admission.
 */
function initialOperation(
  request: Trc20ApprovalResourceSponsoringRequest,
  plan: Trc20SponsoringPlan,
  budgetUnits: bigint,
): Trc20SponsoringOperation {
  return {
    key: operationKey(request),
    network: request.network,
    approvalTxID: request.approvalTxID.toLowerCase(),
    payer: request.payer,
    requestDigest: requestDigest(request),
    request: structuredClone(request),
    plan,
    budgetUnits,
    status: "admitted",
    actions: [
      {
        kind: "approval",
        txID: request.approvalTxID.toLowerCase(),
        signedTransaction: request.signedTransaction,
        status: "prepared",
      },
    ],
    revision: 0,
    createdAtMs: Date.now(),
  };
}

/**
 * Creates the production-oriented, dependency-injected sponsoring state machine.
 *
 * @param options - Chain, coordinator, policy, and resource bounds.
 * @returns Managed runtime with verify, sponsor, and reconcile entrypoints.
 */
export function createTrc20ApprovalResourceSponsoringRuntime(
  options: Trc20ResourceSponsoringRuntimeOptions,
): ManagedTrc20ApprovalResourceSponsoringRuntime {
  const sizingOptions = {
    energySafetyBps: options.energySafetyBps ?? DEFAULT_ENERGY_SAFETY_BPS,
    bandwidthSafetyBps: options.bandwidthSafetyBps ?? DEFAULT_BANDWIDTH_SAFETY_BPS,
    maxEnergyPerApproval: options.maxEnergyPerApproval ?? DEFAULT_MAX_ENERGY,
    maxBandwidthPerApproval: options.maxBandwidthPerApproval ?? DEFAULT_MAX_BANDWIDTH,
    managementBandwidthPerAction:
      options.managementBandwidthPerAction ?? DEFAULT_MANAGEMENT_BANDWIDTH_PER_ACTION,
  };

  /**
   * Computes a read-only plan and policy decision.
   *
   * @param request - Sponsorship request.
   * @returns Current preflight, resource plan, budget, and allowance state.
   */
  async function preview(request: Trc20ApprovalResourceSponsoringRequest): Promise<{
    preflight: Trc20SponsoringPreflight;
    plan: Trc20SponsoringPlan;
    budgetUnits: bigint;
    approvalState: "approval_required" | "approval_satisfied";
  }> {
    let preflight: Trc20SponsoringPreflight;
    try {
      preflight = await options.chain.preflight(request);
    } catch (error) {
      throw normalizedFailure(error, "sponsor_preflight_failed", "sponsorship preflight failed");
    }
    const approvalState = validatePreflight(request, preflight);
    const plan =
      approvalState === "approval_satisfied"
        ? {
            energyRequired: 0n,
            bandwidthRequired: 0n,
            managementBandwidthRequired: 0n,
            legs: [],
            replacementCost: 0n,
          }
        : buildTrc20SponsoringPlan(preflight, sizingOptions);
    const decision = await options.policy.preview(request, plan);
    if (!decision.allowed) {
      throw new SponsoringFailure(decision.reason ?? "sponsor_policy_denied", decision.message);
    }
    return {
      preflight,
      plan,
      budgetUnits: decision.budgetUnits ?? plan.replacementCost,
      approvalState,
    };
  }

  /**
   * Persists one optimistic operation transition.
   *
   * @param operation - Operation carrying the expected revision.
   * @returns Saved operation.
   */
  async function persist(operation: Trc20SponsoringOperation): Promise<Trc20SponsoringOperation> {
    return options.coordinator.save(operation);
  }

  /**
   * Prepares, persists, broadcasts, and confirms one immutable chain action.
   *
   * @param operation - Current operation state.
   * @param kind - Logical action kind.
   * @param resource - Optional resource leg.
   * @param prepare - Builder used only when no durable action exists.
   * @returns Operation with the confirmed action.
   */
  async function executeAction(
    operation: Trc20SponsoringOperation,
    kind: Trc20SponsoringActionKind,
    resource: TronResourceType | undefined,
    prepare: () => Promise<PreparedTronAction>,
  ): Promise<Trc20SponsoringOperation> {
    let current = operation;
    let action = actionFor(current, kind, resource);
    if (!action) {
      const prepared = await prepare();
      action = {
        kind,
        ...(resource ? { resource } : {}),
        txID: prepared.txID.toLowerCase(),
        signedTransaction: prepared.signedTransaction,
        status: "prepared",
      };
      current = await persist(replaceAction(current, action));
    }
    if (action.status === "confirmed") return current;
    if (action.status === "failed") {
      if (kind !== "undelegate") {
        throw new SponsoringFailure(`${kind}_failed`);
      }
      const prepared = await prepare();
      action = {
        kind,
        ...(resource ? { resource } : {}),
        txID: prepared.txID.toLowerCase(),
        signedTransaction: prepared.signedTransaction,
        status: "prepared",
      };
      current = await persist(replaceAction(current, action));
    }

    if (action.status === "prepared") {
      try {
        const returnedTxID =
          kind === "approval"
            ? await options.chain.broadcastApproval(action.signedTransaction)
            : await options.chain.broadcast({
                txID: action.txID,
                signedTransaction: action.signedTransaction,
              });
        if (returnedTxID.toLowerCase() !== action.txID) {
          current = await persist(replaceAction(current, { ...action, status: "unknown" }));
          throw new SponsoringFailure("broadcast_txid_mismatch", undefined, current);
        }
        action = { ...action, status: "submitted" };
        current = await persist(replaceAction(current, action));
      } catch (error) {
        if (error instanceof SponsoringFailure) throw error;
        // The request may have reached the node. Reconcile only the immutable
        // original txID below; never prepare a replacement transaction.
      }
    }

    const result = await options.chain.confirm(action.txID);
    if (result === "unknown") {
      current = await persist(replaceAction(current, { ...action, status: "unknown" }));
      throw new SponsoringFailure("unknown_chain_state", undefined, current);
    }
    if (result === "failed") {
      current = await persist(replaceAction(current, { ...action, status: "failed" }));
      throw new SponsoringFailure(`${kind}_failed`, undefined, current);
    }
    return persist(replaceAction(current, { ...action, status: "confirmed" }));
  }

  /**
   * Undelegates every confirmed resource leg.
   *
   * @param operation - Operation whose resources must be reclaimed.
   * @returns Updated reclaiming operation.
   */
  async function reclaim(operation: Trc20SponsoringOperation): Promise<Trc20SponsoringOperation> {
    let current = await persist(withStatus(operation, "reclaiming"));
    for (const leg of current.plan.legs) {
      const delegated = actionFor(current, "delegate", leg.resource);
      if (!delegated || delegated.status !== "confirmed") continue;
      current = await executeAction(current, "undelegate", leg.resource, () =>
        options.chain.prepareUndelegate(current.request, leg),
      );
    }
    return current;
  }

  /**
   * Persists and broadcasts one recovery action without waiting for confirmation.
   *
   * @param operation - Current durable operation.
   * @param resource - Resource leg being reclaimed.
   * @param prepare - Builder for the immutable Undelegate transaction.
   * @returns Operation containing a submitted or unknown recovery action.
   */
  async function submitRecoveryAction(
    operation: Trc20SponsoringOperation,
    resource: TronResourceType,
    prepare: () => Promise<PreparedTronAction>,
  ): Promise<Trc20SponsoringOperation> {
    let current = operation;
    let action = actionFor(current, "undelegate", resource);
    if (!action) {
      const prepared = await prepare();
      action = {
        kind: "undelegate",
        resource,
        txID: prepared.txID.toLowerCase(),
        signedTransaction: prepared.signedTransaction,
        status: "prepared",
      };
      current = await persist(replaceAction(current, action));
    }
    if (action.status !== "prepared") return current;
    try {
      const returnedTxID = await options.chain.broadcast({
        txID: action.txID,
        signedTransaction: action.signedTransaction,
      });
      const status = returnedTxID.toLowerCase() === action.txID ? "submitted" : "unknown";
      return persist(replaceAction(current, { ...action, status }));
    } catch {
      // The node may have accepted the immutable bytes before the transport
      // failed. Persist unknown and let reconcile query the original txID.
      return persist(replaceAction(current, { ...action, status: "unknown" }));
    }
  }

  /**
   * Durably enters recovery and submits Undelegates without blocking payment settlement.
   *
   * @param operation - Approval-confirmed operation.
   * @returns Operation whose recovery debt is durable.
   */
  async function beginRecovery(
    operation: Trc20SponsoringOperation,
  ): Promise<Trc20SponsoringOperation> {
    let current = await persist({
      ...operation,
      status: "sponsored_recovering",
      errorReason: undefined,
      errorMessage: undefined,
    });
    for (const leg of current.plan.legs) {
      const delegated = actionFor(current, "delegate", leg.resource);
      if (!delegated || delegated.status !== "confirmed") continue;
      try {
        current = await submitRecoveryAction(current, leg.resource, () =>
          options.chain.prepareUndelegate(current.request, leg),
        );
      } catch {
        // The durable sponsored_recovering state is the recovery queue. A
        // worker can retry preparation without turning a valid payment into a
        // settlement failure.
      }
    }
    return current;
  }

  /**
   * Reconciles actions whose broadcast outcome is unknown using only the original txID.
   *
   * @param operation - Operation containing unknown actions.
   * @returns Updated operation observations.
   */
  async function refreshUnknownActions(
    operation: Trc20SponsoringOperation,
  ): Promise<Trc20SponsoringOperation> {
    let current = operation;
    for (const action of current.actions.filter(
      candidate => candidate.status === "submitted" || candidate.status === "unknown",
    )) {
      const result = await options.chain.confirm(action.txID);
      current = await persist(
        replaceAction(current, {
          ...action,
          status: result === "confirmed" ? "confirmed" : result === "failed" ? "failed" : "unknown",
        }),
      );
    }
    return current;
  }

  /**
   * Checks whether reconciliation is still required.
   *
   * @param operation - Operation to inspect.
   * @returns Whether any action remains unknown.
   */
  function hasUnknownAction(operation: Trc20SponsoringOperation): boolean {
    return operation.actions.some(action => action.status === "unknown");
  }

  /**
   * Checks whether the Approval transaction reached confirmation.
   *
   * @param operation - Operation to inspect.
   * @returns Whether the Approval is confirmed.
   */
  function approvalWasConfirmed(operation: Trc20SponsoringOperation): boolean {
    return actionFor(operation, "approval")?.status === "confirmed";
  }

  /**
   * Checks whether an Approval may still be accepted by the network.
   *
   * @param operation - Operation to inspect.
   * @returns Whether reclamation must wait.
   */
  function approvalMayStillLand(operation: Trc20SponsoringOperation): boolean {
    const status = actionFor(operation, "approval")?.status;
    return status === "submitted" || status === "unknown";
  }

  /**
   * Checks whether every possible delegation has a confirmed undelegation.
   *
   * @param operation - Operation to inspect.
   * @returns Whether all resource legs are reclaimed.
   */
  function allDelegationsReclaimed(operation: Trc20SponsoringOperation): boolean {
    return operation.plan.legs.every(leg => {
      const delegated = actionFor(operation, "delegate", leg.resource);
      if (!delegated || delegated.status === "failed") return true;
      return actionFor(operation, "undelegate", leg.resource)?.status === "confirmed";
    });
  }

  /**
   * Runs or resumes one idempotent payer-serialized sponsorship operation.
   *
   * @param request - Sponsorship request.
   * @param executionOptions - Scheme checks that must be repeated immediately before broadcast.
   * @returns Terminal response for the synchronous x402 settle flow.
   */
  async function executeNewOrExisting(
    request: Trc20ApprovalResourceSponsoringRequest,
    executionOptions?: Trc20SponsorshipExecutionOptions,
  ): Promise<{
    success: boolean;
    approvalTransaction?: string;
    errorReason?: string;
    errorMessage?: string;
  }> {
    return options.coordinator.runExclusive(payerScope(request), async () => {
      let current: Trc20SponsoringOperation | undefined;
      try {
        current = await options.coordinator.get(operationKey(request));
        if (!current) {
          const prepared = await preview(request);
          if (prepared.approvalState === "approval_satisfied") return { success: true };
          const admission = await options.coordinator.admit(
            initialOperation(request, prepared.plan, prepared.budgetUnits),
          );
          if (admission.kind === "conflict" || admission.kind === "denied") {
            return {
              success: false,
              errorReason: admission.reason,
              errorMessage: admission.message,
            };
          }
          current = admission.operation;
        }
        if (current.requestDigest !== requestDigest(request)) {
          throw new SponsoringFailure("approval_transaction_reused");
        }
        if (current.status === "recovered") {
          return current.errorReason
            ? {
                success: false,
                errorReason: current.errorReason,
                errorMessage: current.errorMessage,
              }
            : { success: true, approvalTransaction: current.approvalTxID };
        }
        if (current.status === "sponsored_recovering") {
          return { success: true, approvalTransaction: current.approvalTxID };
        }
        if (current.status === "failed_recovering") {
          current = await refreshUnknownActions(current);
          if (hasUnknownAction(current)) {
            return {
              success: false,
              approvalTransaction: current.approvalTxID,
              errorReason: "unknown_chain_state",
              errorMessage: "original transaction state is still unknown",
            };
          }
          const allowanceNowSufficient = await options.chain.allowanceSufficient(current.request);
          const sponsored = approvalWasConfirmed(current) || allowanceNowSufficient;
          if (sponsored) {
            current = await beginRecovery(current);
            return { success: true, approvalTransaction: current.approvalTxID };
          }
          current = await reclaim(current);
          current = await persist({
            ...current,
            status: "failed_recovering",
            recoveryStartedAtMs: current.recoveryStartedAtMs ?? Date.now(),
          });
          return {
            success: false,
            errorReason: current.errorReason ?? "sponsor_execution_failed",
            errorMessage: current.errorMessage,
          };
        }

        current = await persist(withStatus(current, "delegating"));
        for (const leg of current.plan.legs) {
          const requestForDelegation = current.request;
          current = await executeAction(current, "delegate", leg.resource, () =>
            options.chain.prepareDelegate(requestForDelegation, leg),
          );
        }
        if (!(await options.chain.resourcesVisible(current.request, current.plan))) {
          throw new SponsoringFailure("delegated_resources_not_visible");
        }
        current = await persist(withStatus(current, "resources_visible"));

        if (executionOptions?.revalidate) {
          let revalidation;
          try {
            revalidation = await executionOptions.revalidate();
          } catch {
            throw new SponsoringFailure(
              "scheme_revalidation_failed",
              "payment scheme revalidation failed",
            );
          }
          if (!revalidation.isValid) {
            throw new SponsoringFailure(
              revalidation.invalidReason ?? "scheme_revalidation_failed",
              revalidation.invalidMessage ?? "payment scheme authorization is no longer valid",
            );
          }
        }

        const refreshed = await options.chain.preflight(current.request);
        const approvalState = validatePreflight(current.request, refreshed);
        if (approvalState === "approval_required") {
          const refreshedPlan = buildTrc20SponsoringPlan(refreshed, sizingOptions);
          if (refreshedPlan.legs.length > 0) {
            throw new SponsoringFailure("resource_estimate_changed");
          }
          current = await persist(withStatus(current, "approval_submitted"));
          const approvalTxID = current.approvalTxID;
          const signedApproval = current.request.signedTransaction;
          current = await executeAction(current, "approval", undefined, async () => ({
            txID: approvalTxID,
            signedTransaction: signedApproval,
          }));
          if (!(await options.chain.allowanceSufficient(current.request))) {
            throw new SponsoringFailure("approval_allowance_not_observed");
          }
        }
        current = await persist(withStatus(current, "approval_confirmed"));
        current = await beginRecovery(current);
        return { success: true, approvalTransaction: current.approvalTxID };
      } catch (error) {
        const failure = normalizedFailure(
          error,
          "sponsor_execution_failed",
          "resource sponsorship failed",
        );
        if (error instanceof SponsoringFailure && error.operation) {
          current = error.operation;
        }
        if (!current) {
          return { success: false, errorReason: failure.reason, errorMessage: failure.message };
        }
        if (!approvalMayStillLand(current)) {
          try {
            current = await reclaim(current);
          } catch (reclaimError) {
            if (reclaimError instanceof SponsoringFailure && reclaimError.operation) {
              current = reclaimError.operation;
            }
            // Keep every prepared/unknown action for the recovery worker. Never
            // report a clean terminal state while a delegation may still exist.
          }
        }
        current = await persist({
          ...current,
          status: "failed_recovering",
          recoveryStartedAtMs: current.actions.some(action => action.kind === "undelegate")
            ? (current.recoveryStartedAtMs ?? Date.now())
            : current.recoveryStartedAtMs,
          errorReason: failure.reason,
          errorMessage: failure.message,
        });
        return {
          success: false,
          approvalTransaction: current.approvalTxID,
          errorReason: failure.reason,
          errorMessage: failure.message,
        };
      }
    });
  }

  return {
    async verify(request) {
      try {
        await preview(request);
        return { isValid: true };
      } catch (error) {
        const failure = normalizedFailure(
          error,
          "sponsor_preflight_failed",
          "sponsorship preflight failed",
        );
        return {
          isValid: false,
          invalidReason: failure.reason,
          invalidMessage: failure.message,
        };
      }
    },
    sponsor: executeNewOrExisting,
    async reconcile(limit = 100) {
      const operations = await options.coordinator.listRecoverable(limit);
      let recovered = 0;
      for (const operation of operations) {
        await options.coordinator.runExclusive(
          `${operation.network}:${operation.payer}`,
          async () => {
            let current = operation;
            try {
              const preparedApproval = actionFor(current, "approval");
              if (
                current.status === "approval_submitted" &&
                preparedApproval?.status === "prepared"
              ) {
                const result = await options.chain.confirm(preparedApproval.txID);
                const expired = BigInt(current.request.approvalExpiration) <= BigInt(Date.now());
                current = await persist(
                  replaceAction(current, {
                    ...preparedApproval,
                    status:
                      result === "confirmed"
                        ? "confirmed"
                        : result === "failed" || expired
                          ? "failed"
                          : "unknown",
                  }),
                );
              }
              current = await refreshUnknownActions(current);

              // A prepared resource action may have been broadcast immediately
              // before a process crash. Replaying its immutable bytes is safe and
              // gives the worker one txID whose result can be reconciled.
              for (const leg of current.plan.legs) {
                const delegation = actionFor(current, "delegate", leg.resource);
                if (
                  delegation &&
                  delegation.status !== "confirmed" &&
                  delegation.status !== "failed"
                ) {
                  current = await executeAction(current, "delegate", leg.resource, () =>
                    options.chain.prepareDelegate(current.request, leg),
                  );
                }
              }

              current = await refreshUnknownActions(current);
              if (hasUnknownAction(current)) return;

              const allowanceNowSufficient = await options.chain.allowanceSufficient(
                current.request,
              );
              current = await reclaim(current);
              const sponsored = approvalWasConfirmed(current) || allowanceNowSufficient;
              current = await persist({
                ...current,
                status: sponsored ? "sponsored_recovering" : "failed_recovering",
                recoveryStartedAtMs: current.recoveryStartedAtMs ?? Date.now(),
                ...(sponsored
                  ? { errorReason: undefined, errorMessage: undefined }
                  : {
                      errorReason: current.errorReason ?? "sponsor_interrupted",
                      errorMessage: current.errorMessage,
                    }),
              });
            } catch {
              // Keep the operation recoverable. A later pass reconciles the
              // same immutable txID while its outcome is unknown. Only an
              // Undelegate confirmed failed may be replaced on a later pass.
            }
            if (
              !hasUnknownAction(current) &&
              allDelegationsReclaimed(current) &&
              (current.status === "sponsored_recovering" ||
                current.status === "failed_recovering") &&
              (await options.chain.capacityRecovered(current))
            ) {
              await options.coordinator.markRecovered(current);
              recovered += 1;
            }
          },
        );
      }
      return { examined: operations.length, recovered };
    },
  };
}

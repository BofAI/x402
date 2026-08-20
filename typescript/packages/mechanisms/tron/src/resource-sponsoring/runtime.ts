/* eslint-disable jsdoc/require-jsdoc, jsdoc/require-param, jsdoc/require-returns */
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
import type { Trc20ApprovalResourceSponsoringRequest } from "../exact/extensions";

const DEFAULT_ENERGY_SAFETY_BPS = 12_000n;
const DEFAULT_BANDWIDTH_SAFETY_BPS = 11_000n;
const DEFAULT_MAX_ENERGY = 250_000n;
const DEFAULT_MAX_BANDWIDTH = 2_000n;
const DEFAULT_MANAGEMENT_BANDWIDTH_PER_ACTION = 350n;

class SponsoringFailure extends Error {
  constructor(
    readonly reason: string,
    message?: string,
    readonly operation?: Trc20SponsoringOperation,
  ) {
    super(message ?? reason);
  }
}

function normalizedFailure(error: unknown, fallbackReason: string, fallbackMessage: string) {
  if (error instanceof SponsoringFailure) return error;
  if (error instanceof Error && /^[a-z0-9_]+$/.test(error.message)) {
    return new SponsoringFailure(error.message);
  }
  return new SponsoringFailure(fallbackReason, fallbackMessage);
}

function operationKey(request: Trc20ApprovalResourceSponsoringRequest): string {
  return `${request.network}:${request.approvalTxID.toLowerCase()}`;
}

function payerScope(request: Trc20ApprovalResourceSponsoringRequest): string {
  return `${request.network}:${request.payer}`;
}

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

function requestDigest(request: Trc20ApprovalResourceSponsoringRequest): string {
  const bytes = new TextEncoder().encode(canonicalJson(request));
  return tronUtils.code.byteArray2hexStr(tronUtils.crypto.SHA256(bytes)).toLowerCase();
}

function validatePreflight(
  request: Trc20ApprovalResourceSponsoringRequest,
  preflight: Trc20SponsoringPreflight,
): "approval_required" | "approval_satisfied" {
  if (!preflight.accountActivated) throw new SponsoringFailure("payer_account_not_activated");
  if (preflight.accountIsContract) throw new SponsoringFailure("payer_account_not_eoa");
  if (preflight.tokenBalance < BigInt(request.paymentRequirements.amount)) {
    throw new SponsoringFailure("insufficient_funds");
  }
  const requiredAllowance = BigInt(request.paymentRequirements.amount);
  if (preflight.allowance === 0n) return "approval_required";
  if (preflight.allowance >= requiredAllowance) return "approval_satisfied";
  throw new SponsoringFailure("approval_reset_required");
}

function actionMatches(
  action: Trc20SponsoringAction,
  kind: Trc20SponsoringActionKind,
  resource?: TronResourceType,
): boolean {
  return action.kind === kind && action.resource === resource;
}

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

function withStatus(
  operation: Trc20SponsoringOperation,
  status: Trc20SponsoringOperationStatus,
): Trc20SponsoringOperation {
  return { ...operation, status };
}

function actionFor(
  operation: Trc20SponsoringOperation,
  kind: Trc20SponsoringActionKind,
  resource?: TronResourceType,
): Trc20SponsoringAction | undefined {
  return operation.actions.find(action => actionMatches(action, kind, resource));
}

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

/** Creates the production-oriented, dependency-injected sponsoring state machine. */
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

  async function persist(operation: Trc20SponsoringOperation): Promise<Trc20SponsoringOperation> {
    return options.coordinator.save(operation);
  }

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
      throw new SponsoringFailure(`${kind}_failed`);
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

  async function refreshUnknownActions(
    operation: Trc20SponsoringOperation,
  ): Promise<Trc20SponsoringOperation> {
    let current = operation;
    for (const action of current.actions.filter(candidate => candidate.status === "unknown")) {
      const result = await options.chain.confirm(action.txID);
      if (result === "unknown") continue;
      current = await persist(
        replaceAction(current, {
          ...action,
          status: result === "confirmed" ? "confirmed" : "failed",
        }),
      );
    }
    return current;
  }

  function hasUnknownAction(operation: Trc20SponsoringOperation): boolean {
    return operation.actions.some(action => action.status === "unknown");
  }

  function approvalWasConfirmed(operation: Trc20SponsoringOperation): boolean {
    return actionFor(operation, "approval")?.status === "confirmed";
  }

  function approvalMayStillLand(operation: Trc20SponsoringOperation): boolean {
    const status = actionFor(operation, "approval")?.status;
    return status === "submitted" || status === "unknown";
  }

  function allDelegationsReclaimed(operation: Trc20SponsoringOperation): boolean {
    return operation.plan.legs.every(leg => {
      const delegated = actionFor(operation, "delegate", leg.resource);
      if (!delegated || delegated.status === "failed") return true;
      return actionFor(operation, "undelegate", leg.resource)?.status === "confirmed";
    });
  }

  async function executeNewOrExisting(request: Trc20ApprovalResourceSponsoringRequest): Promise<{
    success: boolean;
    approvalTransaction?: string;
    errorReason?: string;
    errorMessage?: string;
  }> {
    return options.coordinator.runExclusive(payerScope(request), async () => {
      let current: Trc20SponsoringOperation | undefined;
      try {
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
          current = await reclaim(current);
          const sponsored = approvalWasConfirmed(current) || allowanceNowSufficient;
          current = await persist({
            ...current,
            status: sponsored ? "sponsored_recovering" : "failed_recovering",
            recoveryStartedAtMs: current.recoveryStartedAtMs ?? Date.now(),
            ...(sponsored ? { errorReason: undefined, errorMessage: undefined } : {}),
          });
          if (sponsored) {
            return { success: true, approvalTransaction: current.approvalTxID };
          }
          return {
            success: false,
            errorReason: current.errorReason ?? "sponsor_execution_failed",
            errorMessage: current.errorMessage,
          };
        }

        current = await persist(withStatus(current, "delegating"));
        for (const leg of current.plan.legs) {
          current = await executeAction(current, "delegate", leg.resource, () =>
            options.chain.prepareDelegate(current!.request, leg),
          );
        }
        if (!(await options.chain.resourcesVisible(current.request, current.plan))) {
          throw new SponsoringFailure("delegated_resources_not_visible");
        }
        current = await persist(withStatus(current, "resources_visible"));

        const refreshed = await options.chain.preflight(current.request);
        const approvalState = validatePreflight(current.request, refreshed);
        if (approvalState === "approval_required") {
          const refreshedPlan = buildTrc20SponsoringPlan(refreshed, sizingOptions);
          if (refreshedPlan.legs.length > 0) {
            throw new SponsoringFailure("resource_estimate_changed");
          }
          current = await persist(withStatus(current, "approval_submitted"));
          current = await executeAction(current, "approval", undefined, async () => ({
            txID: current!.approvalTxID,
            signedTransaction: current!.request.signedTransaction,
          }));
          if (!(await options.chain.allowanceSufficient(current.request))) {
            throw new SponsoringFailure("approval_allowance_not_observed");
          }
        }
        current = await persist(withStatus(current, "approval_confirmed"));
        current = await reclaim(current);
        current = await persist({
          ...withStatus(current, "sponsored_recovering"),
          recoveryStartedAtMs: Date.now(),
        });
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
            let current = await refreshUnknownActions(operation);
            if (!hasUnknownAction(current) && current.status === "failed_recovering") {
              try {
                const allowanceNowSufficient = await options.chain.allowanceSufficient(
                  current.request,
                );
                current = await reclaim(current);
                if (approvalWasConfirmed(current) || allowanceNowSufficient) {
                  current = await persist({
                    ...current,
                    status: "sponsored_recovering",
                    recoveryStartedAtMs: current.recoveryStartedAtMs ?? Date.now(),
                    errorReason: undefined,
                    errorMessage: undefined,
                  });
                }
              } catch {
                // Keep the operation recoverable. A later pass reconciles the
                // same immutable action txIDs; it never creates replacements.
              }
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

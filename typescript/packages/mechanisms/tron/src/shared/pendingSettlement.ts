import type { PaymentPayload, PaymentRequirements, SettleResponse } from "@x402/core/types";
import { TronWeb } from "tronweb";
import { isValidTronTxHash } from "../utils";

/** Serializable state required to reconcile an already broadcast transaction. */
export interface TronPendingSettlement {
  transaction: string;
  data?: Record<string, string>;
}

/**
 * Pending transaction storage. Shared implementations must hold an exclusive lock
 * for the entire callback, including receipt waiting, across all facilitator replicas.
 */
export interface TronPendingSettlementStore {
  get(key: string): Promise<TronPendingSettlement | undefined>;
  set(key: string, record: TronPendingSettlement): Promise<void>;
  delete(key: string): Promise<void>;
  withLock<T>(key: string, action: () => Promise<T>): Promise<T>;
}

/** Single-process default. Uncertain transactions never expire automatically. */
export class InMemoryTronPendingSettlementStore implements TronPendingSettlementStore {
  private readonly records = new Map<string, TronPendingSettlement>();
  private readonly locks = new Map<string, Promise<void>>();

  /**
   * Read an unresolved settlement record.
   *
   * @param key - Deterministic settlement identifier.
   * @returns Previously stored record, if any.
   */
  async get(key: string): Promise<TronPendingSettlement | undefined> {
    return this.records.get(key);
  }

  /**
   * Save a transaction and its reconciliation snapshot.
   *
   * @param key - Deterministic settlement identifier.
   * @param record - Serializable transaction and reconciliation snapshot.
   * @returns Resolves after storing the record.
   */
  async set(key: string, record: TronPendingSettlement): Promise<void> {
    this.records.set(key, record);
  }

  /**
   * Remove a terminal settlement record.
   *
   * @param key - Deterministic settlement identifier.
   * @returns Resolves after removing the record.
   */
  async delete(key: string): Promise<void> {
    this.records.delete(key);
  }

  /**
   * Serialize settlement attempts sharing the same key.
   *
   * @param key - Deterministic settlement identifier.
   * @param action - Callback executed while holding the key lock.
   * @returns Result of the exclusive callback.
   */
  async withLock<T>(key: string, action: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>(resolve => {
      release = resolve;
    });
    this.locks.set(key, current);
    await previous;
    try {
      return await action();
    } finally {
      release();
      if (this.locks.get(key) === current) this.locks.delete(key);
    }
  }
}

/** Facilitator options shared by the TRON payment schemes. */
export interface TronSettlementOptions {
  pendingSettlementStore?: TronPendingSettlementStore;
}

/** Per-attempt context passed to the concrete settlement implementation. */
export interface TronPendingSettlementContext {
  readonly record: TronPendingSettlement | undefined;
  save(transaction: string, data?: Record<string, string>): Promise<void>;
}

/** Holds the original transaction while serializing identical settlement attempts. */
export class TronSettlementTracker {
  private readonly fallback = new Map<string, TronPendingSettlement>();

  /**
   * Bind tracking to its storage and locking implementation.
   *
   * @param store - Storage and locking implementation.
   */
  constructor(
    private readonly store: TronPendingSettlementStore = new InMemoryTronPendingSettlementStore(),
  ) {}

  /**
   * Reconcile the original transaction or execute a fresh settlement.
   *
   * @param payload - Payment payload for this settlement.
   * @param requirements - Effective payment requirements, including the actual settlement amount.
   * @param execute - Concrete scheme settlement or reconciliation operation.
   * @returns Settlement result preserving the original transaction identity.
   */
  async run(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
    execute: (pending: TronPendingSettlementContext) => Promise<SettleResponse>,
  ): Promise<SettleResponse> {
    // Bind all signed terms and effective requirements, including the actual upto
    // amount. An unrelated request must never inherit a cached payment result.
    const key = `tron:${TronWeb.sha3(
      JSON.stringify([payload, requirements], (_key, value) => {
        if (typeof value === "bigint") return value.toString();
        if (value && typeof value === "object" && !Array.isArray(value)) {
          return Object.fromEntries(
            Object.keys(value)
              .sort()
              .map(key => [key, value[key]]),
          );
        }
        return value;
      }),
    )}`;
    let known: TronPendingSettlement | undefined;
    try {
      return await this.store.withLock(key, async () => {
        known = this.fallback.get(key) ?? (await this.store.get(key));
        if (
          known &&
          !isValidTronTxHash(known.transaction) &&
          !(
            requirements.scheme === "exact_gasfree" &&
            known.transaction === "" &&
            known.data?.gasfreeTraceId
          )
        ) {
          throw new Error("invalid pending transaction record");
        }
        const pending: TronPendingSettlementContext = {
          record: known,
          save: async (transaction, data = known?.data) => {
            if (
              !isValidTronTxHash(transaction) &&
              !(
                requirements.scheme === "exact_gasfree" &&
                transaction === "" &&
                data?.gasfreeTraceId
              )
            )
              return;
            known = { transaction, ...(data ? { data } : {}) };
            this.fallback.set(key, known);
            await this.store.set(key, known);
          },
        };
        let result = await execute(pending);
        if (known && isValidTronTxHash(known.transaction) && !result.transaction) {
          result = {
            ...result,
            success: false,
            errorReason: "settlement_store_unavailable",
            transaction: known.transaction,
          };
        }
        if (!result.success && known?.data?.gasfreeTraceId) {
          result = {
            ...result,
            extra: { ...result.extra, gasfreeTraceId: known.data.gasfreeTraceId },
          };
        }
        if (
          result.success ||
          ((!known || isValidTronTxHash(result.transaction)) &&
            result.errorReason !== "settlement_pending" &&
            result.errorReason !== "settlement_store_unavailable")
        ) {
          try {
            await this.store.delete(key);
            this.fallback.delete(key);
          } catch {
            // Retain the original transaction locally if cleanup is unavailable.
          }
        }
        return result;
      });
    } catch (error) {
      return {
        success: false,
        errorReason: "settlement_store_unavailable",
        errorMessage: error instanceof Error ? error.message : String(error),
        transaction: known && isValidTronTxHash(known.transaction) ? known.transaction : "",
        ...(known?.data?.gasfreeTraceId
          ? { extra: { gasfreeTraceId: known.data.gasfreeTraceId } }
          : {}),
        network: requirements.network,
      };
    }
  }
}

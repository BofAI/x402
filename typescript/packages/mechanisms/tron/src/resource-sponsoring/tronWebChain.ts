import { TronWeb, utils as tronUtils } from "tronweb";
import { erc20AllowanceAbi, transferWithAuthorizationABI } from "../constants";
import type { FacilitatorTronSigner } from "../signer";
import { normalizeSignedTronTransaction, serializeSignedTronTransaction } from "../signer";
import type { Trc20ApprovalResourceSponsoringRequest } from "../shared/extensions/trc20ApprovalContract";
import type {
  PreparedTronAction,
  Trc20ResourceLeg,
  Trc20ResourceSponsoringChain,
  Trc20SponsoringOperation,
  TronActionResult,
} from "./types";

const MAX_UINT256 = (1n << 256n) - 1n;
const DEFAULT_RECOVERY_WINDOW_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_TAPOS_AGE_BLOCKS = 100;
const TRANSACTION_RESULT_BYTES = 64n;

/** Options for the concrete TronWeb resource-sponsoring chain driver. */
export interface TronWebResourceSponsoringChainOptions {
  readonly tronWeb: TronWeb;
  readonly network: string;
  readonly resourceOwnerSigner: TronResourceOwnerSigner;
  readonly readContract: FacilitatorTronSigner["readContract"];
  readonly allowedAssets: readonly string[];
  readonly permissionId: number;
  readonly recoveryWindowMs?: number;
  readonly maxTaposAgeBlocks?: number;
  readonly minimumApprovalBroadcastWindowMs?: number;
  /** `packed` is low-latency/provisional; `solidified` waits for irreversible state. */
  readonly confirmationMode?: "packed" | "solidified";
  readonly confirmationTimeoutMs?: number;
  readonly confirmationPollIntervalMs?: number;
}

/** Exact Resource Owner operation exposed to a policy-aware wallet or HSM. */
export interface TronResourceOwnerActionIntent {
  readonly network: string;
  readonly action: "delegate" | "undelegate";
  readonly owner: string;
  readonly receiver: string;
  readonly resource: Trc20ResourceLeg["resource"];
  readonly stakeSun: string;
  readonly lock: false;
  readonly permissionId: number;
}

/** Resource Owner signing boundary that receives both intent and validated transaction bytes. */
export interface TronResourceOwnerSigner {
  getAddress(): Promise<string>;
  signResourceTransaction(args: {
    readonly intent: TronResourceOwnerActionIntent;
    readonly transaction: Record<string, unknown>;
  }): Promise<string | Record<string, unknown>>;
}

type ChainParameter = { key: string; value: number };
type BroadcastHexResult = {
  result?: boolean;
  txid?: string;
  code?: string;
  message?: string;
};

type ResourceOwnerTransactionIntent = {
  readonly kind: "delegate" | "undelegate";
  readonly owner: string;
  readonly receiver: string;
  readonly resource: Trc20ResourceLeg["resource"];
  readonly stakeSun: bigint;
  readonly permissionId: number;
};

type DecodedResourceContract = {
  readonly contract?: readonly {
    readonly parameter?: {
      readonly value?: {
        readonly owner_address?: string;
        readonly receiver_address?: string;
        readonly balance?: number | string;
        readonly resource?: string;
        readonly lock?: boolean;
        readonly lock_period?: number | string;
      };
      readonly type_url?: string;
    };
    readonly type?: string;
    readonly Permission_id?: number;
  }[];
  readonly data?: string;
  readonly scripts?: string;
  readonly auths?: readonly unknown[];
  readonly fee_limit?: number | string;
};

type TronActivePermission = {
  readonly id?: number;
  readonly operations?: string;
};

type TronAccountWithPermissions = {
  readonly active_permission?: readonly TronActivePermission[];
  readonly activePermission?: readonly TronActivePermission[];
};

/**
 * Converts an optional java-tron numeric value without losing precision.
 *
 * @param value - Chain value or missing field.
 * @returns Bigint value, or zero when absent.
 */
function toBigInt(value: number | string | bigint | undefined): bigint {
  return value == null ? 0n : BigInt(value);
}

/**
 * Computes a non-negative resource balance.
 *
 * @param limit - Resource limit.
 * @param used - Resource usage.
 * @returns Remaining resource units.
 */
function available(limit: number | undefined, used: number | undefined): bigint {
  const remaining = toBigInt(limit) - toBigInt(used);
  return remaining > 0n ? remaining : 0n;
}

/**
 * Normalizes a TRON address for comparisons.
 *
 * @param address - Base58Check or hexadecimal address.
 * @returns Lowercase 21-byte hexadecimal address.
 */
function normalizeAddress(address: string): string {
  return TronWeb.address.toHex(address).toLowerCase();
}

/**
 * Converts every supported address representation to the Base58 form expected
 * by java-tron account and resource endpoints.
 *
 * Permit2 signature recovery yields a 20-byte `0x` address, while TRON account
 * RPCs require the equivalent 21-byte network-prefixed address. Contract ABI
 * calls accept Base58 as well, so normalizing at this boundary keeps all chain
 * reads and resource mutations on the same account.
 *
 * @param address - Base58Check, 21-byte hexadecimal, or 20-byte `0x` address.
 * @returns Canonical TRON Base58Check address.
 */
function toBase58Address(address: string): string {
  return TronWeb.address.fromHex(normalizeAddress(address));
}

/**
 * Recognizes java-tron contract account representations.
 *
 * @param type - Account type returned by TronWeb or java-tron.
 * @returns Whether the account is a contract.
 */
function isContractAccount(type: unknown): boolean {
  return type === "Contract" || type === 2 || type === "2";
}

/**
 * Converts a bounded bigint for TronWeb APIs that currently accept numbers.
 *
 * @param value - Non-negative chain value.
 * @param label - Human-readable field label for errors.
 * @returns Safe JavaScript number.
 */
function toSafeNumber(value: bigint, label: string): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${label} is outside TronWeb's safe numeric range`);
  }
  return Number(value);
}

/**
 * Returns whether an Active Permission operation bit is enabled.
 *
 * @param operations - TRON Active Permission operation mask.
 * @param contractType - Protocol contract type number.
 * @returns Whether the mask permits the contract type.
 */
function permissionAllows(operations: string, contractType: number): boolean {
  const normalized = operations.replace(/^0x/, "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) return false;
  const byte = Number.parseInt(
    normalized.slice(Math.floor(contractType / 8) * 2, Math.floor(contractType / 8) * 2 + 2),
    16,
  );
  return (byte & (1 << contractType % 8)) !== 0;
}

/**
 * Parses an RPC-built Resource Owner transaction and binds it to the requested intent.
 *
 * Both the JSON and authoritative raw protobuf bytes are checked. This prevents a
 * compromised RPC from placing a different contract behind plausible display fields.
 *
 * @param transaction - RPC-built unsigned transaction.
 * @param intent - Exact operation the Resource Owner has authorized.
 */
function validateResourceOwnerTransaction(
  transaction: Record<string, unknown>,
  intent: ResourceOwnerTransactionIntent,
): void {
  try {
    const rawData = transaction.raw_data as
      | { readonly contract?: readonly Record<string, unknown>[] }
      | undefined;
    if (rawData?.contract?.length !== 1) throw new Error("contract_count");
    const expectedType =
      intent.kind === "delegate" ? "DelegateResourceContract" : "UnDelegateResourceContract";
    const contract = rawData.contract[0] as
      | {
          readonly type?: string;
          readonly Permission_id?: number;
          readonly parameter?: { readonly type_url?: string };
        }
      | undefined;
    if (
      contract?.type !== expectedType ||
      contract.parameter?.type_url !== `type.googleapis.com/protocol.${expectedType}` ||
      contract.Permission_id !== intent.permissionId
    ) {
      throw new Error("contract_header");
    }
    if (
      typeof transaction.raw_data_hex !== "string" ||
      typeof transaction.txID !== "string" ||
      !tronUtils.transaction.txCheck(transaction as never)
    ) {
      throw new Error("protobuf_mismatch");
    }

    const decoded = tronUtils.deserializeTx.deserializeTransaction(
      expectedType,
      transaction.raw_data_hex,
    ) as DecodedResourceContract;
    if (
      decoded.contract?.length !== 1 ||
      decoded.data !== "" ||
      decoded.scripts !== "" ||
      (decoded.auths?.length ?? 0) !== 0 ||
      toBigInt(decoded.fee_limit) !== 0n
    ) {
      throw new Error("raw_data_extras");
    }
    const decodedContract = decoded.contract[0];
    const value = decodedContract?.parameter?.value;
    if (
      decodedContract?.type !== expectedType ||
      decodedContract.parameter?.type_url !== `type.googleapis.com/protocol.${expectedType}` ||
      decodedContract.Permission_id !== intent.permissionId ||
      value?.owner_address == null ||
      normalizeAddress(value.owner_address) !== normalizeAddress(intent.owner) ||
      value.receiver_address == null ||
      normalizeAddress(value.receiver_address) !== normalizeAddress(intent.receiver) ||
      toBigInt(value.balance) !== intent.stakeSun ||
      value.resource !== intent.resource ||
      (intent.kind === "delegate" && (value.lock !== false || toBigInt(value.lock_period) !== 0n))
    ) {
      throw new Error("intent_mismatch");
    }
  } catch {
    throw new Error("resource_owner_transaction_invalid");
  }
}

/**
 * Converts a wallet-signed system transaction into a durable action.
 *
 * @param signed - Signed TronWeb transaction object.
 * @returns Immutable transaction identifier and serialized bytes.
 */
function preparedFromSigned(signed: Record<string, unknown>): PreparedTronAction {
  const txID = signed.txID;
  if (typeof txID !== "string" || !/^[0-9a-fA-F]{64}$/.test(txID)) {
    throw new Error("prepared TRON action is missing a valid txID");
  }
  return {
    txID: txID.toLowerCase(),
    signedTransaction: serializeSignedTronTransaction(signed),
  };
}

/**
 * Reads one chain parameter as bigint.
 *
 * @param parameters - Current java-tron chain parameters.
 * @param key - Parameter key.
 * @returns Parameter value, or zero when absent.
 */
function parameterValue(parameters: readonly ChainParameter[], key: string): bigint {
  return toBigInt(parameters.find(parameter => parameter.key === key)?.value);
}

/**
 * Validates TAPOS fields against a recent block on the requested network.
 *
 * @param tronWeb - Network-pinned TronWeb client.
 * @param request - Sponsorship request carrying signed TAPOS fields.
 * @param maxAgeBlocks - Maximum accepted referenced-block age.
 */
async function validateTapos(
  tronWeb: TronWeb,
  request: Trc20ApprovalResourceSponsoringRequest,
  maxAgeBlocks: number,
): Promise<void> {
  if (!/^[0-9a-f]{4}$/.test(request.approvalRefBlockBytes)) {
    throw new Error("approval_tapos_invalid");
  }
  if (!/^[0-9a-f]{16}$/.test(request.approvalRefBlockHash)) {
    throw new Error("approval_tapos_invalid");
  }
  const current = await tronWeb.trx.getCurrentBlock();
  const currentNumber = current.block_header.raw_data.number;
  const low = Number.parseInt(request.approvalRefBlockBytes, 16);
  let referencedNumber = Math.floor(currentNumber / 0x10000) * 0x10000 + low;
  if (referencedNumber > currentNumber) referencedNumber -= 0x10000;
  if (referencedNumber < 0 || currentNumber - referencedNumber > maxAgeBlocks) {
    throw new Error("approval_tapos_expired");
  }
  const referenced = await tronWeb.trx.getBlockByNumber(referencedNumber);
  const expectedHash = referenced.blockID.slice(16, 32).toLowerCase();
  if (expectedHash !== request.approvalRefBlockHash) {
    throw new Error("approval_tapos_invalid");
  }
}

/**
 * Creates a concrete chain driver backed by TronWeb and a Resource Owner wallet.
 *
 * @param options - TronWeb, wallet, token allowlist, and confirmation policy.
 * @returns Chain driver ready for the resource-sponsoring runtime.
 */
export async function createTronWebResourceSponsoringChain(
  options: TronWebResourceSponsoringChainOptions,
): Promise<Trc20ResourceSponsoringChain> {
  const ownerAddress = await options.resourceOwnerSigner.getAddress();
  const allowedAssets = new Set(options.allowedAssets.map(normalizeAddress));
  const recoveryWindowMs = options.recoveryWindowMs ?? DEFAULT_RECOVERY_WINDOW_MS;
  const maxTaposAgeBlocks = options.maxTaposAgeBlocks ?? DEFAULT_MAX_TAPOS_AGE_BLOCKS;
  const minimumApprovalBroadcastWindowMs = options.minimumApprovalBroadcastWindowMs ?? 15_000;
  const confirmationMode = options.confirmationMode ?? "packed";
  const confirmationTimeoutMs = options.confirmationTimeoutMs ?? 90_000;
  const confirmationPollIntervalMs = options.confirmationPollIntervalMs ?? 3_000;
  let permissionValidation: Promise<void> | undefined;

  /**
   * Ensures resource mutations use an on-chain Active Permission, never Owner Permission.
   *
   * @returns When the configured permission is valid for both resource operations.
   */
  async function ensureResourceOwnerPermission(): Promise<void> {
    permissionValidation ??= (async () => {
      if (!Number.isInteger(options.permissionId) || options.permissionId <= 0) {
        throw new Error("resource_owner_permission_required");
      }
      const account = (await options.tronWeb.trx.getAccount(
        toBase58Address(ownerAddress),
      )) as TronAccountWithPermissions;
      const permissions = account.active_permission ?? account.activePermission ?? [];
      const permission = permissions.find(candidate => candidate.id === options.permissionId);
      if (
        !permission?.operations ||
        !permissionAllows(permission.operations, 57) ||
        !permissionAllows(permission.operations, 58)
      ) {
        throw new Error("resource_owner_permission_invalid");
      }
    })();
    return permissionValidation;
  }

  /**
   * Reads the configured packed or solidified transaction status.
   *
   * @param txID - Original transaction identifier.
   * @returns Current action result or pending.
   */
  async function readTransactionResult(txID: string): Promise<TronActionResult | "pending"> {
    try {
      const info =
        confirmationMode === "solidified"
          ? await options.tronWeb.trx.getTransactionInfo(txID)
          : ((await options.tronWeb.fullNode.request(
              "wallet/gettransactioninfobyid",
              { value: txID },
              "post",
            )) as { blockNumber?: number; receipt?: { result?: string } });
      if (!info?.blockNumber) return "pending";
      const result = info.receipt?.result;
      return result == null || result === "SUCCESS" ? "confirmed" : "failed";
    } catch {
      return "pending";
    }
  }

  /**
   * Signs a Resource Owner system transaction without broadcasting it.
   *
   * @param unsigned - Unsigned TronWeb transaction object.
   * @param intent - Exact resource operation authorized by the runtime.
   * @returns Durable signed action.
   */
  async function signSystemTransaction(
    unsigned: Record<string, unknown>,
    intent: Omit<ResourceOwnerTransactionIntent, "owner" | "permissionId">,
  ): Promise<PreparedTronAction> {
    await ensureResourceOwnerPermission();
    const completeIntent: ResourceOwnerTransactionIntent = {
      ...intent,
      owner: ownerAddress,
      permissionId: options.permissionId,
    };
    validateResourceOwnerTransaction(unsigned, completeIntent);
    const signed = normalizeSignedTronTransaction(
      await options.resourceOwnerSigner.signResourceTransaction({
        intent: {
          network: options.network,
          action: completeIntent.kind,
          owner: toBase58Address(completeIntent.owner),
          receiver: toBase58Address(completeIntent.receiver),
          resource: completeIntent.resource,
          stakeSun: completeIntent.stakeSun.toString(),
          lock: false,
          permissionId: completeIntent.permissionId,
        },
        transaction: unsigned,
      }),
      unsigned,
    );
    if (signed.raw_data_hex !== unsigned.raw_data_hex || signed.txID !== unsigned.txID) {
      throw new Error("resource_owner_signed_transaction_mismatch");
    }
    validateResourceOwnerTransaction(signed, completeIntent);
    return preparedFromSigned(signed);
  }

  /**
   * Broadcasts exactly the serialized transaction supplied by the caller.
   *
   * @param signedTransaction - Complete signed transaction hex.
   * @returns Node-reported transaction identifier.
   */
  async function broadcastHex(signedTransaction: string): Promise<string> {
    const result = (await options.tronWeb.trx.sendHexTransaction(
      signedTransaction,
    )) as BroadcastHexResult;
    if (!result.result || !result.txid) {
      throw new Error(`TRON broadcast rejected: ${result.code ?? result.message ?? "unknown"}`);
    }
    return result.txid.toLowerCase();
  }

  /**
   * Reads the payer's canonical Permit2 allowance.
   *
   * @param request - Sponsorship request.
   * @returns Current allowance.
   */
  async function readAllowance(request: Trc20ApprovalResourceSponsoringRequest): Promise<bigint> {
    return BigInt(
      (await options.readContract({
        address: request.asset,
        abi: erc20AllowanceAbi as unknown as readonly Record<string, unknown>[],
        functionName: "allowance",
        args: [toBase58Address(request.payer), request.spender],
      })) as bigint | string | number,
    );
  }

  /**
   * Reads the payer's TRC-20 balance.
   *
   * @param request - Sponsorship request.
   * @returns Current token balance.
   */
  async function readBalance(request: Trc20ApprovalResourceSponsoringRequest): Promise<bigint> {
    return BigInt(
      (await options.readContract({
        address: request.asset,
        abi: transferWithAuthorizationABI as unknown as readonly Record<string, unknown>[],
        functionName: "balanceOf",
        args: [toBase58Address(request.payer)],
      })) as bigint | string | number,
    );
  }

  return {
    async preflight(request) {
      if (!allowedAssets.has(normalizeAddress(request.asset))) {
        throw new Error("approval_asset_not_allowed");
      }
      const payerAddress = toBase58Address(request.payer);
      const [payerAccount, tokenAccount] = await Promise.all([
        options.tronWeb.trx.getAccount(payerAddress),
        options.tronWeb.trx.getAccount(request.asset),
      ]);
      const accountActivated = Boolean(payerAccount.address);
      const accountIsContract = isContractAccount(payerAccount.type);
      if (!tokenAccount.address || !isContractAccount(tokenAccount.type)) {
        throw new Error("approval_asset_not_contract");
      }
      await validateTapos(options.tronWeb, request, maxTaposAgeBlocks);
      if (
        BigInt(request.approvalExpiration) < BigInt(Date.now() + minimumApprovalBroadcastWindowMs)
      ) {
        throw new Error("approval_transaction_expiring");
      }

      const [allowance, tokenBalance, estimate, resources, ownerResources, chainParameters] =
        await Promise.all([
          readAllowance(request),
          readBalance(request),
          options.tronWeb.transactionBuilder.estimateEnergy(
            request.asset,
            "approve(address,uint256)",
            { callValue: 0 },
            [
              { type: "address", value: request.spender },
              { type: "uint256", value: MAX_UINT256.toString() },
            ],
            payerAddress,
          ),
          options.tronWeb.trx.getAccountResources(payerAddress),
          options.tronWeb.trx.getAccountResources(ownerAddress),
          options.tronWeb.trx.getChainParameters(),
        ]);
      if (!estimate.result.result || estimate.energy_required <= 0) {
        throw new Error("approval_simulation_failed");
      }
      const estimatedEnergy = BigInt(estimate.energy_required);
      const estimatedBandwidth =
        BigInt(request.signedTransaction.length / 2) + TRANSACTION_RESULT_BYTES;
      const energyFee = parameterValue(chainParameters, "getEnergyFee");
      const bandwidthFee = parameterValue(chainParameters, "getTransactionFee");
      const requiredFeeLimit = estimatedEnergy * energyFee;
      if (energyFee > 0n && BigInt(request.approvalFeeLimitSun) < requiredFeeLimit) {
        throw new Error("approval_fee_limit_too_low");
      }
      return {
        accountActivated,
        accountIsContract,
        allowance,
        tokenBalance,
        estimatedEnergy,
        estimatedBandwidth,
        replacementCost: estimatedEnergy * energyFee + estimatedBandwidth * bandwidthFee,
        managementBandwidthAvailable:
          available(ownerResources.NetLimit, ownerResources.NetUsed) >
          available(ownerResources.freeNetLimit, ownerResources.freeNetUsed)
            ? available(ownerResources.NetLimit, ownerResources.NetUsed)
            : available(ownerResources.freeNetLimit, ownerResources.freeNetUsed),
        resources: {
          energyAvailable: available(resources.EnergyLimit, resources.EnergyUsed),
          stakedBandwidthAvailable: available(resources.NetLimit, resources.NetUsed),
          freeBandwidthAvailable: available(resources.freeNetLimit, resources.freeNetUsed),
          totalEnergyLimit: toBigInt(resources.TotalEnergyLimit),
          totalEnergyWeight: toBigInt(resources.TotalEnergyWeight),
          totalBandwidthLimit: toBigInt(resources.TotalNetLimit),
          totalBandwidthWeight: toBigInt(resources.TotalNetWeight),
        },
      };
    },

    async prepareDelegate(request, leg) {
      const payerAddress = toBase58Address(request.payer);
      const unsigned = await options.tronWeb.transactionBuilder.delegateResource(
        toSafeNumber(leg.stakeSun, "delegated stake"),
        payerAddress,
        leg.resource,
        ownerAddress,
        false,
        0,
        { permissionId: options.permissionId },
      );
      return signSystemTransaction(unsigned as unknown as Record<string, unknown>, {
        kind: "delegate",
        receiver: payerAddress,
        resource: leg.resource,
        stakeSun: leg.stakeSun,
      });
    },

    async prepareUndelegate(request, leg) {
      const payerAddress = toBase58Address(request.payer);
      const unsigned = await options.tronWeb.transactionBuilder.undelegateResource(
        toSafeNumber(leg.stakeSun, "undelegated stake"),
        payerAddress,
        leg.resource,
        ownerAddress,
        { permissionId: options.permissionId },
      );
      return signSystemTransaction(unsigned as unknown as Record<string, unknown>, {
        kind: "undelegate",
        receiver: payerAddress,
        resource: leg.resource,
        stakeSun: leg.stakeSun,
      });
    },

    broadcast: action => broadcastHex(action.signedTransaction),
    broadcastApproval: broadcastHex,

    async confirm(txID): Promise<TronActionResult> {
      const deadline = Date.now() + confirmationTimeoutMs;
      while (Date.now() < deadline) {
        const result = await readTransactionResult(txID);
        if (result !== "pending") return result;
        await new Promise(resolve => setTimeout(resolve, confirmationPollIntervalMs));
      }
      return "unknown";
    },

    async resourcesVisible(request, plan) {
      const resources = await options.tronWeb.trx.getAccountResources(
        toBase58Address(request.payer),
      );
      const energyAvailable = available(resources.EnergyLimit, resources.EnergyUsed);
      const stakedBandwidth = available(resources.NetLimit, resources.NetUsed);
      const freeBandwidth = available(resources.freeNetLimit, resources.freeNetUsed);
      return (
        energyAvailable >= plan.energyRequired &&
        (stakedBandwidth >= plan.bandwidthRequired || freeBandwidth >= plan.bandwidthRequired)
      );
    },

    async allowanceSufficient(request) {
      const requiredAllowance = request.requiredAllowance ?? request.paymentRequirements.amount;
      return (await readAllowance(request)) >= BigInt(requiredAllowance);
    },

    async capacityRecovered(operation: Trc20SponsoringOperation) {
      if (operation.plan.legs.length === 0) return true;
      if (operation.recoveryStartedAtMs == null) return false;
      if (Date.now() - operation.recoveryStartedAtMs < recoveryWindowMs) return false;
      const resources = await options.tronWeb.trx.getAccountResources(ownerAddress);
      const energyNeeded = operation.plan.legs
        .filter((leg: Trc20ResourceLeg) => leg.resource === "ENERGY")
        .reduce((sum: bigint, leg: Trc20ResourceLeg) => sum + leg.delegatedUnits, 0n);
      const bandwidthNeeded = operation.plan.legs
        .filter((leg: Trc20ResourceLeg) => leg.resource === "BANDWIDTH")
        .reduce((sum: bigint, leg: Trc20ResourceLeg) => sum + leg.delegatedUnits, 0n);
      return (
        available(resources.EnergyLimit, resources.EnergyUsed) >= energyNeeded &&
        available(resources.NetLimit, resources.NetUsed) >= bandwidthNeeded
      );
    },
  };
}

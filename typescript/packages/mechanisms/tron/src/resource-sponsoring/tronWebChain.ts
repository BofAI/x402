/* eslint-disable jsdoc/require-jsdoc, jsdoc/require-param, jsdoc/require-returns */
import { TronWeb } from "tronweb";
import type { FacilitatorWallet } from "@bankofai/x402-core/wallets";
import { erc20AllowanceAbi, transferWithAuthorizationABI } from "../constants";
import type { FacilitatorTronSigner } from "../signer";
import { normalizeSignedTronTransaction, serializeSignedTronTransaction } from "../signer";
import type { Trc20ApprovalResourceSponsoringRequest } from "../exact/extensions";
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
  readonly resourceOwnerWallet: FacilitatorWallet;
  readonly readContract: FacilitatorTronSigner["readContract"];
  readonly allowedAssets: readonly string[];
  readonly permissionId?: number;
  readonly recoveryWindowMs?: number;
  readonly maxTaposAgeBlocks?: number;
  readonly minimumApprovalBroadcastWindowMs?: number;
  /** `packed` is low-latency/provisional; `solidified` waits for irreversible state. */
  readonly confirmationMode?: "packed" | "solidified";
  readonly confirmationTimeoutMs?: number;
  readonly confirmationPollIntervalMs?: number;
}

type ChainParameter = { key: string; value: number };
type BroadcastHexResult = {
  result?: boolean;
  txid?: string;
  code?: string;
  message?: string;
};

function toBigInt(value: number | string | bigint | undefined): bigint {
  return value == null ? 0n : BigInt(value);
}

function available(limit: number | undefined, used: number | undefined): bigint {
  const remaining = toBigInt(limit) - toBigInt(used);
  return remaining > 0n ? remaining : 0n;
}

function normalizeAddress(address: string): string {
  return TronWeb.address.toHex(address).toLowerCase();
}

function isContractAccount(type: unknown): boolean {
  return type === "Contract" || type === 2 || type === "2";
}

function toSafeNumber(value: bigint, label: string): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${label} is outside TronWeb's safe numeric range`);
  }
  return Number(value);
}

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

function parameterValue(parameters: readonly ChainParameter[], key: string): bigint {
  return toBigInt(parameters.find(parameter => parameter.key === key)?.value);
}

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

/** Creates a concrete chain driver backed by TronWeb and a Resource Owner wallet. */
export async function createTronWebResourceSponsoringChain(
  options: TronWebResourceSponsoringChainOptions,
): Promise<Trc20ResourceSponsoringChain> {
  const ownerAddress = await options.resourceOwnerWallet.getAddress();
  const allowedAssets = new Set(options.allowedAssets.map(normalizeAddress));
  const recoveryWindowMs = options.recoveryWindowMs ?? DEFAULT_RECOVERY_WINDOW_MS;
  const maxTaposAgeBlocks = options.maxTaposAgeBlocks ?? DEFAULT_MAX_TAPOS_AGE_BLOCKS;
  const minimumApprovalBroadcastWindowMs = options.minimumApprovalBroadcastWindowMs ?? 15_000;
  const confirmationMode = options.confirmationMode ?? "packed";
  const confirmationTimeoutMs = options.confirmationTimeoutMs ?? 90_000;
  const confirmationPollIntervalMs = options.confirmationPollIntervalMs ?? 3_000;

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

  async function signSystemTransaction(
    unsigned: Record<string, unknown>,
  ): Promise<PreparedTronAction> {
    const signed = normalizeSignedTronTransaction(
      await options.resourceOwnerWallet.signTransaction(unsigned),
      unsigned,
    );
    return preparedFromSigned(signed);
  }

  async function broadcastHex(signedTransaction: string): Promise<string> {
    const result = (await options.tronWeb.trx.sendHexTransaction(
      signedTransaction,
    )) as BroadcastHexResult;
    if (!result.result || !result.txid) {
      throw new Error(`TRON broadcast rejected: ${result.code ?? result.message ?? "unknown"}`);
    }
    return result.txid.toLowerCase();
  }

  async function readAllowance(request: Trc20ApprovalResourceSponsoringRequest): Promise<bigint> {
    return BigInt(
      (await options.readContract({
        address: request.asset,
        abi: erc20AllowanceAbi as unknown as readonly Record<string, unknown>[],
        functionName: "allowance",
        args: [request.payer, request.spender],
      })) as bigint | string | number,
    );
  }

  async function readBalance(request: Trc20ApprovalResourceSponsoringRequest): Promise<bigint> {
    return BigInt(
      (await options.readContract({
        address: request.asset,
        abi: transferWithAuthorizationABI as unknown as readonly Record<string, unknown>[],
        functionName: "balanceOf",
        args: [request.payer],
      })) as bigint | string | number,
    );
  }

  return {
    async preflight(request) {
      if (!allowedAssets.has(normalizeAddress(request.asset))) {
        throw new Error("approval_asset_not_allowed");
      }
      const [payerAccount, tokenAccount] = await Promise.all([
        options.tronWeb.trx.getAccount(request.payer),
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
            request.payer,
          ),
          options.tronWeb.trx.getAccountResources(request.payer),
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
      const unsigned = await options.tronWeb.transactionBuilder.delegateResource(
        toSafeNumber(leg.stakeSun, "delegated stake"),
        request.payer,
        leg.resource,
        ownerAddress,
        false,
        0,
        options.permissionId == null ? undefined : { permissionId: options.permissionId },
      );
      return signSystemTransaction(unsigned as unknown as Record<string, unknown>);
    },

    async prepareUndelegate(request, leg) {
      const unsigned = await options.tronWeb.transactionBuilder.undelegateResource(
        toSafeNumber(leg.stakeSun, "undelegated stake"),
        request.payer,
        leg.resource,
        ownerAddress,
        options.permissionId == null ? undefined : { permissionId: options.permissionId },
      );
      return signSystemTransaction(unsigned as unknown as Record<string, unknown>);
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
      const resources = await options.tronWeb.trx.getAccountResources(request.payer);
      const energyAvailable = available(resources.EnergyLimit, resources.EnergyUsed);
      const stakedBandwidth = available(resources.NetLimit, resources.NetUsed);
      const freeBandwidth = available(resources.freeNetLimit, resources.freeNetUsed);
      return (
        energyAvailable >= plan.energyRequired &&
        (stakedBandwidth >= plan.bandwidthRequired || freeBandwidth >= plan.bandwidthRequired)
      );
    },

    async allowanceSufficient(request) {
      return (await readAllowance(request)) >= BigInt(request.paymentRequirements.amount);
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

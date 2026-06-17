import type { PaymentRequirements } from "@x402/core/types";
import { TronWeb } from "tronweb";
import type { InspectedTronTransaction, SignedTronTransaction, TronTransaction } from "./types";

/**
 * Client signer capable of building and signing a TRC-20 transfer.
 */
export type ClientTronSigner = {
  readonly address: string;
  buildTransferTransaction(
    requirements: PaymentRequirements,
    feeLimit: number,
  ): Promise<TronTransaction>;
  signTransaction(transaction: TronTransaction): Promise<SignedTronTransaction>;
};

/**
 * Facilitator-side network operations for verification and settlement.
 */
export type FacilitatorTronClient = {
  preflightTransfer?(transfer: InspectedTronTransaction, network: string): Promise<void>;
  broadcastTransaction(transaction: SignedTronTransaction, network: string): Promise<string>;
  waitForTransaction(transactionId: string, network: string): Promise<void>;
};

/**
 * Maps one or more networks to TronWeb instances.
 */
export type TronWebConfig = TronWeb | Record<string, TronWeb>;

/**
 * Creates a private-key-backed client signer.
 *
 * @param tronWeb - TronWeb instance connected to the target network
 * @param privateKey - Payer private key
 * @returns Client signer
 */
export function createClientTronSigner(tronWeb: TronWeb, privateKey: string): ClientTronSigner {
  const address = TronWeb.address.fromPrivateKey(privateKey);
  if (!address) {
    throw new Error("Invalid TRON private key");
  }

  return {
    address,
    buildTransferTransaction: async (requirements, feeLimit) => {
      const response = await tronWeb.transactionBuilder.triggerSmartContract(
        requirements.asset,
        "transfer(address,uint256)",
        { feeLimit },
        [
          { type: "address", value: requirements.payTo },
          { type: "uint256", value: requirements.amount },
        ],
        address,
      );
      if (!response.result?.result || !response.transaction) {
        throw new Error(response.result?.message || "Failed to build TRC-20 transfer");
      }
      const latestExpiration = Date.now() + requirements.maxTimeoutSeconds * 1_000;
      if (response.transaction.raw_data.expiration > latestExpiration) {
        response.transaction.raw_data.expiration = latestExpiration;
        return tronWeb.transactionBuilder.newTxID(response.transaction, { txLocal: true });
      }
      return response.transaction;
    },
    signTransaction: transaction => tronWeb.trx.sign(transaction, privateKey),
  };
}

/**
 * Creates a TronWeb-backed facilitator client.
 *
 * @param config - Single TronWeb instance or per-network map
 * @param confirmation - Confirmation polling configuration
 * @param confirmation.pollIntervalMs - Delay between confirmation checks
 * @param confirmation.maxAttempts - Maximum confirmation checks
 * @returns Facilitator network client
 */
export function createFacilitatorTronClient(
  config: TronWebConfig,
  confirmation: { pollIntervalMs?: number; maxAttempts?: number } = {},
): FacilitatorTronClient {
  const pollIntervalMs = confirmation.pollIntervalMs ?? 3_000;
  const maxAttempts = confirmation.maxAttempts ?? 20;

  const getTronWeb = (network: string): TronWeb => {
    if (config instanceof TronWeb) {
      return config;
    }
    const tronWeb = config[network];
    if (!tronWeb) {
      throw new Error(`No TronWeb client configured for network ${network}`);
    }
    return tronWeb;
  };

  return {
    preflightTransfer: async (transfer, network) => {
      const tronWeb = getTronWeb(network);
      const response = await tronWeb.transactionBuilder.triggerConstantContract(
        transfer.asset,
        "transfer(address,uint256)",
        {},
        [
          { type: "address", value: transfer.payTo },
          { type: "uint256", value: transfer.amount },
        ],
        transfer.payer,
      );
      if (!response.result?.result) {
        throw new Error(response.result?.message || "TRC-20 transfer simulation failed");
      }
    },
    broadcastTransaction: async (transaction, network) => {
      const result = await getTronWeb(network).trx.sendRawTransaction(transaction);
      if (!result.result) {
        throw new Error(result.message || String(result.code) || "TRON broadcast failed");
      }
      return transaction.txID;
    },
    waitForTransaction: async (transactionId, network) => {
      const tronWeb = getTronWeb(network);
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
          const info = await tronWeb.trx.getTransactionInfo(transactionId);
          if (info?.id) {
            if (info.receipt?.result && info.receipt.result !== "SUCCESS") {
              throw new Error(`TRON transaction failed: ${info.receipt.result}`);
            }
            return;
          }
        } catch (error) {
          if (attempt === maxAttempts - 1) {
            throw error;
          }
        }
        await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
      }
      throw new Error(`Timed out waiting for TRON transaction ${transactionId}`);
    },
  };
}

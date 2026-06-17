import { TronWeb, Trx } from "tronweb";
import { vi } from "vitest";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import type { SignedTronTransaction } from "../../src/types";

export const NOW = 1_800_000_000_000;
export const PAYER = TronWeb.address.fromPrivateKey("1".padStart(64, "0")) as string;
export const PAY_TO = TronWeb.address.fromPrivateKey("2".padStart(64, "0")) as string;
export const OTHER_ADDRESS = TronWeb.address.fromPrivateKey("3".padStart(64, "0")) as string;
export const ASSET = TronWeb.address.fromPrivateKey("4".padStart(64, "0")) as string;

export const REQUIREMENTS: PaymentRequirements = {
  scheme: "exact",
  network: "tron:shasta",
  asset: ASSET,
  amount: "1000000",
  payTo: PAY_TO,
  maxTimeoutSeconds: 60,
  extra: {},
};

/**
 * Creates a structurally valid signed TRC-20 transfer for tests.
 *
 * @param overrides - Transaction field overrides
 * @returns Signed transaction
 */
export function createSignedTransfer(
  overrides: {
    payer?: string;
    payTo?: string;
    asset?: string;
    amount?: string;
    timestamp?: number;
    expiration?: number;
    feeLimit?: number;
    selector?: string;
    contractType?: string;
    signature?: string[];
  } = {},
): SignedTronTransaction {
  const payer = overrides.payer ?? PAYER;
  const payTo = overrides.payTo ?? PAY_TO;
  const asset = overrides.asset ?? ASSET;
  const amount = BigInt(overrides.amount ?? REQUIREMENTS.amount);
  const timestamp = overrides.timestamp ?? NOW;
  const expiration = overrides.expiration ?? NOW + 50_000;
  const recipient = TronWeb.address.toHex(payTo).slice(2).padStart(64, "0");
  const amountWord = amount.toString(16).padStart(64, "0");

  return {
    visible: false,
    txID: "ab".repeat(32),
    raw_data: {
      contract: [
        {
          type: overrides.contractType ?? "TriggerSmartContract",
          parameter: {
            type_url: "type.googleapis.com/protocol.TriggerSmartContract",
            value: {
              owner_address: TronWeb.address.toHex(payer),
              contract_address: TronWeb.address.toHex(asset),
              data: `${overrides.selector ?? "a9059cbb"}${recipient}${amountWord}`,
              call_value: 0,
            },
          },
        },
      ],
      ref_block_bytes: "0000",
      ref_block_hash: "00".repeat(8),
      timestamp,
      expiration,
      fee_limit: overrides.feeLimit ?? 50_000_000,
    },
    raw_data_hex: "00",
    signature: overrides.signature ?? ["00".repeat(65)],
  } as unknown as SignedTronTransaction;
}

/**
 * Creates a payment payload around a test transaction.
 *
 * @param transaction - Signed transaction
 * @param requirements - Accepted requirements
 * @returns Payment payload
 */
export function createPaymentPayload(
  transaction = createSignedTransfer(),
  requirements = REQUIREMENTS,
): PaymentPayload {
  return {
    x402Version: 2,
    resource: { url: "https://example.com" },
    accepted: requirements,
    payload: { transaction },
  };
}

/**
 * Mocks signature recovery for structurally generated test transactions.
 *
 * @param payer - Recovered payer address
 * @returns Vitest spy
 */
export function mockRecoveredPayer(payer = PAYER) {
  return vi.spyOn(Trx, "ecRecover").mockReturnValue(payer);
}

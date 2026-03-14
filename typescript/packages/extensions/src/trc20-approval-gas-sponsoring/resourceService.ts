import {
  TRC20_APPROVAL_GAS_SPONSORING,
  TRC20_APPROVAL_GAS_SPONSORING_VERSION,
  type Trc20ApprovalGasSponsoringExtension,
} from "./types";

/** JSON schema advertised by servers for sponsored TRC-20 Permit2 approvals. */
export const trc20ApprovalGasSponsoringSchema: Record<string, unknown> = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  properties: {
    from: {
      type: "string",
      pattern: "^T[1-9A-HJ-NP-Za-km-z]{33}$",
      description: "The TRON base58 token owner address.",
    },
    asset: {
      type: "string",
      pattern: "^T[1-9A-HJ-NP-Za-km-z]{33}$",
      description: "The TRC-20 token contract address.",
    },
    spender: {
      type: "string",
      pattern: "^T[1-9A-HJ-NP-Za-km-z]{33}$",
      description: "The Permit2 contract address.",
    },
    amount: {
      type: "string",
      pattern: "^[0-9]+$",
      description: "The approved amount as a decimal string. Always MaxUint256.",
    },
    signedTransaction: {
      type: "object",
      properties: {
        raw_data: { type: "object" },
        raw_data_hex: { type: "string" },
        signature: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
        },
      },
      required: ["raw_data", "raw_data_hex", "signature"],
    },
    version: {
      type: "string",
      pattern: "^[0-9]+(\\.[0-9]+)*$",
      description: "Schema version identifier.",
    },
  },
  required: ["from", "asset", "spender", "amount", "signedTransaction", "version"],
};

/**
 * Declares the facilitator extension that sponsors a pre-signed TRC-20 approval.
 *
 * @returns The extension declaration advertised in `PaymentRequired.extensions`.
 */
export function declareTrc20ApprovalGasSponsoringExtension(): Record<
  string,
  Trc20ApprovalGasSponsoringExtension
> {
  const key = TRC20_APPROVAL_GAS_SPONSORING.key;
  return {
    [key]: {
      info: {
        description:
          "The facilitator broadcasts a pre-signed TRC-20 approve() transaction to grant Permit2 allowance.",
        version: TRC20_APPROVAL_GAS_SPONSORING_VERSION,
      },
      schema: trc20ApprovalGasSponsoringSchema,
    },
  };
}

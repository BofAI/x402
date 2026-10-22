import {
  TRC20_APPROVAL_MAX_AMOUNT,
  TRC20_APPROVAL_RESOURCE_SPONSORING_VERSION,
} from "@bankofai/x402-tron/exact/extensions";
/** Canonical JSON Schema for version 1 extension info. */
export const trc20ApprovalResourceSponsoringSchema: Record<string, unknown> = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  properties: {
    from: { type: "string", pattern: "^T[1-9A-HJ-NP-Za-km-z]{33}$" },
    asset: { type: "string", pattern: "^T[1-9A-HJ-NP-Za-km-z]{33}$" },
    spender: { type: "string", pattern: "^T[1-9A-HJ-NP-Za-km-z]{33}$" },
    amount: { const: TRC20_APPROVAL_MAX_AMOUNT },
    signedTransaction: {
      type: "string",
      pattern: "^(?:[0-9a-f]{2})+$",
      maxLength: 16384,
    },
    version: { const: TRC20_APPROVAL_RESOURCE_SPONSORING_VERSION },
  },
  required: ["from", "asset", "spender", "amount", "signedTransaction", "version"],
};

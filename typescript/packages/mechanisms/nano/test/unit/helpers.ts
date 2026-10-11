import { vi } from "vitest";
import type { PaymentPayload, PaymentRequirements } from "@bankofai/x402-core/types";
import { createNanoRpcClient } from "../../src";

/** Payer and recipient from the node RPC documentation's `block_info` example. */
export const PAYER = "nano_1ipx847tk8o46pwxt5qjdbncjqcbwcc1rrmqnkztrfjy5k7z4imsrata9est";
export const PAY_TO = "nano_1qato4k7z3spc8gq1zyd8xeqfbzsoxwo36a45ozbrxcatut7up8ohyardu1z";
export const PAY_TO_KEY = "5D1AA8A45F8736519D707FCB375976A7F9AF795091021D7E9C7548D6F45DD8D5";
export const BLOCK_HASH = "87434F8041869A01C8F6F263B87972D7BA443A72E0A97D7A3FD0CCC2358FD6F9";
export const BLOCK_TIME = 1_760_000_000;

/** 0.03 XNO, the amount in the documentation example. */
export const AMOUNT = "30000000000000000000000000000";

/**
 * `block_info` response (json_block true) for a confirmed state send block,
 * shaped exactly as the node RPC returns it.
 *
 * @param overrides - Top-level fields to replace.
 * @param contents - Fields of `contents` to replace.
 * @returns The response body.
 */
export function stateSendBlockInfo(
  overrides: Record<string, unknown> = {},
  contents: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    block_account: PAYER,
    amount: AMOUNT,
    balance: "5606157000000000000000000000000000000",
    height: "58",
    local_timestamp: String(BLOCK_TIME),
    successor: "0000000000000000000000000000000000000000000000000000000000000000",
    confirmed: "true",
    contents: {
      type: "state",
      account: PAYER,
      previous: "CE898C131AAEE25E05362F247760F8A3ACF34A9796A5AE0D9204E86B0637965E",
      representative: "nano_1stofnrxuz3cai7ze75o174bpm7scwj9jn3nxsn8ntzg784jf1gzn1jjdkou",
      balance: "5606157000000000000000000000000000000",
      link: PAY_TO_KEY,
      link_as_account: PAY_TO,
      signature:
        "82D41BC16F313E4B2243D14DFFA2FB04679C540C2095FEE7EAE0F2F26880AD56DD48D87A7CC5DD760C5B2D76EE2C205506AA557BF00B60D8DEE312EC7343A501",
      work: "8a142e07a10996d5",
      ...contents,
    },
    subtype: "send",
    ...overrides,
  };
}

/**
 * Build an RPC client whose fetch returns the given body and records requests.
 *
 * @param body - JSON body to return, or a function of the request body.
 * @param status - HTTP status.
 * @returns The RPC client and the fetch spy.
 */
export function mockRpc(body: unknown, status = 200) {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  });
  const rpc = createNanoRpcClient({
    rpcUrl: "http://127.0.0.1:7076",
    fetch: fetchMock as unknown as typeof fetch,
  });
  return { rpc, fetchMock };
}

/**
 * Payment requirements for the documentation example.
 *
 * @param overrides - Fields to replace.
 * @returns The requirements.
 */
export function requirements(overrides: Partial<PaymentRequirements> = {}): PaymentRequirements {
  return {
    scheme: "exact",
    network: "nano:mainnet",
    asset: "XNO",
    amount: AMOUNT,
    payTo: PAY_TO,
    maxTimeoutSeconds: 300,
    extra: {},
    ...overrides,
  };
}

/**
 * Payment payload carrying a block hash.
 *
 * @param blockHash - The hash to send.
 * @param accepted - Requirements the client accepted.
 * @returns The payload.
 */
export function paymentPayload(
  blockHash: unknown = BLOCK_HASH,
  accepted: PaymentRequirements = requirements(),
): PaymentPayload {
  return { x402Version: 2, accepted, payload: { blockHash } };
}

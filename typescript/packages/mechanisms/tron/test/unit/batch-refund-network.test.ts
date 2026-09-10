import { describe, expect, it, vi } from "vitest";
import { BatchSettlementTronScheme } from "../../src/batch-settlement/client/scheme";
import type { ClientTronSigner } from "../../src/signer";
import { encodePaymentRequiredHeader } from "@bankofai/x402-core/http";
import type { PaymentRequired, PaymentRequirements } from "@bankofai/x402-core/types";

/**
 * Regression: on a route that advertises batch-settlement on several networks
 * (e.g. EVM + TRON), the refund probe must pick THIS package's chain family.
 *
 * Previously it took the first scheme match; when an eip155 accept came first
 * the TRON refund fed eip155:97 into computeChannelId → getTronChainId, which
 * threw "Unsupported network format: eip155:97". The fix filters to tron:*.
 *
 * We drive scheme.refund() with a mocked 402 whose accepts list an EVM option
 * FIRST, and a signer whose readContract throws a sentinel. Reaching the sentinel
 * proves the TRON requirement was selected (computeChannelId(tron:3448148188) ran and
 * the flow got to the on-chain channel read); a regression would throw the
 * eip155 network error before that.
 */

const URL = "http://localhost:4041/weather";
const TRON_PAYTO = "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf";
const TRON_ASSET = "TGjgvdTWWrybVLaVeFqSyVqJQWjxqRYbaK";
const TRON_AUTHORIZER = "TKtWbdzEq5ss9vTS9kwRhBp5mXmBfBns3E";
const SIGNER_ADDR = "TJRyWwFs9wTFGZg3JbrVriFbNfCug5tDeC";

function evmAccept(): PaymentRequirements {
  return {
    scheme: "batch-settlement",
    network: "eip155:97",
    asset: "0x64544969ed7EBf5f083679233325356EbE738930",
    amount: "1000000",
    payTo: "0x000000000000000000000000000000000000dEaD",
    maxTimeoutSeconds: 60,
    extra: { receiverAuthorizer: "0x000000000000000000000000000000000000bEEF", withdrawDelay: 900 },
  } as unknown as PaymentRequirements;
}

function tronAccept(): PaymentRequirements {
  return {
    scheme: "batch-settlement",
    network: "tron:3448148188",
    asset: TRON_ASSET,
    amount: "1000000",
    payTo: TRON_PAYTO,
    maxTimeoutSeconds: 60,
    extra: { receiverAuthorizer: TRON_AUTHORIZER, withdrawDelay: 900 },
  } as unknown as PaymentRequirements;
}

/** A 402 Response whose PAYMENT-REQUIRED lists the EVM accept BEFORE the TRON one. */
function multiNetwork402(): Response {
  const paymentRequired: PaymentRequired = {
    x402Version: 2,
    resource: { url: URL, description: "", mimeType: "application/json" },
    accepts: [evmAccept(), tronAccept()],
  } as unknown as PaymentRequired;
  return new Response(null, {
    status: 402,
    headers: { "PAYMENT-REQUIRED": encodePaymentRequiredHeader(paymentRequired) },
  });
}

function mockSigner(): ClientTronSigner {
  return {
    address: SIGNER_ADDR,
    signTypedData: vi.fn(),
    readContract: vi.fn().mockRejectedValue(new Error("READCONTRACT_REACHED")),
  } as unknown as ClientTronSigner;
}

describe("TRON batch-settlement refund — multi-network route", () => {
  it("selects the tron:* accept (not the first/EVM one) when probing", async () => {
    const scheme = new BatchSettlementTronScheme(mockSigner());
    const fetchImpl = vi.fn().mockResolvedValue(multiNetwork402());

    // Reaching the on-chain read (sentinel) proves computeChannelId(tron:3448148188)
    // ran. A regression would throw "Unsupported network format: eip155:97".
    await expect(scheme.refund(URL, { fetch: fetchImpl })).rejects.toThrow("READCONTRACT_REACHED");
  });
});

import { describe, it, expect, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { BatchSettlementEvmScheme } from "../../../src/batch-settlement/client/scheme";
import type { ClientEvmSigner } from "../../../src/signer";
import { encodePaymentRequiredHeader } from "@bankofai/x402-core/http";
import type { PaymentRequired, PaymentRequirements } from "@bankofai/x402-core/types";

/**
 * Regression: on a route that advertises batch-settlement on several networks
 * (e.g. TRON + EVM), the refund probe must pick THIS package's chain family.
 *
 * Previously it took the first scheme match; when a non-eip155 accept came first
 * the EVM refund would feed e.g. a tron:* network into computeChannelId. The fix filters
 * to eip155:*.
 *
 * We drive scheme.refund() with a mocked 402 whose accepts list a TRON option
 * FIRST, and a signer whose readContract throws a sentinel. Reaching the sentinel
 * proves the eip155 requirement was selected (computeChannelId(eip155:84532) ran
 * and the flow got to the on-chain channel read).
 */

const URL = "http://localhost:4041/weather";
const PAYER_PRIVATE_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const EVM_NETWORK = "eip155:84532";
const EVM_ASSET = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const EVM_PAYTO = "0x9876543210987654321098765432109876543210";
const EVM_AUTHORIZER = "0x1111111111111111111111111111111111111111";

function tronAccept(): PaymentRequirements {
  return {
    scheme: "batch-settlement",
    network: "tron:3448148188",
    asset: "TGjgvdTWWrybVLaVeFqSyVqJQWjxqRYbaK",
    amount: "1000000",
    payTo: "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf",
    maxTimeoutSeconds: 60,
    extra: { receiverAuthorizer: "TKtWbdzEq5ss9vTS9kwRhBp5mXmBfBns3E", withdrawDelay: 900 },
  } as unknown as PaymentRequirements;
}

function evmAccept(): PaymentRequirements {
  return {
    scheme: "batch-settlement",
    network: EVM_NETWORK,
    asset: EVM_ASSET,
    amount: "1000000",
    payTo: EVM_PAYTO,
    maxTimeoutSeconds: 60,
    extra: { receiverAuthorizer: EVM_AUTHORIZER, withdrawDelay: 900 },
  } as unknown as PaymentRequirements;
}

/** A 402 Response whose PAYMENT-REQUIRED lists the TRON accept BEFORE the EVM one. */
function multiNetwork402(): Response {
  const paymentRequired: PaymentRequired = {
    x402Version: 2,
    resource: { url: URL, description: "", mimeType: "application/json" },
    accepts: [tronAccept(), evmAccept()],
  } as unknown as PaymentRequired;
  return new Response(null, {
    status: 402,
    headers: { "PAYMENT-REQUIRED": encodePaymentRequiredHeader(paymentRequired) },
  });
}

function mockSigner(): ClientEvmSigner {
  const account = privateKeyToAccount(PAYER_PRIVATE_KEY);
  return {
    address: account.address,
    signTypedData: vi.fn(),
    readContract: vi.fn().mockRejectedValue(new Error("READCONTRACT_REACHED")),
  } as unknown as ClientEvmSigner;
}

describe("EVM batch-settlement refund — multi-network route", () => {
  it("selects the eip155:* accept (not the first/TRON one) when probing", async () => {
    const scheme = new BatchSettlementEvmScheme(mockSigner());
    const fetchImpl = vi.fn().mockResolvedValue(multiNetwork402());

    // Reaching the on-chain read (sentinel) proves computeChannelId(eip155:84532)
    // ran — i.e. the eip155 requirement was selected, not the leading TRON one.
    await expect(scheme.refund(URL, { fetch: fetchImpl })).rejects.toThrow("READCONTRACT_REACHED");
  });
});

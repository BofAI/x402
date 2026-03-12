import { describe, it, expect } from "vitest";
import { x402HTTPClient } from "../../../src/http/x402HTTPClient";
import { x402Client } from "../../../src/client/x402Client";
import { buildPaymentRequired, buildPaymentPayload, buildSettleResponse } from "../../mocks";
import { encodePaymentRequiredHeader, encodePaymentResponseHeader } from "../../../src/http";

describe("x402HTTPClient V1 Protocol", () => {
  describe("encodePaymentSignatureHeader", () => {
    it("should encode v1 payload with X-PAYMENT header", () => {
      const client = new x402Client();
      const httpClient = new x402HTTPClient(client);

      const v1Payload = buildPaymentPayload({
        x402Version: 1 as const,
        payload: { signature: "v1_sig" },
      });

      const headers = httpClient.encodePaymentSignatureHeader(v1Payload);

      expect(headers).toHaveProperty("X-PAYMENT");
      expect(headers).not.toHaveProperty("PAYMENT-SIGNATURE");
    });

    it("should encode v2 payload with PAYMENT-SIGNATURE header", () => {
      const client = new x402Client();
      const httpClient = new x402HTTPClient(client);

      const v2Payload = buildPaymentPayload();

      const headers = httpClient.encodePaymentSignatureHeader(v2Payload);

      expect(headers).toHaveProperty("PAYMENT-SIGNATURE");
      expect(headers).not.toHaveProperty("X-PAYMENT");
    });
  });

  describe("getPaymentRequiredResponse", () => {
    it("should parse v1 payment required from body", () => {
      const client = new x402Client();
      const httpClient = new x402HTTPClient(client);

      const v1Body = {
        x402Version: 1,
        accepts: [
          {
            scheme: "exact",
            network: "base-sepolia",
            maxAmountRequired: "500000",
            resource: "https://example.com",
            description: "Test",
            mimeType: "application/json",
            outputSchema: {},
            payTo: "0x1234567890123456789012345678901234567890",
            maxTimeoutSeconds: 300,
            asset: "0x0000000000000000000000000000000000000000",
            extra: {},
          },
        ],
      };

      const getHeader = (_name: string): string | null => null;

      const result = httpClient.getPaymentRequiredResponse(getHeader, v1Body);

      expect(result.x402Version).toBe(1);
      expect(result.accepts).toHaveLength(1);
    });

    it("should prefer v2 header over v1 body", () => {
      const client = new x402Client();
      const httpClient = new x402HTTPClient(client);

      const v2PaymentRequired = buildPaymentRequired();
      const encoded = encodePaymentRequiredHeader(v2PaymentRequired);

      const v1Body = {
        x402Version: 1,
        accepts: [],
      };

      const getHeader = (name: string): string | null => {
        if (name === "PAYMENT-REQUIRED") return encoded;
        return null;
      };

      const result = httpClient.getPaymentRequiredResponse(getHeader, v1Body);

      expect(result.x402Version).toBe(2);
    });

    it("should throw when no v2 header and body is not v1", () => {
      const client = new x402Client();
      const httpClient = new x402HTTPClient(client);

      const getHeader = (_name: string): string | null => null;

      expect(() => httpClient.getPaymentRequiredResponse(getHeader, {})).toThrow(
        "Invalid payment required response",
      );
    });

    it("should throw when no header and no body provided", () => {
      const client = new x402Client();
      const httpClient = new x402HTTPClient(client);

      const getHeader = (_name: string): string | null => null;

      expect(() => httpClient.getPaymentRequiredResponse(getHeader)).toThrow(
        "Invalid payment required response",
      );
    });
  });

  describe("getPaymentSettleResponse", () => {
    it("should parse from X-PAYMENT-RESPONSE header (v1)", () => {
      const client = new x402Client();
      const httpClient = new x402HTTPClient(client);

      const settleResponse = buildSettleResponse();
      const encoded = encodePaymentResponseHeader(settleResponse);

      const getHeader = (name: string): string | null => {
        if (name === "X-PAYMENT-RESPONSE") return encoded;
        return null;
      };

      const result = httpClient.getPaymentSettleResponse(getHeader);

      expect(result.success).toBe(true);
      expect(result.transaction).toBe("0xTestTransaction");
    });

    it("should parse from PAYMENT-RESPONSE header (v2)", () => {
      const client = new x402Client();
      const httpClient = new x402HTTPClient(client);

      const settleResponse = buildSettleResponse();
      const encoded = encodePaymentResponseHeader(settleResponse);

      const getHeader = (name: string): string | null => {
        if (name === "PAYMENT-RESPONSE") return encoded;
        return null;
      };

      const result = httpClient.getPaymentSettleResponse(getHeader);

      expect(result.success).toBe(true);
    });

    it("should prefer v2 PAYMENT-RESPONSE over v1 X-PAYMENT-RESPONSE", () => {
      const client = new x402Client();
      const httpClient = new x402HTTPClient(client);

      const v2Response = buildSettleResponse({ transaction: "0xV2Tx" });
      const v1Response = buildSettleResponse({ transaction: "0xV1Tx" });
      const v2Encoded = encodePaymentResponseHeader(v2Response);
      const v1Encoded = encodePaymentResponseHeader(v1Response);

      const getHeader = (name: string): string | null => {
        if (name === "PAYMENT-RESPONSE") return v2Encoded;
        if (name === "X-PAYMENT-RESPONSE") return v1Encoded;
        return null;
      };

      const result = httpClient.getPaymentSettleResponse(getHeader);

      expect(result.transaction).toBe("0xV2Tx");
    });

    it("should throw when no payment response header found", () => {
      const client = new x402Client();
      const httpClient = new x402HTTPClient(client);

      const getHeader = (_name: string): string | null => null;

      expect(() => httpClient.getPaymentSettleResponse(getHeader)).toThrow(
        "Payment response header not found",
      );
    });
  });
});

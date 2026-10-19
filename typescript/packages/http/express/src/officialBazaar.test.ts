import { describe, expect, it } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { x402ResourceServer, type FacilitatorClient } from "@bankofai/x402-core/server";
import { decodePaymentRequiredHeader } from "@bankofai/x402-core/http";
import type { SchemeNetworkServer } from "@bankofai/x402-core/types";
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { paymentMiddleware } from "./index";

const network = "eip155:84532";
const facilitator: FacilitatorClient = {
  getSupported: async () => ({
    kinds: [{ x402Version: 2, scheme: "exact", network }],
    extensions: [],
    signers: {},
  }),
  verify: async () => ({ isValid: false, invalidReason: "invalid_signature" }),
  settle: async () => ({
    success: false,
    errorReason: "invalid_signature",
    transaction: "",
    network,
  }),
};
const scheme: SchemeNetworkServer = {
  scheme: "exact",
  parsePrice: async () => ({ amount: "1000", asset: "0x0000000000000000000000000000000000000001" }),
  enhancePaymentRequirements: async requirements => requirements,
};

describe("official Bazaar middleware integration", () => {
  it("enriches a real 402 challenge without delivering the protected resource", async () => {
    const resourceServer = new x402ResourceServer(facilitator).register(network, scheme);
    const declaration = declareDiscoveryExtension({
      input: { city: "London" },
      inputSchema: { properties: { city: { type: "string" } } },
    });
    const original = JSON.stringify(declaration);
    const app = express();
    let deliveries = 0;
    app.use(
      paymentMiddleware(
        {
          "GET /weather/:city": {
            accepts: { scheme: "exact", network, price: "$0.001", payTo: "0x123" },
            extensions: declaration,
          },
        },
        resourceServer,
      ),
    );
    app.get("/weather/:city", (_req, res) => {
      deliveries += 1;
      res.json({ temperature: 20 });
    });
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>(resolve => server.once("listening", resolve));
    try {
      const response = await fetch(
        `http://127.0.0.1:${(server.address() as AddressInfo).port}/weather/London`,
      );
      expect(response.status).toBe(402);
      const required = decodePaymentRequiredHeader(response.headers.get("payment-required")!);
      expect(required.accepts[0].amount).toBe("1000");
      expect(required.extensions?.bazaar).toMatchObject({
        info: { input: { type: "http", method: "GET" } },
      });
      expect(resourceServer.hasExtension("bazaar")).toBe(true);
      expect(JSON.stringify(declaration)).toBe(original);
      expect(deliveries).toBe(0);
      await response.arrayBuffer();
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close(error => (error ? reject(error) : resolve())),
      );
    }
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { x402HTTPResourceServer, x402ResourceServer } from "@bankofai/x402-core/server";
import { paymentMiddleware } from "./index";

// Hono decodes paths before matching. Check that routed requests with
// encoded line terminators still reach the x402 payment check.
describe("hono end-to-end: percent-encoded line terminator under wildcard route", () => {
  describe("with the x402 payment middleware installed", () => {
    let requiresPaymentSpy: ReturnType<typeof vi.spyOn>;

    /**
     * Builds a Hono app with the x402 payment middleware installed on a
     * wildcard route, plus a catch-all so an unprotected path resolves to
     * 200 instead of a framework 404.
     *
     * @returns The configured Hono app.
     */
    function buildApp() {
      const app = new Hono();
      const resourceServer = new x402ResourceServer();
      app.use(
        "*",
        paymentMiddleware(
          {
            "/api/premium/*": {
              accepts: {
                scheme: "exact",
                payTo: "0xabc",
                price: "$1.00",
                network: "eip155:84532",
              },
            },
          },
          resourceServer,
          undefined,
          undefined,
          // syncFacilitatorOnStart=false so the test does not try to call a real facilitator
          false,
        ),
      );
      // Catch-all so a skipped route is 200, distinct from a framework 404.
      app.all("*", c => c.text("ok", 200));
      return app;
    }

    beforeEach(() => {
      requiresPaymentSpy = vi.spyOn(x402HTTPResourceServer.prototype, "requiresPayment");
    });

    afterEach(() => {
      requiresPaymentSpy.mockRestore();
    });

    it("returns 402 for a baseline wildcard match, and requiresPayment is called", async () => {
      const res = await buildApp().request("/api/premium/report");
      expect(res.status).toBe(402);
      expect(requiresPaymentSpy).toHaveBeenCalledTimes(1);
    });

    it.each([
      ["U+2028 LINE SEPARATOR", "/api/premium/report%E2%80%A8"],
      ["U+2029 PARAGRAPH SEPARATOR", "/api/premium/report%E2%80%A9"],
      ["LF", "/api/premium/report%0A"],
      ["CR", "/api/premium/report%0D"],
    ])("requires payment for an encoded %s routed to the wildcard", async (_, path) => {
      const res = await buildApp().request(path);

      expect(res.status).toBe(402);
      expect(requiresPaymentSpy).toHaveBeenCalledTimes(1);
    });

    it("returns 200 (middleware skipped) for an unrelated path", async () => {
      const res = await buildApp().request("/health");
      expect(res.status).toBe(200);
      expect(requiresPaymentSpy).toHaveBeenCalledTimes(1);
    });
  });
});

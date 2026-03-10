import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";
import type { x402HTTPResourceServer } from "@bankofai/x402-core/server";

import { withPayment } from "./withPayment";
import { x402ResourceServer } from "@bankofai/x402-core/server";

// Track constructor calls to verify route config passed correctly
let lastConstructedRoutes: Record<string, unknown> | undefined;

vi.mock("@bankofai/x402-core/server", () => ({
  x402ResourceServer: vi.fn(),
  x402HTTPResourceServer: vi.fn().mockImplementation((_server, routes) => {
    lastConstructedRoutes = routes;
    return {
      initialize: vi.fn().mockResolvedValue(undefined),
      processHTTPRequest: vi.fn().mockResolvedValue({ type: "no-payment-required" }),
      processSettlement: vi.fn(),
      registerPaywallProvider: vi.fn(),
      requiresPayment: vi.fn().mockReturnValue(false),
      routes,
      server: {
        hasExtension: vi.fn().mockReturnValue(false),
        registerExtension: vi.fn(),
      },
    } as unknown as x402HTTPResourceServer;
  }),
}));

/**
 * Create a mock x402ResourceServer for testing.
 *
 * @returns A mock server instance.
 */
function createMockServer() {
  return new x402ResourceServer(undefined as never);
}

/**
 * Create mock Express request, response, and next function for testing.
 *
 * @param path - The request path.
 * @returns Mock request, response, and next function.
 */
function createMockReqRes(path = "/test") {
  const req = {
    path,
    method: "GET",
    headers: {},
    header: vi.fn(() => undefined),
  } as unknown as Request;

  const res = {
    statusCode: 200,
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn(),
    writeHead: vi.fn().mockReturnThis(),
    write: vi.fn().mockReturnValue(true),
    end: vi.fn().mockReturnThis(),
    flushHeaders: vi.fn(),
  } as unknown as Response;

  const next = vi.fn() as NextFunction;

  return { req, res, next };
}

describe("withPayment (Express)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastConstructedRoutes = undefined;
  });

  it("should create an x402HTTPResourceServer with wildcard route from single PaymentOption", () => {
    const server = createMockServer();
    const accepts = {
      scheme: "exact",
      payTo: "0x123",
      price: "$0.01",
      network: "eip155:8453",
    };

    withPayment(accepts, server);

    expect(lastConstructedRoutes).toBeDefined();
    expect(lastConstructedRoutes!["*"]).toMatchObject({
      accepts: { scheme: "exact", payTo: "0x123", price: "$0.01", network: "eip155:8453" },
    });
  });

  it("should create an x402HTTPResourceServer with wildcard route from PaymentOption array", () => {
    const server = createMockServer();
    const accepts = [
      { scheme: "exact", payTo: "0x123", price: "$0.01", network: "eip155:8453" },
      { scheme: "exact", payTo: "Txyz", price: "$0.01", network: "tron:728126428" },
    ];

    withPayment(accepts, server);

    expect(lastConstructedRoutes).toBeDefined();
    const routeConfig = lastConstructedRoutes!["*"] as { accepts: unknown[] };
    expect(routeConfig.accepts).toHaveLength(2);
  });

  it("should pass assets field through PaymentOption", () => {
    const server = createMockServer();
    const accepts = {
      scheme: "exact",
      payTo: "0x123",
      price: "$0.01",
      network: "eip155:8453",
      assets: ["USDC", "USDT"],
    };

    withPayment(accepts, server);

    const routeConfig = lastConstructedRoutes!["*"] as { accepts: { assets: string[] } };
    expect(routeConfig.accepts.assets).toEqual(["USDC", "USDT"]);
  });

  it("should pass optional route metadata to RouteConfig", () => {
    const server = createMockServer();
    const accepts = { scheme: "exact", payTo: "0x123", price: "$0.01", network: "eip155:8453" };

    withPayment(accepts, server, {
      description: "Weather API",
      mimeType: "application/json",
    });

    const routeConfig = lastConstructedRoutes!["*"] as {
      description: string;
      mimeType: string;
    };
    expect(routeConfig.description).toBe("Weather API");
    expect(routeConfig.mimeType).toBe("application/json");
  });

  it("should return a callable Express middleware", async () => {
    const server = createMockServer();
    const accepts = { scheme: "exact", payTo: "0x123", price: "$0.01", network: "eip155:8453" };

    const middleware = withPayment(accepts, server);
    expect(typeof middleware).toBe("function");

    const { req, res, next } = createMockReqRes();
    await middleware(req, res, next);

    // Should pass through since requiresPayment returns false
    expect(next).toHaveBeenCalled();
  });
});

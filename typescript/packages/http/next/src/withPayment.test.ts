import { describe, it, expect, vi, beforeEach } from "vitest";

import { withPayment } from "./withPayment";
import { withX402 } from "./index.js";

// Track the routeConfig passed to withX402
let lastRouteConfig: Record<string, unknown> | undefined;

vi.mock("./index.js", () => ({
  withX402: vi.fn().mockImplementation((_handler, routeConfig, _) => {
    lastRouteConfig = routeConfig;
    return vi.fn();
  }),
}));

describe("withPayment (Next.js)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastRouteConfig = undefined;
  });

  it("should delegate to withX402 with correct RouteConfig from single PaymentOption", () => {
    const handler = vi.fn();
    const server = {} as never;
    const accepts = {
      scheme: "exact",
      payTo: "0x123",
      price: "$0.01",
      network: "eip155:8453",
    };

    withPayment(handler, accepts, server);

    expect(withX402).toHaveBeenCalledOnce();
    expect(lastRouteConfig).toMatchObject({
      accepts: { scheme: "exact", payTo: "0x123", price: "$0.01", network: "eip155:8453" },
    });
  });

  it("should delegate to withX402 with correct RouteConfig from PaymentOption array", () => {
    const handler = vi.fn();
    const server = {} as never;
    const accepts = [
      { scheme: "exact", payTo: "0x123", price: "$0.01", network: "eip155:8453" },
      { scheme: "exact", payTo: "Txyz", price: "$0.01", network: "tron:728126428" },
    ];

    withPayment(handler, accepts, server);

    expect(withX402).toHaveBeenCalledOnce();
    const routeConfig = lastRouteConfig as { accepts: unknown[] };
    expect(routeConfig.accepts).toHaveLength(2);
  });

  it("should pass assets field through PaymentOption", () => {
    const handler = vi.fn();
    const server = {} as never;
    const accepts = {
      scheme: "exact",
      payTo: "0x123",
      price: "$0.01",
      network: "eip155:8453",
      assets: ["USDC", "USDT"],
    };

    withPayment(handler, accepts, server);

    const routeConfig = lastRouteConfig as { accepts: { assets: string[] } };
    expect(routeConfig.accepts.assets).toEqual(["USDC", "USDT"]);
  });

  it("should pass optional route metadata to RouteConfig", () => {
    const handler = vi.fn();
    const server = {} as never;
    const accepts = { scheme: "exact", payTo: "0x123", price: "$0.01", network: "eip155:8453" };

    withPayment(handler, accepts, server, {
      description: "Premium API",
      mimeType: "application/json",
    });

    expect(lastRouteConfig).toMatchObject({
      description: "Premium API",
      mimeType: "application/json",
    });
  });

  it("should pass paywallConfig and paywall to withX402", () => {
    const handler = vi.fn();
    const server = {} as never;
    const accepts = { scheme: "exact", payTo: "0x123", price: "$0.01", network: "eip155:8453" };
    const paywallConfig = { appName: "TestApp" };

    withPayment(handler, accepts, server, { paywallConfig });

    expect(withX402).toHaveBeenCalledWith(
      handler,
      expect.any(Object),
      server,
      paywallConfig,
      undefined,
    );
  });

  it("should return the wrapped handler from withX402", () => {
    const handler = vi.fn();
    const server = {} as never;
    const accepts = { scheme: "exact", payTo: "0x123", price: "$0.01", network: "eip155:8453" };

    const result = withPayment(handler, accepts, server);
    expect(typeof result).toBe("function");
  });
});

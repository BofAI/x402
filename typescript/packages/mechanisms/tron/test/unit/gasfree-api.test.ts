import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GasFreeAPIClient } from "../../src/shared/gasfree/api";

/**
 * Offline unit tests for {@link GasFreeAPIClient.getProviders}.
 *
 * Focuses on the 404 graceful-degradation path (commit ed1e6ef): networks not
 * served by GasFree return 404, which must yield an empty provider list so
 * fee/quote degrades instead of crashing the resource server with HTTP 500.
 */

describe("GasFreeAPIClient.getProviders", () => {
  const client = new GasFreeAPIClient("https://gasfree.example");

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns [] on 404 (network unsupported) instead of throwing", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => "Not Found",
    } as unknown as Response);

    await expect(client.getProviders()).resolves.toEqual([]);
  });

  it("throws on non-404 HTTP errors", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "Internal Server Error",
    } as unknown as Response);

    await expect(client.getProviders()).rejects.toThrow(/GasFree config API error: 500/);
  });

  it("returns the provider list on success", async () => {
    const providers = [{ address: "TProvider", name: "p", icon: "", website: "" }];
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ code: 200, data: { providers } }),
    } as unknown as Response);

    await expect(client.getProviders()).resolves.toEqual(providers);
  });
});
